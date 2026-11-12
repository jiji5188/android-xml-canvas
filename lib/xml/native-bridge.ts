// lib/xml/native-bridge.ts
//
// 统一入口：**所有**原生能力模块都从这里取 window.AxvNative，不要再各写一份
// `(window as unknown as { AxvNative?: X }).AxvNative` 强转。
//
// 为什么值得单独抽：M188c 的 bug 就是某处手写桥名写错（`window.__axvBridge`），
// 读到 null 后一路退化、报「项目里没有 app/build.gradle」，查了很久。
// 桥名只允许在这个文件里出现一次。

/** 裸取 window.AxvNative（网页版 / SSR 返回 null）。不校验能力，调用方自己按需判方法。 */
export function axvNative<T>(): T | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { AxvNative?: T }).AxvNative as T) ?? null;
}

/** 取 window.AxvNative 且满足能力校验（pred 返回 false 时当没有桥，方便老 APK 退化）。 */
export function axvNativeIf<T>(pred: (b: T) => boolean): T | null {
  const b = axvNative<T>();
  if (!b) return null;
  try {
    return pred(b) ? b : null;
  } catch {
    return null;
  }
}

/**
 * 幂等注册「原生 → JS」回调。
 * 必须在每次调用前都走一遍：WebView 页刷新 / 渲染进程重启会把 window 上的函数抹掉，
 * 只靠一个 `installed` 布尔值会出现「回调没了但标志还在」→ 永久收不到结果。
 */
export function ensureGlobalCallback(name: string, install: () => void): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w[name] === "function") return;
  install();
}

/** 一次异步调用的等待表：id → resolver。原生回调拿到 id 后从表里取出并删除。 */
export function pendingTable<T>(tag: string) {
  const pending = new Map<string, (v: T) => void>();
  let seq = 0;
  return {
    pending,
    /** 生成唯一 id（tag + 自增序号 + 时间戳），只保证唯一性，格式无约定 */
    nextId(): string {
      seq += 1;
      return `${tag}${seq}-${Date.now()}`;
    },
    put(id: string, fn: (v: T) => void): void {
      pending.set(id, fn);
    },
    /** 取出并删除；没有则返回 undefined */
    take(id: string): ((v: T) => void) | undefined {
      const fn = pending.get(id);
      if (fn) pending.delete(id);
      return fn;
    },
    drop(id: string): void {
      pending.delete(id);
    },
    size(): number {
      return pending.size;
    },
  };
}
