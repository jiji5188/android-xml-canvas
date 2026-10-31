/**
 * M33：原生文件读写的**异步**封装。
 *
 * 问题：APK 里 `AxvNative.readText / readBase64 / listDir` 全是同步 JNI 调用，
 * 在 JS 线程上直接堵界面。项目管理页一进来就要给每个项目读 strings.xml + 一堆
 * 候选图标（最坏 19 个目录 × 7 个文件名 = 133 次同步读），手机上直接卡死几秒。
 *
 * 做法：Java 侧新增 readTextAsync / readBase64Async / listDirAsync（后台线程，
 * 结果通过 `window.__axvIo(id, payload)` 回传）。这里把它们包成 Promise，并加一个
 * **串行队列**（一次只跑一个 IO），避免一次点开目录就并发几十个线程。
 *
 * 旧 APK 没有这三个方法 → `hasAsyncIo()` 返回 false，调用方自动退回同步读取。
 */

interface AsyncIoBridge {
  readTextAsync?(id: string, target: string): void;
  readBase64Async?(id: string, target: string): void;
  listDirAsync?(id: string, path: string): void;
}

type Resolver = (value: string | null) => void;

const pending = new Map<string, Resolver>();
let seq = 0;
let installed = false;

function bridge(): AsyncIoBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { AxvNative?: AsyncIoBridge }).AxvNative ?? null;
}

/** 当前 APK 是否支持异步 IO（三种都给全了才算） */
export function hasAsyncIo(): boolean {
  const b = bridge();
  return !!(b && b.readTextAsync && b.readBase64Async && b.listDirAsync);
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  (window as unknown as { __axvIo?: (id: string, payload: string | null) => void }).__axvIo = (
    id,
    payload,
  ) => {
    const f = pending.get(id);
    if (!f) return;
    pending.delete(id);
    f(payload ?? null);
  };
}

/* ---------------- 串行队列 ---------------- */

let queue: Promise<unknown> = Promise.resolve();

/** 把一次 IO 排到队尾，保证同一时刻只有一个 JNI 读在跑 */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  // 队尾不传播错误，避免一次失败卡死整条队
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function call(kind: "readTextAsync" | "readBase64Async" | "listDirAsync", arg: string, timeoutMs = 10_000): Promise<string | null> {
  const b = bridge();
  const fn = b?.[kind];
  if (!b || typeof fn !== "function") return Promise.resolve(null);
  install();
  const id = `io${Date.now().toString(36)}${(seq++).toString(36)}`;
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, (v) => {
      clearTimeout(timer);
      resolve(v);
    });
    try {
      (fn as (id: string, arg: string) => void).call(b, id, arg);
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

/** 异步读文本（失败返回 null） */
export function readTextQueued(target: string): Promise<string | null> {
  return enqueue(() => call("readTextAsync", target));
}

/** 异步读二进制 → base64（失败返回 null） */
export function readBase64Queued(target: string): Promise<string | null> {
  return enqueue(() => call("readBase64Async", target));
}

/** 异步列一层目录 → 原始 JSON 字符串（失败返回 null） */
export function listDirQueued(path: string): Promise<string | null> {
  return enqueue(() => call("listDirAsync", path));
}

/** 让出一帧，避免连续 await 把主线程占满（React 有机会渲染） */
export function yieldToUi(): Promise<void> {
  return new Promise((r) => {
    const anyWin = window as unknown as { requestAnimationFrame?: (cb: () => void) => number };
    if (typeof anyWin.requestAnimationFrame === "function") anyWin.requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });
}

/** 测试用：清掉队列与挂起表 */
export function __resetAsyncIoForTest(): void {
  pending.clear();
  queue = Promise.resolve();
  installed = false;
}
