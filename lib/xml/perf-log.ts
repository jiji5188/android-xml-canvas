/**
 * M59：性能日志（写到 APK 的 AndroidUIIDE/log/perf-YYYYMMDD.log）
 *
 * 为什么要这个：前两轮优化都是"看代码猜"，猜错了两次（M56 猜历史栈、M57 才量出
 * lintXml 是 O(n²)）。以后所有性能结论必须先有数字。
 *
 * 用法：
 *   const t = perfTimer("tree.expand");
 *   ... 做事 ...
 *   t.end({ items: n });              // 记一行 "tree.expand 12.3ms items=3"
 *
 *   perfMark("canvas.render", "nodes=812 pass=3");
 *
 * 设计约束：
 *  - 桥不可用（浏览器里跑）→ 只打 console，不影响功能
 *  - 日志调用本身必须极便宜：不做 JSON.stringify、不 await、失败静默
 *  - 同一 tag 过密时自动合并（1s 内只保留最后一条 + 计数），避免刷爆文件
 */

interface LogBridge {
  asyncLog?(tag: string, msg: string): void;
  logPath?(): string;
}

const PERF_ON =
  typeof window === "undefined"
    ? false
    : (() => {
        try {
          const q = new URLSearchParams(window.location.search);
          if (q.get("perf") === "1") return true;
          if (q.get("perf") === "0") return false;
          return !!axvNative<LogBridge>()?.asyncLog;
        } catch {
          return false;
        }
      })();

import { axvNative } from "./native-bridge";

const recent = new Map<string, { at: number; count: number }>();
const DEDUPE_MS = 1000;

function bridge(): LogBridge | null {
  return axvNative<LogBridge>();
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "NaN";
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}

/** 写一行性能日志 */
export function perfMark(tag: string, msg = ""): void {
  if (!PERF_ON) return;
  try {
    const now = Date.now();
    const prev = recent.get(tag);
    if (prev && now - prev.at < DEDUPE_MS) {
      prev.count++;
      prev.at = now;
      return;
    }
    let line = msg;
    if (prev && prev.count > 0) {
      line += (line ? " " : "") + `(+${prev.count} 条同类已合并)`;
    }
    recent.set(tag, { at: now, count: 0 });
    if (recent.size > 200) {
      for (const [k, v] of recent) {
        if (now - v.at > 10_000) recent.delete(k);
      }
    }
    bridge()?.asyncLog?.(tag, line);
    if (typeof console !== "undefined") console.debug(`[perf] ${tag} ${line}`);
  } catch {
    /* 日志永远不能影响功能 */
  }
}

export interface PerfTimer {
  end(extra?: string | Record<string, string | number>): number;
}

/** 计时段：t.end() 返回毫秒数并记一行 */
export function perfTimer(tag: string, extra?: string): PerfTimer {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    end(e2) {
      const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      const parts: string[] = [];
      if (extra) parts.push(extra);
      if (typeof e2 === "string") parts.push(e2);
      else if (e2) for (const k of Object.keys(e2)) parts.push(`${k}=${e2[k]}`);
      perfMark(tag, `${fmt(ms)}ms ${parts.join(" ")}`.trim());
      return ms;
    },
  };
}

/** 包一层异步函数并自动计时（异常也记） */
export async function timed<T>(tag: string, fn: () => Promise<T>, extra?: string): Promise<T> {
  const t = perfTimer(tag, extra);
  try {
    const v = await fn();
    t.end("ok");
    return v;
  } catch (e) {
    t.end("ERR " + (e instanceof Error ? e.message : String(e)));
    throw e;
  }
}

/** 当前 JS 堆占用（Chromium 才有 performance.memory）；拿不到返回 null */
export function heapMB(): string | null {
  try {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (!m) return null;
    return `${(m.usedJSHeapSize / 1048576).toFixed(1)}MB`;
  } catch {
    return null;
  }
}

/** 日志文件绝对路径（APK 里可读，浏览器返回空串） */
export function perfLogPath(): string {
  try {
    return bridge()?.logPath?.() ?? "";
  } catch {
    return "";
  }
}

/** 测试用：是否开启 */
export function perfEnabled(): boolean {
  return PERF_ON;
}
