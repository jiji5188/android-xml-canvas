/**
 * M192：一键打包成「可安装 APK」的桥（设备端）。
 *
 * 为什么设备端自己打：手机上装了 aapt2（libaapt2.so）、apksig 也已经 dex 进 assets，
 * 所以「资源编译 → 注入壳 dex → 对齐 → 签名」都能在手机上完成，不需要电脑。
 *
 * 协议（异步，不堵 JS 线程）：
 *   JS → AxvNative.buildInstallApkAsync(id, payloadJson)
 *   原生 → window.__axvBuildApk(id, resultJson)
 */

import type { RenderFile } from "./native-render";

export interface BuildApkInput {
  /** applicationId（同时作为 package） */
  pkg: string;
  /** 启动布局名（不含 .xml），例如 activity_main */
  layout: string;
  /** 应用名（桌面上显示的名字） */
  appName?: string;
  files: RenderFile[];
  /** keystore 绝对路径（PKCS#12） */
  keystore: string;
  storePass: string;
  alias?: string;
  keyPass?: string;
  /** 输出文件名，默认 <pkg>.apk */
  outName?: string;
}

export interface BuildApkResult {
  ok: boolean;
  /** 成功时的绝对路径 */
  path?: string;
  name?: string;
  bytes?: number;
  ms?: number;
  pkg?: string;
  layout?: string;
  /** 失败阶段：pkg / keystore / files / write / aapt2 / compile / link / pack / sign / output */
  step?: string;
  log?: string;
}

interface ApkBridge {
  buildInstallApkAsync?(id: string, payload: string): void;
  installApk?(path: string): void;
  shareApk?(path: string): void;
}

type Resolver = (r: BuildApkResult) => void;

const pending = new Map<string, Resolver>();
let seq = 0;
let installed = false;

function bridge(): ApkBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { AxvNative?: ApkBridge }).AxvNative ?? null;
}

/** 当前环境能不能在设备端打包（网页版永远不能） */
export function hasBuildApk(): boolean {
  const b = bridge();
  return !!(b && typeof b.buildInstallApkAsync === "function");
}

function install(): void {
  if (typeof window === "undefined") return;
  if (installed && typeof (window as { __axvBuildApk?: unknown }).__axvBuildApk === "function") return;
  installed = true;
  (window as unknown as { __axvBuildApk?: (id: string, json: string) => void }).__axvBuildApk = (
    id: string,
    json: string,
  ) => {
    const fn = pending.get(id);
    if (!fn) return;
    pending.delete(id);
    let r: BuildApkResult;
    try {
      r = JSON.parse(json) as BuildApkResult;
    } catch {
      r = { ok: false, log: "原生返回的不是合法 JSON：" + String(json).slice(0, 200) };
    }
    fn(r);
  };
}

/** 打包（promise 永远 resolve，错误放在 ok=false + log 里） */
export function buildApk(input: BuildApkInput): Promise<BuildApkResult> {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || typeof b.buildInstallApkAsync !== "function") {
      resolve({ ok: false, step: "env", log: "当前不在 App 里（网页版没有 aapt2/apksig），请在手机上操作" });
      return;
    }
    install();
    const id = "apk" + ++seq + "-" + Date.now();
    pending.set(id, resolve);
    try {
      b.buildInstallApkAsync(id, JSON.stringify(input));
    } catch (e) {
      pending.delete(id);
      resolve({ ok: false, step: "env", log: String(e) });
    }
    // 兜底：原生进程异常时不至于永远挂着
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, step: "timeout", log: "打包超时（90s 没回话）" });
      }
    }, 90000);
  });
}

/** 调系统安装器（需要原生支持；返回是否调起成功） */
export function installApk(path: string): { ok: boolean; msg?: string } {
  const b = bridge();
  if (!b || typeof b.installApk !== "function") return { ok: false, msg: "当前环境不支持安装" };
  try {
    b.installApk(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
}

/** M197：把打好的 APK 分享出去（微信/QQ/邮件…；返回是否调起成功） */
export function shareApkFile(path: string): { ok: boolean; msg?: string } {
  const b = bridge();
  if (!b || typeof b.shareApk !== "function") return { ok: false, msg: "当前环境不支持分享" };
  try {
    b.shareApk(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
}
