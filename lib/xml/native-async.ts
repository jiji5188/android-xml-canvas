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

import { perfMark } from "./perf-log";
import { axvNative, ensureGlobalCallback, pendingTable } from "./native-bridge";

interface AsyncIoBridge {
  readTextAsync?(id: string, target: string): void;
  readBase64Async?(id: string, target: string): void;
  listDirAsync?(id: string, path: string): void;
  /** M56：全树深扫转后台线程（老 APK 没这个） */
  listProjectsAsync?(id: string): void;
  /** M59：顶层项目列表 / 工作目录信息转后台线程 */
  listTopProjectsAsync?(id: string): void;
  /** M60：顶层项目快速列表（只数一层 xml，毫秒级） */
  listTopProjectsQuickAsync?(id: string): void;
  getWorkspaceInfoAsync?(id: string): void;
}

const table = pendingTable<string | null>("io");

function bridge(): AsyncIoBridge | null {
  return axvNative<AsyncIoBridge>();
}

/** 当前 APK 是否支持异步 IO（三种都给全了才算） */
export function hasAsyncIo(): boolean {
  const b = bridge();
  return !!(b && b.readTextAsync && b.readBase64Async && b.listDirAsync);
}

/** M56：老 APK 没有 listProjectsAsync → 调用方退回同步 listProjects */
export function hasListProjectsAsync(): boolean {
  const b = bridge();
  return !!(b && b.listProjectsAsync);
}

/** M59：老 APK 没有 listTopProjectsAsync → 调用方退回同步 listTopProjects */
export function hasListTopAsync(): boolean {
  const b = bridge();
  return !!(b && b.listTopProjectsAsync);
}

/** M59：老 APK 没有 getWorkspaceInfoAsync → 调用方退回同步 getWorkspaceInfo */
export function hasWorkspaceInfoAsync(): boolean {
  const b = bridge();
  return !!(b && b.getWorkspaceInfoAsync);
}

/** M60：老 APK 没有 listTopProjectsQuickAsync → 直接等完整列表 */
export function hasListTopQuick(): boolean {
  const b = bridge();
  return !!(b && b.listTopProjectsQuickAsync);
}

function install(): void {
  ensureGlobalCallback("__axvIo", () => {
    (window as unknown as { __axvIo?: (id: string, payload: string | null) => void }).__axvIo = (
      id,
      payload,
    ) => {
      const f = table.take(id);
      if (!f) return;
      f(payload ?? null);
    };
  });
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

function call(kind: "readTextAsync" | "readBase64Async" | "listDirAsync" | "listProjectsAsync" | "listTopProjectsAsync" | "listTopProjectsQuickAsync" | "getWorkspaceInfoAsync", arg: string | null, timeoutMs = 10_000): Promise<string | null> {
  const b = bridge();
  const fn = b?.[kind];
  if (!b || typeof fn !== "function") return Promise.resolve(null);
  install();
  const id = table.nextId();
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      table.drop(id);
      perfMark("io.timeout", `${kind} ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);
    table.put(id, (v) => {
      clearTimeout(timer);
      // M59：量 JNI 往返（Java 后台线程 + 回传 eval 的总时间）
      const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      perfMark("io." + kind.replace("Async", ""), `${ms.toFixed(1)}ms ${arg ? arg.slice(-48) : ""} len=${v ? v.length : 0}`);
      resolve(v);
    });
    try {
      // M56：listProjects 系只要 id，没有第二个参数
      if (kind === "listProjectsAsync" || kind === "listTopProjectsAsync" || kind === "listTopProjectsQuickAsync" || kind === "getWorkspaceInfoAsync")
        (fn as (id: string) => void).call(b, id);
      else (fn as (id: string, arg: string) => void).call(b, id, arg ?? "");
    } catch {
      clearTimeout(timer);
      table.drop(id);
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

/** M56：异步全树深扫（listProjects）→ 原始 JSON；老 APK 返回 null 让调用方回退同步版 */
export function listProjectsQueued(): Promise<string | null> {
  if (!hasListProjectsAsync()) return Promise.resolve(null);
  return enqueue(() => call("listProjectsAsync", null, 20_000));
}

/** M59：异步列顶层项目（不递归）——项目面板主路径 */
export function listTopProjectsQueued(): Promise<string | null> {
  if (!hasListTopAsync()) return Promise.resolve(null);
  return enqueue(() => call("listTopProjectsAsync", null, 20_000));
}

/** M60：快速列表（毫秒级，先出卡片） */
export function listTopProjectsQuickQueued(): Promise<string | null> {
  if (!hasListTopQuick()) return Promise.resolve(null);
  return enqueue(() => call("listTopProjectsQuickAsync", null, 15_000));
}

/** M59：异步取工作目录信息（原来是同步 JNI，且一次列项目要被调好几次） */
export function workspaceInfoQueued(): Promise<string | null> {
  if (!hasWorkspaceInfoAsync()) return Promise.resolve(null);
  return enqueue(() => call("getWorkspaceInfoAsync", null));
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
  for (const k of [...table.pending.keys()]) table.drop(k);
  queue = Promise.resolve();
}
