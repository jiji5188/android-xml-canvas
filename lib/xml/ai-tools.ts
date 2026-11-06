// lib/xml/ai-tools.ts
// AI 的「读写查文件」能力。
// 做法：不让模型直接动 DOM/FS，而是让它输出一段约定格式的 JSON 调用块，
// 我们在前端解析 → 执行 → 把结果作为新消息喂回去（最多 3 轮）。
// 这样和 SSE 流式天然兼容（不需要 provider 的 function-calling 协议），
// 5 家厂商行为一致，出错也容易降级成人话。

import { AI_MAX_WRITE_BYTES, checkAiPath, normalizeAiRel } from "./ai-paths";
import { formatSearchResult, searchProject } from "./ai-search";
import { hasAsyncIo, listDirQueued, readTextQueued } from "./native-async";
import { isJavaLikePath, parseOutline } from "./java-outline";
import { collectIds, clearIdCache, findUsages, formatUsages } from "./ai-usages";
import { formatJavaLint, lintJava } from "./java-lint";
import { clearResIndex } from "./res-index";
import { invalidateNativeProjectCache } from "./workspace";

export type AiToolName =
  | "list_files"
  | "read_file"
  | "outline"
  | "find_usages"
  | "check_java"
  | "write_file"
  | "apply_patch"
  | "search_files";

export interface AiPatchEdit {
  /** 要被替换的原片段（必须在文件里唯一出现） */
  old: string;
  /** 替换成什么 */
  new: string;
}

export interface AiToolCall {
  tool: AiToolName;
  /** 相对项目根的路径，如 app/src/main/res/layout/main.xml */
  path?: string;
  /** 目录，list_files/search_files 用 */
  dir?: string;
  /** 要写入的正文 */
  content?: string;
  /** apply_patch 的局部替换列表 */
  edits?: AiPatchEdit[];
  /** 搜索关键词 */
  query?: string;
  /** M67（C4）：read_file 从第几行开始（1 起） */
  offset?: number;
  /** M67（C4）：read_file 最多读多少行（默认整份，上限 400） */
  limit?: number;
  /** M68（C3）：find_usages 的资源符号，如 @string/app_name / R.id.btn / item_count */
  symbol?: string;
  /** M68（C3）：symbol 只给了名字时的类型提示（string/color/dimen/id/layout…） */
  type?: string;
}

export interface AiFileEntry {
  name: string;
  kind: "dir" | "file";
  rel: string;
}

export interface AiFileIo {
  /** 根目录人话名，用于提示模型路径怎么写 */
  rootLabel(): string;
  /** 能力标记：能不能写（UI 角标 + prompt 里是否提 write/patch） */
  canWrite?: boolean;
  /** 暂存模式（B3）：write 只登记不落盘，工具结果文案改成「已暂存」 */
  staging?: boolean;
  list(rel: string): Promise<{ ok: boolean; items?: AiFileEntry[]; error?: string }>;
  read(rel: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  /** M159：读二进制（图片等）→ base64；不支持的通道省略 */
  readBase64?(rel: string): Promise<{ ok: boolean; base64?: string; error?: string }>;
  write(
    rel: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string; note?: string; text?: string }>;
}

/** 追加到 system prompt 的能力说明（M64h/A4：格式收紧成 {tool,args} 一行 JSON） */
export const AI_TOOL_PROMPT = [
  "你可以读写当前项目的文件。需要时在回复里单独写一个代码块，语言标记为 axv-tool，内容必须是**一行** JSON，格式固定：",
  "```axv-tool",
  '{"tool":"read_file","args":{"path":"app/src/main/res/layout/main.xml"}}',
  "```",
  "可用工具（参数都放在 args 里）：",
  '- list_files {dir}：列目录（dir 省略=项目根）',
  '- read_file {path, offset?, limit?}：读文本文件（路径相对项目根）；大文件先给 offset/limit（1 起，limit≤400）只读目标方法',
  '- outline {path}：Java/Kotlin 大纲（类 + 方法 + 行号），改大文件前先看它，再 read_file 读那几行',
  '- find_usages {symbol, type?}：查资源引用（symbol 可写 @string/app_name / R.string.app_name / @+id/btn；只写名字时用 type 指定 string/color/dimen/id/layout），改或重命名资源前先用它看影响面',
  '- check_java {path}：Java/Kotlin 静态自检（括号/引号平衡、R.id 是否存在、缺 import、@Override 位置）。改完代码调一次；它只做静态检查、不是编译',
  '- apply_patch {path, edits:[{old,new}]}：局部替换——改已有文件只用这个；old 必须唯一，不唯一就先 read_file 取更长上下文',
  '- write_file {path, content}：**只能新建文件**；文件已存在会被拒，请改走 apply_patch',
  '- search_files {query, dir}：按文件名/内容关键词搜索',
  "格式要求（不遵守会被判为无效调用、直接不执行）：",
  "1. 整个块只有一行，不要注释、不要尾逗号、不要中文引号、不要 ``` 套娃。",
  "2. 一次回复最多 2 个 axv-tool 块；参数必须放在 args 对象里。",
  "3. 工具结果会以「工具结果」消息回给你，拿到后再回答用户；不要凭空猜文件内容。",
  "限制：路径相对项目根、不能跳出项目；构建类文件（build.gradle、settings.gradle、AndroidManifest.xml、build/、.git/ 等）默认只读；只能写文本源码/资源。",
].join("\n");



// 每次新建，避免 /g 正则的 lastIndex 状态串到下一次调用
const toolBlockRe = () => /```axv-tool\s*\n([\s\S]*?)```/g;

/** M73（D1）：原生 function calling 生效时的说明 —— 工具已在 tools 里，正文不要再写 JSON 块 */
export const AI_TOOL_PROMPT_NATIVE = [
  "你可以读写当前项目文件，工具已经通过 tools 提供（function calling）。",
  "需要工具时直接调用，不要在正文里写 ```axv-tool 代码块、也不要贴 JSON 参数说明。",
  "拿到工具结果后再回答我；不要凭空猜文件内容。",
  "限制：路径相对项目根、不能跳出项目；构建类文件（build.gradle、settings.gradle、AndroidManifest.xml、build/、.git/ 等）默认只读；只能写文本源码/资源。",
  "连续调用工具时，一步一步来（上一轮结果回来再决定下一步）。",
].join("\n");

/** 可用工具名（校验用） */
export const AI_TOOL_NAMES: AiToolName[] = [
  "list_files",
  "read_file",
  "outline",
  "find_usages",
  "check_java",
  "write_file",
  "apply_patch",
  "search_files",
];

export interface ParsedToolReply {
  calls: AiToolCall[];
  /** 每个失败块的**人话原因**（原样喂回模型让它改） */
  errors: string[];
  /** 出现了几个 axv-tool 块（含失败的） */
  blocks: number;
}

const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

/** 单个调用是否「可以执行」；返回 null = 合法，否则是缺什么 */
export function validateToolCall(c: AiToolCall): string | null {
  switch (c.tool) {
    case "list_files":
      return null;
    case "read_file":
      if (!c.path) return "缺 args.path";
      if (c.offset !== undefined && (!Number.isInteger(c.offset) || c.offset < 1)) return "offset 从 1 开始，必须是正整数";
      if (c.limit !== undefined && (!Number.isInteger(c.limit) || c.limit < 1)) return "limit 必须是正整数";
      if (c.limit !== undefined && c.limit > 400) return "limit 最多 400 行（大文件请分段读）";
      return null;
    case "outline":
      return c.path ? null : "缺 args.path";
    case "find_usages":
      if (!c.symbol) return "缺 args.symbol（如 @string/app_name 或 R.id.btn）";
      if (!c.type && !/^[@R]/.test(c.symbol)) return "只给名字时要带 args.type（string/color/dimen/id/layout…）";
      if (c.type && !/^[a-z_]+$/.test(c.type)) return "args.type 只能是小写字母/下划线";
      return null;
    case "check_java":
      if (!c.path) return "缺 args.path";
      return /\.(java|kt|kts)$/i.test(c.path) ? null : "check_java 只支持 .java/.kt/.kts 文件";
    case "search_files":
      return c.query ? null : "缺 args.query";
    case "write_file":
      if (!c.path) return "缺 args.path";
      return typeof c.content === "string" ? null : "缺 args.content（要写入的正文）";
    case "apply_patch":
      if (!c.path) return "缺 args.path";
      if (!c.edits || !c.edits.length) return "缺 args.edits（[{old,new}] 数组）";
      if (c.edits.length > 20) return "edits 最多 20 处";
      return null;
    default:
      return "未知工具";
  }
}

/**
 * M64h（A4）：解析工具块。
 * 以前 JSON.parse 失败就 `catch { /* 忽略 *\/ }`——调用凭空消失，模型以为执行了、用户什么也没看到。
 * 现在把「哪个块、错在哪」记下来，交给调用方重问一次。
 * 同时兼容旧的扁平写法 {"tool":"read_file","path":"a.xml"}（模型有时会退回去）。
 */
export function parseToolReply(reply: string): ParsedToolReply {
  const calls: AiToolCall[] = [];
  const errors: string[] = [];
  let blocks = 0;
  for (const m of (reply || "").matchAll(toolBlockRe())) {
    const raw = (m[1] || "").trim();
    blocks++;
    if (!raw) {
      errors.push(`第 ${blocks} 个 axv-tool 块是空的`);
      continue;
    }
    let j: unknown;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      const lines = raw.split("\n").filter((l) => l.trim()).length;
      const why = lines > 1 ? "（块里有多行内容；必须是单行 JSON）" : "";
      errors.push(`第 ${blocks} 个 axv-tool 块不是合法 JSON${why}：${(e as Error).message}`);
      continue;
    }
    if (!j || typeof j !== "object" || Array.isArray(j)) {
      errors.push(`第 ${blocks} 个 axv-tool 块不是 JSON 对象`);
      continue;
    }
    const o = j as Record<string, unknown>;
    const tool = typeof o.tool === "string" ? o.tool : "";
    if (!AI_TOOL_NAMES.includes(tool as AiToolName)) {
      errors.push(`第 ${blocks} 个块的 tool「${tool || "缺失"}」不在可用列表（${AI_TOOL_NAMES.join(" / ")}）`);
      continue;
    }
    // 新格式 {tool,args:{...}}；旧格式把参数平铺在顶层
    const args =
      o.args && typeof o.args === "object" && !Array.isArray(o.args) ? (o.args as Record<string, unknown>) : o;
    const call: AiToolCall = {
      tool: tool as AiToolName,
      path: asStr(args.path),
      dir: asStr(args.dir),
      content: asStr(args.content),
      query: asStr(args.query),
      symbol: asStr(args.symbol),
      type: asStr(args.type),
      offset: asNum(args.offset),
      limit: asNum(args.limit),
      edits: Array.isArray(args.edits)
        ? (args.edits as unknown[])
            .filter((e): e is { old: string; new: string } => {
              const x = e as { old?: unknown; new?: unknown } | null;
              return !!x && typeof x.old === "string" && typeof x.new === "string";
            })
            .map((e) => ({ old: e.old, new: e.new }))
        : undefined,
    };
    if (call.edits && !call.edits.length) call.edits = undefined;
    const bad = validateToolCall(call);
    if (bad) {
      errors.push(`第 ${blocks} 个块（${call.tool}）${bad}`);
      continue;
    }
    calls.push(call);
    if (calls.length >= 2) break;
  }
  return { calls, errors, blocks };
}

/** 老接口：只取可执行的调用（不关心错误）；新代码请用 parseToolReply */
export function extractToolCalls(reply: string): AiToolCall[] {
  return parseToolReply(reply).calls;
}

/** 把工具块从给用户看的正文里去掉 */
export function stripToolBlocks(reply: string): string {
  return reply.replace(toolBlockRe(), "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 防越界：规范化后不允许越出项目根（M64c/B4：统一走 ai-paths） */
export function safeRel(p: string | undefined): string | null {
  return normalizeAiRel(p);
}

const MAX_READ = 200 * 1024;

/** 执行一个工具调用，返回喂给模型的文本 */
/**
 * M72（C7）：写盘之后统一清缓存 —— 项目列表 / res 索引 / layout id。
 * 不清的话：AI 新建了 layout，项目面板还是旧的；改了 values，跳定义仍指向老行号。
 */
export function refreshAiCaches(io?: AiFileIo | null): void {
  try {
    invalidateNativeProjectCache();
  } catch {
    /* 浏览器环境没有原生缓存 */
  }
  try {
    clearResIndex();
  } catch {
    /* 同上 */
  }
  if (io) clearIdCache(io);
}

async function afterWrite(io: AiFileIo): Promise<void> {
  refreshAiCaches(io);
}

export async function runTool(call: AiToolCall, io: AiFileIo): Promise<string> {
  if (call.tool === "list_files") {
    const dir = checkAiPath(call.dir ?? "", { mode: "read" });
    if (!dir.ok) return `错误：${dir.error}`;
    const r = await io.list(dir.rel);
    if (!r.ok) return `错误：${r.error || "列目录失败"}`;
    const items = (r.items || []).slice(0, 200);
    if (!items.length) return `目录 ${dir.rel || "/"} 是空的`;
    const lines = items.map((it) => `${it.kind === "dir" ? "[目录] " : "      "}${it.rel}`);
    return `目录 ${dir.rel || "/"} 共 ${items.length} 项：\n${lines.join("\n")}`;
  }

  if (call.tool === "read_file") {
    const rel = checkAiPath(call.path, { mode: "read" });
    if (!rel.ok) return `错误：${rel.error}`;
    if (!rel.rel) return "错误：请指定要读的文件路径";
    const r = await io.read(rel.rel);
    if (!r.ok) return `错误：${r.error || "读取失败"}`;
    const text = r.text ?? "";

    // M67（C4）：Java 动辄上千行，整份读既费 token 又看不清结构 —— 支持按行段读，
    // 返回带行号的片段（行号便于模型接着写 offset/limit，也方便它算位置）。
    if (call.offset !== undefined || call.limit !== undefined) {
      const all = text.split("\n");
      const total = all.length;
      const start = Math.min(Math.max(1, call.offset ?? 1), Math.max(1, total));
      const count = Math.min(call.limit ?? 200, 400);
      const end = Math.min(total, start + count - 1);
      const slice = all.slice(start - 1, end);
      let body = slice.map((l, i) => `${start + i}| ${l}`).join("\n");
      let cut = "";
      if (body.length > MAX_READ) {
        body = body.slice(0, MAX_READ);
        cut = "\n<!-- 已截断 -->";
      }
      return `文件 ${rel.rel} 第 ${start}-${end} 行（共 ${total} 行）：\n\`\`\`\n${body}${cut}\n\`\`\`\n续读用 {offset:${end + 1}, limit:${count}}`;
    }

    const clipped = text.length > MAX_READ ? text.slice(0, MAX_READ) + "\n<!-- 已截断 -->" : text;
    const hint = text.split("\n").length > 400 ? `\n（共 ${text.split("\n").length} 行；建议先用 outline 看结构，再 offset/limit 读目标段落）` : "";
    return `文件 ${rel.rel}（${text.length} 字符）：\n\`\`\`\n${clipped}\n\`\`\`${hint}`;
  }

  // M67（C4）：Java/Kotlin 大纲 —— 先看类与方法行号，再定点读
  if (call.tool === "outline") {
    const rel = checkAiPath(call.path, { mode: "read" });
    if (!rel.ok) return `错误：${rel.error}`;
    if (!rel.rel) return "错误：请指定文件路径";
    if (!isJavaLikePath(rel.rel)) return `错误：outline 只支持 .java/.kt/.kts（${rel.rel} 不是）`;
    const r = await io.read(rel.rel);
    if (!r.ok) return `错误：${r.error || "读取失败"}`;
    const src = r.text ?? "";
    const isKt = /\.kts?$/i.test(rel.rel);
    const items = parseOutline(src, isKt).slice(0, 200);
    if (!items.length) return `文件 ${rel.rel} 里没解析出类/方法（${src.split("\n").length} 行）`;
    const lines = items.map((it) => `L${it.line} ${"  ".repeat(it.depth)}${it.kind === "class" ? "class " : ""}${it.name}${it.sig ? it.sig : ""}`);
    return `文件 ${rel.rel} 大纲（共 ${src.split("\n").length} 行，${items.length} 项）：\n${lines.join("\n")}\n改哪一块就用 read_file {path:"${rel.rel}", offset:行号, limit:该段行数}`;
  }

  if (call.tool === "check_java") {
    const path = (call.path || "").trim();
    const r = await io.read(path);
    if (!r.ok || typeof r.text !== "string") return `错误：${r.ok ? "读不到文件正文" : r.error}`;
    const isKotlin = /\.kts?$/i.test(path);
    const ids = isKotlin ? undefined : await collectIds(io);
    const issues = lintJava(r.text, { isKotlin, ids: ids || undefined });
    return formatJavaLint(issues, `${path} `);
  }
  // M68（C3）：资源引用 —— 改/改名之前先看会影响谁
  if (call.tool === "find_usages") {
    const res = await findUsages(io, call.symbol || "", call.type);
    return formatUsages(res);
  }

  if (call.tool === "write_file") {
    const rel = checkAiPath(call.path, { mode: "write" });
    if (!rel.ok) return `错误：${rel.error}`;
    if (typeof call.content !== "string") return "错误：缺 content 字段";
    // M64d（B6）：write_file 只用于新建，已存在的文件必须走 apply_patch
    const exists = await io.read(rel.rel);
    if (exists.ok) {
      return `错误：${rel.rel} 已存在，write_file 会整份覆盖、可能丢内容。要改已有文件请用 apply_patch {path, edits:[{old,new}]}。`;
    }
    const bytes = new TextEncoder().encode(call.content).length;
    if (bytes > AI_MAX_WRITE_BYTES) {
      return `错误：内容太大（${Math.round(bytes / 1024)}KB），单次写入上限 ${Math.round(AI_MAX_WRITE_BYTES / 1024)}KB`;
    }
    const r = await io.write(rel.rel, call.content);
    if (!r.ok) return `错误：${r.error || "写入失败"}`;
    await afterWrite(io);
    return io.staging
      ? `已暂存新建 ${rel.rel}（${call.content.length} 字符，等用户点「应用」才落盘）`
      : `已写入 ${rel.rel}（${call.content.length} 字符）${r.note || ""}`;
  }

  if (call.tool === "apply_patch") {
    const rel = checkAiPath(call.path, { mode: "write" });
    if (!rel.ok) return `错误：${rel.error}`;
    if (!rel.rel) return "错误：apply_patch 需要指定文件路径";
    const edits = call.edits || [];
    if (!edits.length) return "错误：edits 为空，给 [{old,new}] 数组（old 必须在文件里唯一出现）";
    if (edits.length > 20) return "错误：单次最多 20 处修改，分批来";
    const cur = await io.read(rel.rel);
    if (!cur.ok) return `错误：读不到 ${rel.rel}（不存在？新建请用 write_file）：${cur.error || ""}`;
    let text = cur.text ?? "";
    for (let i = 0; i < edits.length; i++) {
      const { old, new: neu } = edits[i];
      if (!old) return `错误：第 ${i + 1} 处 old 为空`;
      const first = text.indexOf(old);
      if (first < 0) return `错误：第 ${i + 1} 处没找到要替换的片段——先用 read_file 看清原文（含缩进/换行），old 要逐字对齐`;
      const second = text.indexOf(old, first + old.length);
      if (second >= 0) {
        return `错误：第 ${i + 1} 处 old 匹配到多处（不唯一），请带上更多上下文（整行或前后几行）再试`;
      }
      text = text.slice(0, first) + neu + text.slice(first + old.length);
    }
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > AI_MAX_WRITE_BYTES) {
      return `错误：修改后文件太大（${Math.round(bytes / 1024)}KB），超过 ${Math.round(AI_MAX_WRITE_BYTES / 1024)}KB 上限`;
    }
    const w = await io.write(rel.rel, text);
    if (!w.ok) return `错误：${w.error || "写入失败"}`;
    await afterWrite(io);
    return io.staging
      ? `已暂存修改 ${rel.rel}（${edits.length} 处，等用户点「应用」才落盘）`
      : `已修改 ${rel.rel}（${edits.length} 处）${w.note || ""}`;
  }

  // search_files（M64f/B5：预算 + 跳过产物目录 + 只匹配前 4KB + 每 25 次让出主线程）
  const dir = checkAiPath(call.dir ?? "", { mode: "read" });
  if (!dir.ok) return `错误：${dir.error}`;
  const q = (call.query || "").trim();
  if (!q) return "错误：缺 query";
  const res = await searchProject(io, q, { startDir: dir.rel });
  return formatSearchResult(res, q);
}

/* ================= 原生实现（APK） ================= */

interface NativeFsBridge {
  getDefaultWorkspace?(): string;
  listDir?(path: string): string | null;
  readText?(target: string): string | null;
  writeText?(target: string, base64: string): string;
  getWorkspaceInfo?(): string;
}

/** APK 里把相对路径映射到默认工作目录；越界由 Java 侧再兜一层 */
export function createNativeIo(projectRootRel?: string): AiFileIo | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AxvNative?: NativeFsBridge }).AxvNative;
  if (!b || typeof b.listDir !== "function" || typeof b.readText !== "function") return null;

  const root = b.getDefaultWorkspace?.() || "";
  const rootPath = projectRootRel ? `${root}/${projectRootRel}`.replace(/\/+/g, "/") : root;

  const abs = (rel: string) => (rel ? `${rootPath}/${rel}`.replace(/\/+/g, "/") : rootPath);

  return {
    rootLabel: () => rootPath,
    canWrite: typeof b.writeText === "function",
    async list(rel) {
      const json = hasAsyncIo() ? await listDirQueued(abs(rel)) : b.listDir?.(abs(rel));
      if (!json) return { ok: false, error: "listDir 不可用（APK 版本过旧）" };
      try {
        const o = JSON.parse(json) as { ok?: boolean; items?: { name: string; kind: string; path: string }[] };
        if (!o.ok) return { ok: false, error: "目录不可读（可能没给「所有文件访问」权限）" };
        const items: AiFileEntry[] = (o.items || []).map((it) => ({
          name: it.name,
          kind: it.kind === "dir" ? "dir" : "file",
          rel: rel ? `${rel}/${it.name}` : it.name,
        }));
        return { ok: true, items };
      } catch {
        return { ok: false, error: "返回格式异常" };
      }
    },
    async read(rel) {
      const t = hasAsyncIo() ? await readTextQueued(abs(rel)) : b.readText?.(abs(rel));
      if (t === null || t === undefined) return { ok: false, error: "读不到（不存在或没有权限）" };
      return { ok: true, text: t };
    },
    async write(rel, text) {
      if (typeof b.writeText !== "function") return { ok: false, error: "writeText 不可用（APK 版本过旧）" };
      const b64 = toBase64Utf8(text);
      const r = b.writeText(abs(rel), b64);
      if (typeof r === "string" && r.startsWith("ok")) return { ok: true };
      return { ok: false, error: (r || "err:未知").replace(/^err:/, "") };
    },
  };
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
