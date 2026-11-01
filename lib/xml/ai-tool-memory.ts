// lib/xml/ai-tool-memory.ts — M64k（A7）：把「读过什么、搜到什么」记住
//
// 原来工具结果只活在那一轮的 msgs 里，setChat 只存模型那句说明。
// 于是你追问「刚才那个文件第 3 行是什么」，它只能说「我没看到」——上一轮的 read 已经没了。
// 这里维护一个会话内的工具记忆：最近 2 条保留全文（有上限），更早的压成一行摘要。

export interface ToolMemoryEntry {
  /** read_file / search_files / list_files / apply_patch … */
  tool: string;
  /** a.xml / "foo" / res/ 这类目标 */
  target: string;
  /** 工具输出的正文（只在最近几条里用得到） */
  text: string;
  /** 行数（read 用），没有就不填 */
  lines?: number;
  /** 落库时间（用于排序/裁剪） */
  at: number;
}

export const TOOL_MEMORY = {
  /** 最多记几条 */
  max: 10,
  /** 最近几条保留全文 */
  fullRecent: 2,
  /** 每条全文最多多少字符 */
  maxChars: 1500,
  /** 更早的摘要最多列几条 */
  maxOlder: 6,
};

/** 追加一条（同一个文件重复读 → 用新的覆盖旧的，避免占满） */
export function pushToolMemory(
  list: ToolMemoryEntry[],
  entry: Omit<ToolMemoryEntry, "at"> & { at?: number },
  max = TOOL_MEMORY.max,
): ToolMemoryEntry[] {
  const next = list.filter((e) => !(e.tool === entry.tool && e.target === entry.target));
  next.push({ ...entry, at: entry.at ?? Date.now() });
  return next.slice(-max);
}

/** 一行摘要：read a.xml（120 行）/ search "foo" → 3 处 */
export function toolMemoryOneLine(e: ToolMemoryEntry): string {
  if (e.tool === "read_file") return `read ${e.target}（${e.lines ?? countLines(e.text)} 行）`;
  if (e.tool === "search_files") return `search ${e.target} → ${countHits(e.text)} 处`;
  if (e.tool === "list_files") return `list ${e.target} → ${countLines(e.text)} 项`;
  if (e.tool === "apply_patch") return `patch ${e.target}`;
  if (e.tool === "write_file") return `write ${e.target}`;
  return `${e.tool} ${e.target}`;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function countHits(text: string): number {
  const m = text.match(/共\s*(\d+)\s*处/);
  if (m) return Number(m[1]);
  return text.split("\n").filter((l) => l.trim()).length;
}

/**
 * 拼进 system prompt 的一段「之前读过什么」。
 * 最近 2 条给全文（便于直接引用），更早的只给一行摘要，避免 prompt 越聊越大。
 */
export function formatToolMemory(list: ToolMemoryEntry[], opts = TOOL_MEMORY): string {
  if (!list.length) return "";
  const recent = list.slice(-opts.fullRecent);
  const older = list.slice(0, Math.max(0, list.length - opts.fullRecent)).slice(-opts.maxOlder);
  const parts: string[] = ["本次会话已经读过的内容（不用再读一遍，直接引用即可）："];
  if (older.length) {
    parts.push("更早的记录（只留摘要，需要细节再 read_file）：");
    for (const e of older) parts.push(`- ${toolMemoryOneLine(e)}`);
  }
  for (const e of recent) {
    const body = e.text.length > opts.maxChars ? e.text.slice(0, opts.maxChars) + "\n…（已截断）" : e.text;
    parts.push(`【${toolMemoryOneLine(e)}】\n${body}`);
  }
  return parts.join("\n");
}

/** 从一次 runTool 的输出里抠出正文和目标（供 AiPanel 记录） */
export function memoryEntryFromTool(tool: string, target: string, out: string): ToolMemoryEntry {
  return { tool, target, text: out, at: Date.now(), lines: tool === "read_file" ? countLines(out) : undefined };
}
