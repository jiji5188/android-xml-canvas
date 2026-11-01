// lib/xml/ai-chat-store.ts — M75：AI 对话按文件持久化
//
// 之前 chat 只存在 useState 里：关掉面板、切个文件、刷新页面，整段对话就没了 ——
// 工具已经跑过的结论、模型刚给的解释，全得重新问一遍（还费 token）。
//
// 这里只做「可序列化的快照」：工具输出截断、流式中间态丢掉、running 改 stopped，
// 再按条数和字节双重预算截断（localStorage 一般 5MB，不能一个文件就吃掉一半）。
import type { ChatItemLike } from "./ai-chat-types";

export interface ChatStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 每个文件最多留多少条消息（user + assistant 合计） */
export const CHAT_CAP = 30;
/** 单条工具输出最多留多少字符（展开还能看个大概） */
export const CHAT_OUT_MAX = 600;
/** 单个文件的对话快照字节预算（UTF-16 下按字符数近似） */
export const CHAT_BYTES = 160_000;
/** 快照格式版本，将来改结构好识别 */
const CHAT_VER = 1;

/** 键名：一个文件一个桶；rel 里的斜杠换成 ~ 防止和别的键撞 */
export function chatKey(rel: string): string {
  const safe = (rel || "").replace(/[\\/]+/g, "~").replace(/[^\w~.\-\u4e00-\u9fa5]/g, "_");
  return `axv.ai.chat.v${CHAT_VER}:${safe}`;
}

/**
 * 把界面上的一轮对话压成可存的样子。
 * - 还在流式的消息丢掉（半截内容没价值）
 * - 工具调用 running → stopped（下次打开不能停在转圈）
 * - 工具输出截断到 CHAT_OUT_MAX
 * - 空的 assistant 占位（只有工具行）保留，但去掉空 content 的纯空气泡
 */
export function sanitizeChat<T extends ChatItemLike>(items: T[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (it.streaming) continue;
    const tool = it.tool
      ? {
          ...it.tool,
          state: it.tool.state === "running" ? ("stopped" as const) : it.tool.state,
          out: typeof it.tool.out === "string" ? it.tool.out.slice(0, CHAT_OUT_MAX) : undefined,
        }
      : undefined;
    const content = typeof it.content === "string" ? it.content : "";
    if (!content.trim() && !tool && !it.code) continue;
    out.push({ ...it, streaming: undefined, tool });
  }
  // 只留最后 CHAT_CAP 条
  return out.length > CHAT_CAP ? out.slice(out.length - CHAT_CAP) : out;
}

/** 按字节预算再砍一批（从最老的开始丢，保证最后一条一定在） */
export function capByBytes<T>(items: T[], max = CHAT_BYTES): T[] {
  let list = items;
  let size = JSON.stringify(list).length;
  while (list.length > 1 && size > max) {
    list = list.slice(1);
    size = JSON.stringify(list).length;
  }
  return list;
}

/** 序列化（写库前最后一步） */
export function encodeChat<T extends ChatItemLike>(items: T[], max = CHAT_BYTES): string {
  return JSON.stringify(capByBytes(sanitizeChat(items), max));
}

/** 反序列化：坏数据/旧版本一律当空，绝不让面板挂掉 */
export function decodeChat(raw: string | null): ChatItemLike[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    const out: ChatItemLike[] = [];
    for (const it of p) {
      if (!it || typeof it !== "object") continue;
      const role = it.role === "assistant" || it.role === "user" ? it.role : null;
      if (!role) continue;
      out.push({
        role,
        content: typeof it.content === "string" ? it.content : "",
        code: typeof it.code === "string" ? it.code : it.code === null ? null : undefined,
        codeTag: typeof it.codeTag === "string" ? it.codeTag : undefined,
        canReplace: typeof it.canReplace === "boolean" ? it.canReplace : undefined,
        tool:
          it.tool && typeof it.tool === "object" && typeof it.tool.name === "string"
            ? {
                name: it.tool.name,
                target: typeof it.tool.target === "string" ? it.tool.target : "",
                state: it.tool.state === "error" || it.tool.state === "stopped" ? it.tool.state : "done",
                out: typeof it.tool.out === "string" ? it.tool.out : undefined,
                ms: Number.isFinite(it.tool.ms) ? it.tool.ms : undefined,
              }
            : undefined,
      });
    }
    return out.slice(-CHAT_CAP);
  } catch {
    return [];
  }
}

/** 读某个文件的对话 */
export function loadChatFor(store: ChatStore, rel: string): ChatItemLike[] {
  if (!rel) return [];
  try {
    return decodeChat(store.getItem(chatKey(rel)));
  } catch {
    return [];
  }
}

/** 存某个文件的对话（写失败如超配额时不抛，只放弃持久化） */
export function saveChatFor(store: ChatStore, rel: string, items: ChatItemLike[]): boolean {
  if (!rel) return false;
  try {
    const text = encodeChat(items);
    store.setItem(chatKey(rel), text);
    return true;
  } catch {
    return false;
  }
}

/** 清掉某个文件的对话 */
export function clearChatFor(store: ChatStore, rel: string): void {
  if (!rel) return;
  try {
    store.removeItem(chatKey(rel));
  } catch {
    /* 忽略 */
  }
}
