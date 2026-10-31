// lib/xml/ai-tools.ts
// AI 的「读写查文件」能力。
// 做法：不让模型直接动 DOM/FS，而是让它输出一段约定格式的 JSON 调用块，
// 我们在前端解析 → 执行 → 把结果作为新消息喂回去（最多 3 轮）。
// 这样和 SSE 流式天然兼容（不需要 provider 的 function-calling 协议），
// 5 家厂商行为一致，出错也容易降级成人话。

export type AiToolName = "list_files" | "read_file" | "write_file" | "search_files";

export interface AiToolCall {
  tool: AiToolName;
  /** 相对项目根的路径，如 app/src/main/res/layout/main.xml */
  path?: string;
  /** 目录，list_files/search_files 用 */
  dir?: string;
  /** 要写入的正文 */
  content?: string;
  /** 搜索关键词 */
  query?: string;
}

export interface AiFileEntry {
  name: string;
  kind: "dir" | "file";
  rel: string;
}

export interface AiFileIo {
  /** 根目录人话名，用于提示模型路径怎么写 */
  rootLabel(): string;
  list(rel: string): Promise<{ ok: boolean; items?: AiFileEntry[]; error?: string }>;
  read(rel: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  write(rel: string, text: string): Promise<{ ok: boolean; error?: string }>;
}

/** 追加到 system prompt 的能力说明 */
export const AI_TOOL_PROMPT = [
  "你可以读写当前项目的文件。需要时在回复里单独写一个代码块，语言标记为 axv-tool，内容是一行 JSON：",
  "```axv-tool",
  '{"tool":"list_files","dir":"app/src/main/res/layout"}',
  "```",
  "可用工具：",
  '- list_files {dir}：列目录（dir 省略=项目根）',
  '- read_file {path}：读文本文件（路径相对项目根）',
  '- write_file {path,content}：写文件（整文件覆盖，写前先用 read_file 看清内容）',
  '- search_files {query,dir}：按文件名/内容关键词搜索',
  "规则：一次回复最多 2 个工具调用；工具结果会以「工具结果」消息回给你，拿到后再回答用户；不要凭空猜文件内容。",
].join("\n");



// 每次新建，避免 /g 正则的 lastIndex 状态串到下一次调用
const toolBlockRe = () => /```axv-tool\s*\n([\s\S]*?)```/g;

/** 抽出回复里的工具调用块 */
export function extractToolCalls(reply: string): AiToolCall[] {
  const out: AiToolCall[] = [];
  for (const m of reply.matchAll(toolBlockRe())) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as Partial<AiToolCall>;
      if (!j || typeof j.tool !== "string") continue;
      const tool = j.tool as AiToolName;
      if (!["list_files", "read_file", "write_file", "search_files"].includes(tool)) continue;
      out.push({
        tool,
        path: typeof j.path === "string" ? j.path : undefined,
        dir: typeof j.dir === "string" ? j.dir : undefined,
        content: typeof j.content === "string" ? j.content : undefined,
        query: typeof j.query === "string" ? j.query : undefined,
      });
      if (out.length >= 2) break;
    } catch {
      /* 不是合法 JSON，忽略 */
    }
  }
  return out;
}

/** 把工具块从给用户看的正文里去掉 */
export function stripToolBlocks(reply: string): string {
  return reply.replace(toolBlockRe(), "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 防越界：不允许 .. 或绝对路径 */
export function safeRel(p: string | undefined): string | null {
  const s = (p ?? "").replace(/\\/g, "/").trim();
  if (s.includes("..")) return null;
  if (s.startsWith("/") || /^[a-zA-Z]:/.test(s)) return null;
  return s.replace(/^\.\//, "").replace(/^\/+/, "");
}

const MAX_READ = 200 * 1024;

/** 执行一个工具调用，返回喂给模型的文本 */
export async function runTool(call: AiToolCall, io: AiFileIo): Promise<string> {
  if (call.tool === "list_files") {
    const dir = safeRel(call.dir ?? "");
    if (dir === null) return "错误：路径非法";
    const r = await io.list(dir);
    if (!r.ok) return `错误：${r.error || "列目录失败"}`;
    const items = (r.items || []).slice(0, 200);
    if (!items.length) return `目录 ${dir || "/"} 是空的`;
    const lines = items.map((it) => `${it.kind === "dir" ? "[目录] " : "      "}${it.rel}`);
    return `目录 ${dir || "/"} 共 ${items.length} 项：\n${lines.join("\n")}`;
  }

  if (call.tool === "read_file") {
    const rel = safeRel(call.path);
    if (!rel) return "错误：路径非法（不能是绝对路径或含 ..）";
    const r = await io.read(rel);
    if (!r.ok) return `错误：${r.error || "读取失败"}`;
    const text = r.text ?? "";
    const clipped = text.length > MAX_READ ? text.slice(0, MAX_READ) + "\n<!-- 已截断 -->" : text;
    return `文件 ${rel}（${text.length} 字符）：\n\`\`\`\n${clipped}\n\`\`\``;
  }

  if (call.tool === "write_file") {
    const rel = safeRel(call.path);
    if (!rel) return "错误：路径非法（不能是绝对路径或含 ..）";
    if (typeof call.content !== "string") return "错误：缺 content 字段";
    const r = await io.write(rel, call.content);
    if (!r.ok) return `错误：${r.error || "写入失败"}`;
    return `已写入 ${rel}（${call.content.length} 字符）`;
  }

  // search_files
  const dir = safeRel(call.dir ?? "");
  if (dir === null) return "错误：路径非法";
  const q = (call.query || "").toLowerCase().trim();
  if (!q) return "错误：缺 query";

  const hits: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 6 || hits.length >= 30) return;
    const r = await io.list(rel);
    if (!r.ok) return;
    for (const it of r.items || []) {
      if (hits.length >= 30) return;
      if (it.kind === "dir") {
        if (it.name.toLowerCase().includes(q)) hits.push(`[目录] ${it.rel}`);
        await walk(it.rel, depth + 1);
      } else if (it.name.toLowerCase().includes(q)) {
        hits.push(`[文件名] ${it.rel}`);
      } else if (/\.(xml|json|java|kt|gradle|properties|txt|md)$/i.test(it.name)) {
        const rr = await io.read(it.rel);
        if (rr.ok && (rr.text || "").toLowerCase().includes(q)) hits.push(`[内容] ${it.rel}`);
      }
    }
  };
  await walk(dir, 0);
  if (!hits.length) return `没找到包含「${call.query}」的文件`;
  return `找到 ${hits.length} 项：\n${hits.join("\n")}`;
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
    async list(rel) {
      const json = b.listDir?.(abs(rel));
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
      const t = b.readText?.(abs(rel));
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
