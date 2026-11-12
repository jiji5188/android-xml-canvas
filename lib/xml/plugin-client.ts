// lib/xml/plugin-client.ts — 插件（编译器）按需下载 JS 侧（M228）
//
// 原生侧：MainActivity 的 pluginStatus / pluginDownload / pluginClear（@JavascriptInterface）
//   pluginDownload 异步，进度走 window.__axvPluginProgress(evt)，完成走 window.__axvPluginDone(id, json)
// 下载源分级：小文件 jsDelivr、大文件 ghfast 代理（raw 兜底）。具体见 make-plugin 与原生插件段。
//
// 网页版没有 AxvNative 桥 → 所有方法返回「不支持」，不会报错。

import { axvNative, ensureGlobalCallback, pendingTable } from "./native-bridge";

export interface PluginFileStatus {
  path: string;
  size: number;
  ok: boolean;
}

export interface PluginStatus {
  id: string;
  installed: boolean;
  bytes: number;
  files: PluginFileStatus[];
  missing: string[];
  error?: string;
}

export interface PluginProgressEvent {
  stage: string;
  percent: number;
  got: number;
  total: number;
  msg?: string;
}

export interface PluginResult {
  ok: boolean;
  step?: string;
  log?: string;
  /** 成功时原生回填的 installed 清单 */
  id?: string;
  version?: string;
}

interface PluginBridge {
  pluginStatus?(id: string): string;
  pluginDownload?(id: string): void;
  pluginClear?(id: string): void;
}

const table = pendingTable<PluginResult>("plugin");

function bridge(): PluginBridge | null {
  return axvNative<PluginBridge>();
}

/** 当前环境能不能查/下插件（网页版永远 false） */
export function hasPluginSupport(): boolean {
  const b = bridge();
  return !!(b && typeof b.pluginStatus === "function");
}

/** 查插件状态（同步）。不支持 → installed=false + error */
export function pluginStatus(id: string): PluginStatus {
  const b = bridge();
  if (!b || typeof b.pluginStatus !== "function") {
    return { id, installed: false, bytes: 0, files: [], missing: [], error: "当前不在 App 里" };
  }
  try {
    const raw = b.pluginStatus(id);
    const o = JSON.parse(raw) as PluginStatus;
    return o;
  } catch (e) {
    return { id, installed: false, bytes: 0, files: [], missing: [], error: String(e) };
  }
}

/** 装一次全局进度回调（幂等，原生每次刷新后仍要重挂） */
function installProgress(): void {
  ensureGlobalCallback("__axvPluginProgress", () => {
    (window as unknown as { __axvPluginProgress?: (e: PluginProgressEvent) => void }).__axvPluginProgress = (e: PluginProgressEvent) => {
      for (const fn of progressSubs) {
        try { fn(e); } catch { /* 单个订阅者异常不影响其它 */ }
      }
    };
  });
}

/** 装一次全局完成回调 */
function installDone(): void {
  ensureGlobalCallback("__axvPluginDone", () => {
    (window as unknown as { __axvPluginDone?: (id: string, json: string) => void }).__axvPluginDone = (id: string, json: string) => {
      const fn = table.take(id);
      if (!fn) return;
      let r: PluginResult;
      try { r = JSON.parse(json) as PluginResult; } catch { r = { ok: false, step: "parse", log: String(json).slice(0, 200) }; }
      fn(r);
    };
  });
}

const progressSubs = new Set<(e: PluginProgressEvent) => void>();

/** 订阅下载进度（返回取消函数）。用于 UI 画进度条 */
export function onPluginProgress(fn: (e: PluginProgressEvent) => void): () => void {
  progressSubs.add(fn);
  installProgress();
  return () => { progressSubs.delete(fn); };
}

/**
 * 下载并安装插件。promise 永远 resolve（结果在 ok 里）。
 * @param id       插件 id（"ecj-d8"）
 * @param onProg   可选进度回调（也可用 onPluginProgress 全局订阅）
 */
export function downloadPlugin(id: string, onProg?: (e: PluginProgressEvent) => void): Promise<PluginResult> {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || typeof b.pluginDownload !== "function") {
      resolve({ ok: false, step: "env", log: "当前不在 App 里（网页版不能下载编译器）" });
      return;
    }
    installDone();
    if (onProg) {
      progressSubs.add(onProg);
      installProgress();
      const orig = onProg;
      // 包装：完成/失败后自动移除
      const wrapped = (e: PluginProgressEvent) => {
        orig(e);
        if (e.stage === "done") progressSubs.delete(wrapped);
      };
      progressSubs.add(wrapped);
      progressSubs.delete(onProg); // 换成 wrapped
    }
    const callId = table.nextId();
    table.put(callId, resolve);
    try {
      b.pluginDownload(callId);
    } catch (e) {
      table.drop(callId);
      resolve({ ok: false, step: "env", log: String(e) });
    }
    // 兜底：下 24MB 给足时间
    setTimeout(() => {
      if (table.pending.has(callId)) {
        table.drop(callId);
        resolve({ ok: false, step: "timeout", log: "下载超时（3 分钟没完成）" });
      }
    }, 180000);
  });
}

/** 清除已下载缓存 */
export function clearPlugin(id: string): { ok: boolean; msg?: string } {
  const b = bridge();
  if (!b || typeof b.pluginClear !== "function") return { ok: false, msg: "当前环境不支持" };
  try {
    b.pluginClear(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
}
