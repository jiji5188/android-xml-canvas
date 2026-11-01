// lib/xml/ai-usages.ts — M68（C3）：资源引用「用在哪」
//
// 改了 strings.xml 里一条文案，到底哪些布局/代码会跟着变？以前只能靠人肉 grep。
// 这里把「一个资源符号 → 全项目引用位置」做成带预算的扫描（手机上一次全树 grep 很容易卡住）：
//   - 符号可写成 @string/app_name、R.string.app_name、@+id/btn、item_count（+ type）四种
//   - 同时匹配 XML 侧 @string/x 与代码侧 R.string.x（id 还有 @id/x、@+id/x）
//   - 只扫文本类扩展名，跳过 build/.git 等目录，访次/命中/深度都有上限
// 行号与片段一并返回，给 UI 的「引用」列表和 AI 工具共用。

import type { AiFileEntry, AiFileIo } from "./ai-tools";

export interface UsageHit {
  rel: string;
  /** 1 起行号 */
  line: number;
  /** 该行去掉首尾空白后的片段（过长会截断） */
  text: string;
}

export interface UsageResult {
  /** 归一化后的符号，如 string/app_name */
  symbol: string;
  hits: UsageHit[];
  /** 实际读了几个文件 */
  files: number;
  /** 是否因预算/命中上限提前收工 */
  truncated: boolean;
}

export interface UsageOpts {
  maxHits?: number;
  maxFiles?: number;
  maxVisits?: number;
  maxDepth?: number;
  /** 优先扫的目录（比如当前布局所在目录），剩下的再全树 */
  firstDir?: string;
  yieldEvery?: number;
}

export const USAGE_BUDGET = {
  maxHits: 60,
  maxFiles: 400,
  maxVisits: 1200,
  maxDepth: 8,
  yieldEvery: 20,
  snippetChars: 160,
};

/** 只对文本源码做内容扫描 */
const TEXT_EXT = /\.(xml|java|kt|kts|json|gradle|properties|txt|md|pro|toml|yml|yaml|html|js|ts|css)$/i;

const SKIP_DIR = /^(\.git|\.gradle|\.idea|\.next|node_modules|build|out|dist|\.cxx|\.kotlin)$/i;

export interface ParsedSymbol {
  type: string;
  name: string;
}

/** 把各种写法归一成 {type, name}；认不出返回 null */
export function parseUsageSymbol(raw: string, typeHint?: string): ParsedSymbol | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let type = (typeHint || "").trim();
  let name = s;

  // @string/app_name  @+id/btn  @android:string/ok  ?attr/x
  const at = /^@\+?(?:(?:[\w.]+):)?([a-z_]+)\/([\w.]+)$/.exec(s);
  if (at) {
    type = at[1];
    name = at[2];
  } else {
    // R.string.app_name / R.id.btn
    const r = /^R\.([a-z_]+)\.([\w.]+)$/.exec(s);
    if (r) {
      type = r[1];
      name = r[2];
    }
  }
  name = name.replace(/^.*[./]/, "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  if (!type) return null;
  if (!/^[a-z_]+$/.test(type)) return null;
  return { type: type === "attr" ? "attr" : type, name };
}

/** 生成匹配该符号的正则（XML 引用 + 代码资源访问） */
export function usagePatterns(sym: ParsedSymbol): RegExp[] {
  const name = sym.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const type = sym.type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = "(?![A-Za-z0-9_])";
  const pats = [
    // @string/app_name（允许 @android:string/ 前缀；id 允许 @+id/）
    new RegExp(`@(?:\\+)?(?:[a-z0-9_.]+:)?${type}/${name}${end}`),
    // R.string.app_name，允许带包名的全限定 R
    new RegExp(`\\bR\\.${type}\\.${name}${end}`),
  ];
  // id 还常在 XML 里直写 @id/x 之外用 @+id/x 定义，已经在上面覆盖；layout 有时用 @layout/x
  return pats;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** 扫描命中行；hits 会按 rel/line 去重排序 */
export async function findUsages(
  io: AiFileIo,
  raw: string,
  typeHint?: string,
  opts: UsageOpts = {},
): Promise<UsageResult> {
  const sym = parseUsageSymbol(raw, typeHint);
  if (!sym) return { symbol: raw.trim(), hits: [], files: 0, truncated: false };

  const maxHits = opts.maxHits ?? USAGE_BUDGET.maxHits;
  const maxFiles = opts.maxFiles ?? USAGE_BUDGET.maxFiles;
  const maxVisits = opts.maxVisits ?? USAGE_BUDGET.maxVisits;
  const maxDepth = opts.maxDepth ?? USAGE_BUDGET.maxDepth;
  const yieldEvery = opts.yieldEvery ?? USAGE_BUDGET.yieldEvery;
  const pats = usagePatterns(sym);

  const hits: UsageHit[] = [];
  const seen = new Set<string>();
  let files = 0;
  let visits = 0;
  let truncated = false;

  const over = () => hits.length >= maxHits || files >= maxFiles || visits >= maxVisits;

  const scanFile = async (rel: string): Promise<void> => {
    if (over()) return;
    if (!TEXT_EXT.test(rel)) return;
    visits++;
    files++;
    const r = await io.read(rel);
    if (!r.ok || typeof r.text !== "string") return;
    const lines = r.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let hitLine = false;
      for (const p of pats) {
        p.lastIndex = 0;
        if (p.test(line)) {
          hitLine = true;
          break;
        }
      }
      if (!hitLine) continue;
      const key = `${rel}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = line.trim().slice(0, USAGE_BUDGET.snippetChars);
      hits.push({ rel, line: i + 1, text });
      if (hits.length >= maxHits) {
        truncated = true;
        return;
      }
    }
  };

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (over() || depth > maxDepth) return;
    visits++;
    const r = await io.list(rel);
    if (!r.ok) return;
    const items: AiFileEntry[] = (r.items || []).slice(0, 400);
    for (const it of items) {
      if (over()) return;
      if (visits % yieldEvery === 0) await yieldToUi();
      if (it.kind === "dir") {
        const base = it.rel.split("/").pop() || it.name;
        if (SKIP_DIR.test(base)) continue;
        await walk(it.rel, depth + 1);
      } else {
        await scanFile(it.rel);
      }
    }
  };

  // 先扫优先目录（如当前 layout 所在目录），再全树
  if (opts.firstDir) {
    await walk(opts.firstDir, maxDepth);
  }
  if (!over()) await walk("", 0);

  hits.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel)));
  return { symbol: `${sym.type}/${sym.name}`, hits, files, truncated };
}

/**
 * M70（C2）：项目里真实存在的 id 名（不含 @+id/ 前缀）。
 * 给 java-lint 校验 R.id.xxx 用；同一个 io 只扫一次（WeakMap 缓存）。
 */
const idCache = new WeakMap<object, Promise<Set<string>>>();

export function collectIds(io: AiFileIo, opts: { maxFiles?: number } = {}): Promise<Set<string>> {
  const key = io as unknown as object;
  const hit = idCache.get(key);
  if (hit) return hit;
  const job = collectIdsInner(io, opts).catch(() => new Set<string>());
  idCache.set(key, job);
  return job;
}

export function clearIdCache(io: AiFileIo): void {
  idCache.delete(io as unknown as object);
}

async function collectIdsInner(io: AiFileIo, opts: { maxFiles?: number }): Promise<Set<string>> {
  const ids = new Set<string>();
  const maxFiles = opts.maxFiles ?? 400;
  const queue: string[] = [""];
  let files = 0;
  let visits = 0;
  while (queue.length && files < maxFiles && visits < USAGE_BUDGET.maxVisits) {
    const dir = queue.shift() as string;
    visits++;
    const res = await io.list(dir);
    if (!res.ok) continue;
    for (const it of res.items || []) {
      if (it.kind === "dir") {
        if (SKIP_DIR.test(it.name)) continue;
        queue.push(it.rel);
        continue;
      }
      if (!/\/res\/layout[^/]*\/[^/]+\.xml$/.test(it.rel)) continue;
      files++;
      const r = await io.read(it.rel);
      if (r.ok && typeof r.text === "string") {
        for (const m of r.text.matchAll(/@\+?id\/([A-Za-z_]\w*)/g)) ids.add(m[1]);
      }
      if (files >= maxFiles) break;
    }
  }
  return ids;
}

/** 喂给 AI 的纯文本结果 */
export function formatUsages(res: UsageResult): string {
  const head = res.hits.length
    ? `${res.symbol} 共 ${res.hits.length} 处引用（扫描 ${res.files} 个文件${res.truncated ? "，已达上限" : ""}）：`
    : `没有找到 ${res.symbol} 的引用（扫描 ${res.files} 个文件${res.truncated ? "，已达上限" : ""}）`;
  if (!res.hits.length) return head;
  const body = res.hits.map((h) => `${h.rel}:${h.line}  ${h.text}`).join("\n");
  const warn = "改动这条资源会影响上面所有位置；如果是改名，记得同步这些引用。";
  return `${head}\n${body}\n${warn}`;
}
