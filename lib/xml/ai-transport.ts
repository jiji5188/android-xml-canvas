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

/* ---------- 原生通道类型 ---------- */

/** JS→Java 的通道：WebMessage（M32c 首选，不依赖 JS 桥对象注册表）或 旧 @JavascriptInterface */
interface NativeChannel {
  /** 发对话请求。返回 true 表示已发出（结果靠 window.__axvAi* 回调） */
  send(req: { type: "aiChatStream" | "aiAbort" | "aiPing"; id: string; url?: string; apiKey?: string; body?: string; timeoutMs?: number }): void;
  /** 当前通道名，UI 上显示用 */
  label: "port" | "webmessage" | "bridge";
}

interface AiNativeBridge {
  aiChatStream?(id: string, url: string, apiKey: string, bodyJson: string, timeoutMs: number): void;
  aiAbort?(id: string): void;
  aiPing?(): string;
}

/** 原生通道一旦彻底坏掉（两条 JS→Java 路都走不通），本次会话就永远走 fetch */
let nativeDead = false;

interface WebMsgHandlers {
  axvAi?: { postMessage(payload: string | Record<string, unknown>): void };
}

function webMsgSender(): WebMsgHandlers["axvAi"] | null {
  if (typeof window === "undefined") return null;
  const h = (window as unknown as { webkit?: { messageHandlers?: WebMsgHandlers } }).webkit?.messageHandlers;
  return h && h.axvAi && typeof h.axvAi.postMessage === "function" ? h.axvAi : null;
}

function bridge(): AiNativeBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AxvNative?: AiNativeBridge }).AxvNative;
  if (!b || typeof b.aiChatStream !== "function") return null;
  return b;
}

/* ---------- M32c：MessagePort 通道（不依赖 JS 桥注册表） ---------- */

let aiPort: MessagePort | null = null;

interface PortEnvelope {
  t: "chunk" | "done" | "error" | "pong";
  id: string;
  v?: string;
  status?: number;
}

function dispatchPort(raw: unknown): void {
  if (typeof raw !== "string") return;
  let o: PortEnvelope;
  try {
    o = JSON.parse(raw) as PortEnvelope;
  } catch {
    return;
  }
  if (!o || typeof o.id !== "string") return;
  if (o.t === "chunk") window.__axvAiChunk?.(o.id, o.v ?? "");
  else if (o.t === "done") window.__axvAiDone?.(o.id, o.status ?? 0);
  else if (o.t === "error") window.__axvAiError?.(o.id, o.v ?? "未知错误");
  else if (o.t === "pong") window.__axvAiPong?.(o.id);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (ev: MessageEvent) => {
    // 原生在 onPageFinished 里 postWebMessage("axv-ai-init", [port]) 交过来
    if (ev.data === "axv-ai-init" && ev.ports && ev.ports.length) {
      aiPort = ev.ports[0];
      aiPort.onmessage = (e: MessageEvent) => dispatchPort(e.data);
      // 握手：告诉原生「这条路真通了」，否则原生回包会走 evaluateJavascript
      try {
        aiPort.postMessage(JSON.stringify({ type: "aiHello" }));
      } catch {
        /* ignore */
      }
    }
  });
}

/** 优先 WebMessage；拿不到就用旧 JS 桥（M32c：旧桥的探活逻辑收进 nativeDead 判断里） */
function nativeChannel(): NativeChannel | null {
  if (typeof window === "undefined") return null;
  if (nativeDead) return null;

  // 1) MessagePort（最稳：独立通道，页面重载后由原生重建）
  if (aiPort) {
    const p = aiPort;
    return {
      label: "port",
      send(req) {
        try {
          p.postMessage(JSON.stringify(req));
        } catch {
          aiPort = null;
          nativeDead = true;
        }
      },
    };
  }

  // 2) window.webkit.messageHandlers（androidx WebViewCompat 场景，本壳暂未用）
  const wm = webMsgSender();
  if (wm) {
    return {
      label: "webmessage",
      send(req) {
        try {
          wm.postMessage(JSON.stringify(req));
        } catch {
          nativeDead = true;
        }
      },
    };
  }

  // 3) 旧 @JavascriptInterface 桥（带探活）
  const b = bridge();
  if (b) {
    // M32b：探活。抛错说明桥对象绑定失效，回退 fetch
    try {
      if (b.aiPing && b.aiPing() !== "pong") return null;
    } catch {
      return null;
    }
    return {
      label: "bridge",
      send(req) {
        try {
          if (req.type === "aiChatStream") {
            b.aiChatStream?.(req.id, req.url || "", req.apiKey || "", req.body || "", req.timeoutMs ?? 120_000);
          } else if (req.type === "aiAbort") {
            b.aiAbort?.(req.id);
          }
        } catch {
          nativeDead = true;
        }
      },
    };
  }
  return null;
}

/** 当前环境是否能用原生直连（APK 里为 true） */
export function nativeAiAvailable(): boolean {
  if (probe === null) probe = nativeChannel() !== null;
  return probe;
}

let probe: boolean | null = null;

declare global {
  interface Window {
    __axvAiChunk?: (id: string, text: string) => void;
    __axvAiDone?: (id: string, status: number) => void;
    __axvAiError?: (id: string, message: string) => void;
    /** M32c：Java 对 aiPing 的回应 */
    __axvAiPong?: (id: string) => void;
  }
}

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
  /** 内部用：通道一条事件都没回（可能静默丢消息）*/ 
  silent?: boolean;
  /** 实际用的通道（诊断用） */
  channel?: string;
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

  const ch = nativeChannel();
  if (ch) {
    const r = await streamViaNative(ch, url, cfg.apiKey.trim(), body, timeoutMs, opts);
    // 通道掉了：标记并当场改走 fetch，用户无感知
    if (r.bridgeDead) {
      nativeDead = true;
      probe = false;
      return streamViaFetch(url, cfg.apiKey.trim(), body, timeoutMs, opts);
    }
    // M33：一条事件都没回（典型：port 静默丢消息）→ 换旧 JS 桥重试一次，再不行走 fetch
    if (r.silent && ch.label !== "bridge") {
      const b = bridge();
      if (b) {
        const alt = bridgeChannel();
        if (alt) {
          const r2 = await streamViaNative(alt, url, cfg.apiKey.trim(), body, timeoutMs, opts);
          if (!r2.silent) return r2;
        }
      }
      return streamViaFetch(url, cfg.apiKey.trim(), body, timeoutMs, opts);
    }
    return r;
  }
  return streamViaFetch(url, cfg.apiKey.trim(), body, timeoutMs, opts);
}

/** 只用旧 @JavascriptInterface 桥的通道（port 静默失败时用它重试） */
function bridgeChannel(): NativeChannel | null {
  const b = bridge();
  if (!b) return null;
  return {
    label: "bridge",
    send(req) {
      try {
        if (req.type === "aiChatStream") {
          b.aiChatStream?.(req.id, req.url || "", req.apiKey || "", req.body || "", req.timeoutMs ?? 120_000);
        } else if (req.type === "aiAbort") {
          b.aiAbort?.(req.id);
        }
      } catch {
        nativeDead = true;
      }
    },
  };
}

/* ---------- 原生直连（WebMessage 优先，旧 JS 桥兜底） ---------- */

function streamViaNative(
  ch: NativeChannel,
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
    let sawAny = false;

    // M33：首事件看门狗 —— 非 bridge 通道 8s 内一条事件都没回，就当静默失败（上层换路）
    const firstEventMs = 8_000;
    const watchdog =
      ch.label === "bridge"
        ? 0
        : setTimeout(() => {
            if (settled || sawAny) return;
            ch.send({ type: "aiAbort", id });
            finish(false, undefined, false, true);
          }, firstEventMs);

    const onAbort = () => {
      ch.send({ type: "aiAbort", id });
      finish(false, "已取消");
    };

    const timer = setTimeout(() => {
      ch.send({ type: "aiAbort", id });
      finish(false, `请求超时（通过 ${ch.label} 通道，${Math.round(timeoutMs / 1000)}s），可能是网络慢或模型响应太长，把最大 token 调小再试。`);
    }, timeoutMs + 5_000);

    function cleanup() {
      clearTimeout(timer);
      if (watchdog) clearTimeout(watchdog);
      opts.signal?.removeEventListener("abort", onAbort);
      window.__axvAiChunk = prevChunk;
      window.__axvAiDone = prevDone;
      window.__axvAiError = prevErr;
    }

    function finish(ok: boolean, error?: string, bridgeDead = false, silent = false) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok, content: acc, error, via: "native", bridgeDead, silent, channel: ch.label });
    }

    window.__axvAiChunk = (rid, text) => {
      if (rid !== id || settled) return;
      sawAny = true;
      acc += text;
      opts.onChunk?.(text);
    };
    window.__axvAiDone = (rid, status) => {
      if (rid !== id || settled) return;
      sawAny = true;
      if (!acc) {
        finish(false, `服务端返回空内容（HTTP ${status}，通道 ${ch.label}），换个模型或把最大 token 调大再试。`);
      } else {
        finish(true);
      }
    };
    window.__axvAiError = (rid, msg) => {
      if (rid !== id || settled) return;
      sawAny = true;
      const m = /^(\d{3})\s?/.exec(msg || "");
      if (m && Number(m[1]) >= 400) {
        finish(false, humanizeError(null, Number(m[1]), (msg || "").slice(4)));
      } else {
        finish(false, humanizeError(new Error(msg)));
      }
    };

    opts.signal?.addEventListener("abort", onAbort);

    try {
      ch.send({ type: "aiChatStream", id, url, apiKey, body, timeoutMs });
    } catch (e) {
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
