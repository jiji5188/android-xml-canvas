// lib/xml/ai-log.ts — M148：AI 调试日志（中间过程只进这里，不进聊天框）
//
// 需求：主聊天框只显示「用户提问 + 最终回答」；system 提示、工具调用、
// 工具返回、模型原始输出、错误全部落在独立的小日志面板里，彩条区分类型。
//
// 这里只放纯函数 + 常量，React 状态由 AiPanel 持有（不依赖 React，可单测）。

export type LogKind = "system" | "tool_call" | "tool_result" | "model_raw" | "error" | "info";

export interface LogEntry {
  id: number;
  /** 时间戳（ms） */
  at: number;
  kind: LogKind;
  text: string;
}

/** 日志面板上的类型名（显示时再套 tt()） */
export const LOG_KIND_LABEL: Record<LogKind, string> = {
  system: "系统提示",
  tool_call: "工具调用",
  tool_result: "工具返回",
  model_raw: "模型输出",
  error: "错误",
  info: "流程",
};

/** 单条日志字符上限：整份 system 提示可能有几万字，全存进去会把状态树撑爆 */
export const LOG_ENTRY_MAX = 8000;

/** 最多留多少条（超出丢最旧的） */
export const LOG_MAX_ENTRIES = 600;

/** 工具单次执行超时（需求：8 秒；超时写红日志并继续，不卡死整个会话） */
export const TOOL_TIMEOUT_MS = 8000;

export const LS_KEY_MAX_ROUNDS = "axv.ai.maxRounds";

export const DEFAULT_MAX_ROUNDS = 10;

/** 轮数上限：1~50，存 localStorage（读坏了就回默认值） */
export function loadMaxRounds(raw: string | null): number {
  // 注意：Number(null) === 0、Number("") === 0 —— 直接 Number() 会把「没存过」当成 0
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_MAX_ROUNDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROUNDS;
  return Math.min(50, Math.max(1, Math.round(n)));
}

/** 截断单条日志（保留前 N 字符 + 注明总长度） */
export function clipLog(text: string, max = LOG_ENTRY_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（共 ${text.length} 字符，已截断）`;
}

/** 追加一条日志，超出容量丢最旧的 */
export function pushLogEntry(list: LogEntry[], entry: LogEntry, max = LOG_MAX_ENTRIES): LogEntry[] {
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 导出成纯文本（「复制全部日志」用） */
export function formatLogs(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const t = new Date(e.at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const ss = String(t.getSeconds()).padStart(2, "0");
      return `[${hh}:${mm}:${ss}] ${e.kind}\n${e.text}`;
    })
    .join("\n\n");
}

/** 给任意 promise 加超时：超时返回 {ok:false}，不抛异常（工具超时不能炸掉整个会话） */
export async function runWithTimeout<T>(
  p: Promise<T>,
  ms = TOOL_TIMEOUT_MS,
): Promise<{ ok: true; value: T } | { ok: false; timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<{ ok: false; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
  });
  try {
    const r = await Promise.race([p.then((value) => ({ ok: true as const, value })), timeout]);
    return r;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 幻觉检测：模型把「整段对话」当正文吐回来。
 *
 * 典型形状（都是真实见过的）：
 *   1. `[{"role":"user","content":"…"},{"role":"assistant","content":"…"}]`
 *   2. `<|im_start|>user … <|im_end|>`
 *   3. `Human: …\nAssistant: …`
 *
 * 只认强特征，避免把正常 XML / JSON（里面也有 "role" 字面量）误判成幻觉。
 */
export function looksLikeTranscript(content: string): boolean {
  const s = content.trim();
  if (!s || s.length > 40000) return false;

  // 1) 对话数组：以 [ 开头，且同时出现 role 与 content 两个键
  if (/^\[\s*\{/.test(s) && /"role"\s*:/.test(s) && /"content"\s*:/.test(s)) return true;

  // 2) 对话模板标记
  if (/<\|im_start\|>/.test(s) || /<\|im_end\|>/.test(s)) return true;
  if (/<\|?start_header_id\|?>/.test(s)) return true;

  // 3) Human:/Assistant: 交替转录（至少两行，避免正常英文里出现 "Human:" 就误伤）
  const roles = s.match(/^\s*(Human|User|Assistant|System)\s*:/gim);
  if (roles && roles.length >= 2) return true;

  return false;
}
