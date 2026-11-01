// lib/xml/ai-chat-types.ts — M75：对话快照的最小结构（避免 AiPanel ↔ 存储模块循环引用）
export type ChatToolState = "running" | "done" | "error" | "stopped";

export interface ChatToolLike {
  name: string;
  target: string;
  state: ChatToolState;
  out?: string;
  ms?: number;
}

export interface ChatItemLike {
  role: "user" | "assistant";
  content: string;
  /** 回复里抠出来的代码块 */
  code?: string | null;
  codeTag?: string;
  canReplace?: boolean;
  /** 只存在于内存，存库前会被丢掉 */
  streaming?: boolean;
  tool?: ChatToolLike;
}
