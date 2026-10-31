// lib/xml/ai-transport.ts
// AI 请求的传输层：两条路
//   1) APK 原生壳：window.AxvNative.aiChatStream —— 走 Java HttpURLConnection，
//      没有同源策略/预检，5 家厂商全通，且支持流式（Java 按行读 SSE 再 evaluateJavascript 推回来）
//   2) 浏览器：fetch + ReadableStream 自己解析 SSE
// 上层（AiPanel）只认 streamChat()，不关心走哪条。

import {
  buildRequestBody,
  endpointOf,
  humanizeError,
  validateConfig,
  type AiConfig,
  type AiMessage,
} from "./ai";

/* ---------- 原生桥类型 ---------- */

interface AiNativeBridge {
  aiChatStream?(id: string, url: string, apiKey: string, bodyJson: string, timeoutMs: number): void;
  aiAbort?(id: string): void;
  aiPing?(): string;
}

/** 桥对象一旦绑不住（Chromium: non-injected object），本次会话就永远走 fetch */
let nativeDead = false;

declare global {
  interface Window {
    __axvAiChunk?: (id: string, text: string) => void;
    __axvAiDone?: (id: string, status: number) => void;
    __axvAiError?: (id: string, message: string) => void;
  }
}

function bridge(): AiNativeBridge | null {
  if (typeof window === "undefined") return null;
  if (nativeDead) return null;
  const b = (window as unknown as { AxvNative?: AiNativeBridge }).AxvNative;
  if (!b || typeof b.aiChatStream !== "function") return null;
  // M32b：先探活。抛错或返回不是 pong，说明桥对象已失效
  if (typeof b.aiPing === "function") {
    try {
      if (b.aiPing() !== "pong") nativeDead = true;
    } catch {
      nativeDead = true;
    }
    if (nativeDead) return null;
  }
  return b;
}

/** 当前环境是否能用原生直连（APK 里为 true） */
export function nativeAiAvailable(): boolean {
  if (probe === null) probe = bridge() !== null;
  return probe;
}

let probe: boolean | null = null;

/* ---------- SSE 解析（纯函数，可单测） ---------- */

/**
 * 从 SSE 文本里抠出增量正文。返回新的缓冲区（未闭合的尾巴）。
 * 兼容：data: {...} / 裸 JSON / [DONE] / 注释行(:) / CRLF
 */
export function parseSse(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const deltas: string[] = [];
  let done = false;
  let rest = buffer;
  let idx = rest.indexOf("\n");
  while (idx >= 0) {
    const line = rest.slice(0, idx).replace(/\r$/, "");
    rest = rest.slice(idx + 1);
    const s = line.trim();
    if (s && !s.startsWith(":")) {
      const payload = s.startsWith("data:") ? s.slice(5).trim() : s;
      if (payload === "[DONE]") {
        done = true;
      } else if (payload.startsWith("{")) {
        const t = deltaOfJson(payload);
        if (t) deltas.push(t);
      }
    }
    idx = rest.indexOf("\n");
  }
  return { deltas, rest, done };
}

/** 取 choices[0].delta.content，退回到 choices[0].message.content（非流式） */
export function deltaOfJson(payload: string): string {
  const pick = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      return v
        .map((p) =>
          typeof p === "string"
            ? p
            : typeof (p as { text?: string })?.text === "string"
              ? (p as { text: string }).text
              : "",
        )
        .join("");
    }
    return "";
  };
  try {
    const o = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
    };
    const c = o?.choices?.[0];
    const d = pick(c?.delta?.content);
    if (d) return d;
    return pick(c?.message?.content);
  } catch {
    return "";
  }
}

/* ---------- 对外接口 ---------- */

export interface StreamOptions {
  signal?: AbortSignal;
  /** 总超时；原生侧作为 readTimeout，浏览器侧整体兜底 */
  timeoutMs?: number;
  onChunk?: (text: string) => void;
  /** 注入 fetch 便于测试 */
  fetchImpl?: typeof fetch;
}

export interface StreamResult {
  ok: boolean;
  content: string;
  error?: string;
  /** 走了哪条路，UI 上显示用 */
  via: "native" | "fetch";
  /** 内部用：桥对象失效，调用方应重试 fetch */
  bridgeDead?: boolean;
}

let seq = 0;

export async function streamChat(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: StreamOptions = {},
): Promise<StreamResult> {
  const bad = validateConfig(cfg);
  if (bad) return { ok: false, content: "", error: bad, via: "fetch" };

  const url = endpointOf(cfg.baseUrl);
  const body = JSON.stringify(buildRequestBody(cfg, messages, true));
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const b = bridge();
  if (b && typeof b.aiChatStream === "function") {
    const r = await streamViaNative(b, url, cfg.apiKey.trim(), body, timeoutMs, opts);
    // 桥掉了：标记并当场改走 fetch，用户无感知
    if (r.bridgeDead) {
      nativeDead = true;
      return streamViaFetch(url, cfg.apiKey.trim(), body, timeoutMs, opts);
    }
    return r;
  }
  return streamViaFetch(url, cfg.apiKey.trim(), body, timeoutMs, opts);
}

/* ---------- 原生直连 ---------- */

function streamViaNative(
  b: AiNativeBridge,
  url: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
  opts: StreamOptions,
): Promise<StreamResult> {
  return new Promise((resolve) => {
    const id = `ai${Date.now().toString(36)}${(seq++).toString(36)}`;
    let acc = "";
    let settled = false;

    const prevChunk = window.__axvAiChunk;
    const prevDone = window.__axvAiDone;
    const prevErr = window.__axvAiError;

    const onAbort = () => {
      b.aiAbort?.(id);
      finish(false, "已取消");
    };

    const timer = setTimeout(() => {
      b.aiAbort?.(id);
      finish(false, "请求超时，可能是网络慢或模型响应太长，把最大 token 调小再试。");
    }, timeoutMs + 5_000);

    function cleanup() {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      window.__axvAiChunk = prevChunk;
      window.__axvAiDone = prevDone;
      window.__axvAiError = prevErr;
    }

    function finish(ok: boolean, error?: string, bridgeDead = false) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok, content: acc, error, via: "native", bridgeDead });
    }

    window.__axvAiChunk = (rid, text) => {
      if (rid !== id || settled) return;
      acc += text;
      opts.onChunk?.(text);
    };
    window.__axvAiDone = (rid, status) => {
      if (rid !== id || settled) return;
      if (!acc) {
        finish(false, `服务端返回空内容（HTTP ${status}），换个模型或把最大 token 调大再试。`);
      } else {
        finish(true);
      }
    };
    window.__axvAiError = (rid, msg) => {
      if (rid !== id || settled) return;
      const m = /^(\d{3})\s?/.exec(msg || "");
      if (m && Number(m[1]) >= 400) {
        finish(false, humanizeError(null, Number(m[1]), (msg || "").slice(4)));
      } else {
        finish(false, humanizeError(new Error(msg)));
      }
    };

    opts.signal?.addEventListener("abort", onAbort);

    try {
      b.aiChatStream?.(id, url, apiKey, body, timeoutMs);
    } catch (e) {
      // 「Java bridge method can't be invoked on a non-injected object」就是这里
      finish(false, humanizeError(e), !acc);
    }
  });
}

/* ---------- 浏览器 fetch + SSE ---------- */

async function streamViaFetch(
  url: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
  opts: StreamOptions,
): Promise<StreamResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);

  let acc = "";
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream, application/json",
      },
      body,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, content: "", error: humanizeError(null, res.status, text), via: "fetch" };
    }

    // 没有流（服务端直接回整包 JSON）
    if (!res.body) {
      const text = await res.text();
      const whole = deltaOfJson(text);
      if (!whole) return { ok: false, content: "", error: "服务端返回空内容，换个模型试试。", via: "fetch" };
      acc = whole;
      opts.onChunk?.(whole);
      return { ok: true, content: acc, via: "fetch" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const r = parseSse(buf);
      buf = r.rest;
      for (const d of r.deltas) {
        acc += d;
        opts.onChunk?.(d);
      }
      if (r.done) break;
    }
    if (!acc) return { ok: false, content: "", error: "服务端返回空内容，换个模型或加大 token 上限试试。", via: "fetch" };
    return { ok: true, content: acc, via: "fetch" };
  } catch (e) {
    return { ok: false, content: acc, error: humanizeError(e), via: "fetch" };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
