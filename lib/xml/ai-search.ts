// lib/xml/ai-search.ts — M64f（B5）：项目内搜索要有预算，否则手机上直接卡死
//
// 原来的 search_files：深度 6、每个文本文件整份 readText 再 includes、没有访次/命中上限，
// 3000 个文件的项目一次搜索能把 WebView 卡住十几秒（还是同步 JNI）。
// 这里收口成纯逻辑 + 预算，runTool 只负责把它接到 io 上。

import type { AiFileEntry, AiFileIo } from "./ai-tools";

export interface SearchHit {
  kind: "dir" | "file" | "content";
  rel: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 实际访问次数（list + read） */
  visits: number;
  /** 是否因为预算提前收工 */
  truncated: boolean;
}

export interface SearchOpts {
  /** 起始目录（默认项目根） */
  startDir?: string;
  maxVisits?: number;
  maxHits?: number;
  maxDepth?: number;
  /** 内容匹配只看前 N 个字符（避免大文件构建巨型小写串） */
  headChars?: number;
  /** 每访问多少次让出一次主线程 */
  yieldEvery?: number;
}

export const SEARCH_BUDGET = {
  maxVisits: 600,
  maxHits: 40,
  maxDepth: 6,
  headChars: 4096,
  yieldEvery: 25,
};

/** 只有这些扩展名才做「内容匹配」（二进制/图片一律跳过） */
export const SEARCH_TEXT_EXT = /\.(xml|json|java|kt|kts|gradle|properties|txt|md|pro|toml|yml|yaml|html|js|ts|css)$/i;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function searchProject(io: AiFileIo, query: string, opts: SearchOpts = {}): Promise<SearchResult> {
  const q = query.toLowerCase().trim();
  const maxVisits = opts.maxVisits ?? SEARCH_BUDGET.maxVisits;
  const maxHits = opts.maxHits ?? SEARCH_BUDGET.maxHits;
  const maxDepth = opts.maxDepth ?? SEARCH_BUDGET.maxDepth;
  const headChars = opts.headChars ?? SEARCH_BUDGET.headChars;
  const yieldEvery = opts.yieldEvery ?? SEARCH_BUDGET.yieldEvery;

  const hits: SearchHit[] = [];
  let visits = 0;
  let truncated = false;

  const done = () => hits.length >= maxHits || visits >= maxVisits;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (done() || depth > maxDepth) return;
    visits++;
    if (visits % yieldEvery === 0) await yieldToUi();
    const r = await io.list(rel);
    if (!r.ok) return;
    const items: AiFileEntry[] = r.items || [];
    for (const it of items) {
      if (done()) {
        truncated = true;
        return;
      }
      if (it.kind === "dir") {
        // 产物/依赖目录不进去（保护区同一套名字）
        if (/^(build|\.gradle|\.git|\.idea|node_modules|\.next|\.cxx)$/i.test(it.name)) continue;
        if (it.name.toLowerCase().includes(q)) hits.push({ kind: "dir", rel: it.rel });
        await walk(it.rel, depth + 1);
        continue;
      }
      if (it.name.toLowerCase().includes(q)) {
        hits.push({ kind: "file", rel: it.rel });
        continue;
      }
      if (!SEARCH_TEXT_EXT.test(it.name)) continue;
      if (done()) {
        truncated = true;
        return;
      }
      visits++;
      if (visits % yieldEvery === 0) await yieldToUi();
      const rr = await io.read(it.rel);
      if (!rr.ok) continue;
      const head = (rr.text || "").slice(0, headChars).toLowerCase();
      if (head.includes(q)) hits.push({ kind: "content", rel: it.rel });
    }
    if (hits.length >= maxHits) truncated = true;
  };

  await walk(opts.startDir ?? "", 0);
  if (visits >= maxVisits) truncated = true;
  return { hits, visits, truncated };
}

/** 给模型看的结果文本（带预算说明，避免它以为「没找到」= 项目里没有） */
export function formatSearchResult(res: SearchResult, query: string): string {
  if (!res.hits.length) return `没找到包含「${query}」的文件（已扫 ${res.visits} 处）`;
  const label = { dir: "[目录]", file: "[文件名]", content: "[内容]" } as const;
  const lines = res.hits.map((h) => `${label[h.kind]} ${h.rel}`);
  const tail = res.truncated ? `\n（已达搜索上限，结果可能不全：可加 dir 参数缩小范围）` : "";
  return `找到 ${res.hits.length} 项（扫了 ${res.visits} 处）：\n${lines.join("\n")}${tail}`;
}
