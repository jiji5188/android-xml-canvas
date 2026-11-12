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
  /** M211：项目里已经编译好的 dex（classes2.dex 起）。用来让布局里的自定义控件能 inflate。 */
  extraDex?: { name: string; base64: string }[];
  /** M213：项目 Java/Kotlin 源码（设备端用 ECJ+D8 真编译，产出 dex 注进包）。path 相对项目根。 */
  javaSources?: { path: string; code: string }[];
  /** M213：启动 Activity 全限定名（项目清单里的 launcher；没有就退回壳 Activity） */
  launchActivity?: string;
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
  /** M216："none" = 无 Java 源码的布局壳；"java:<n>" = 真编译并注入了 <n> 个 dex */
  compileMode?: string;
  /** M216：编译并注入的 dex 数量（只有 compileMode 以 java: 开头时才有意义） */
  classes?: number;
}

interface ApkBridge {
  buildInstallApkAsync?(id: string, payload: string): void;
  installApk?(path: string): void;
  shareApk?(path: string): void;
}

import { axvNative, ensureGlobalCallback, pendingTable } from "./native-bridge";

const table = pendingTable<BuildApkResult>("apk");

function bridge(): ApkBridge | null {
  return axvNative<ApkBridge>();
}

/** 当前环境能不能在设备端打包（网页版永远不能） */
export function hasBuildApk(): boolean {
  const b = bridge();
  return !!(b && typeof b.buildInstallApkAsync === "function");
}

function install(): void {
  ensureGlobalCallback("__axvBuildApk", () => {
    (window as unknown as { __axvBuildApk?: (id: string, json: string) => void }).__axvBuildApk = (
      id: string,
      json: string,
    ) => {
      const fn = table.take(id);
      if (!fn) return;
      let r: BuildApkResult;
      try {
        r = JSON.parse(json) as BuildApkResult;
      } catch {
        r = { ok: false, log: "原生返回的不是合法 JSON：" + String(json).slice(0, 200) };
      }
      fn(r);
    };
  });
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
    const id = table.nextId();
    table.put(id, resolve);
    try {
      b.buildInstallApkAsync(id, JSON.stringify(input));
    } catch (e) {
      table.drop(id);
      resolve({ ok: false, step: "env", log: String(e) });
    }
    // 兜底：原生进程异常时不至于永远挂着
    setTimeout(() => {
      if (table.pending.has(id)) {
        table.drop(id);
        resolve({ ok: false, step: "timeout", log: "打包超时（90s 没回话）" });
      }
    }, 90000);
  });
}

/**
 * M216：解析打包结果里的编译模式。
 * - "java"：设备端真编译了项目 Java，classes = 注入的 dex 个数
 * - "shell"：项目里没有 .java，产出的是只能显示布局的壳（必须明确告诉用户）
 * - "unknown"：老版本 APK 没带 compileMode 字段（不能断言是壳）
 */
export function compileModeOf(r: BuildApkResult | null | undefined): {
  mode: "java" | "shell" | "unknown";
  classes: number;
} {
  const cm = r?.compileMode || "";
  if (cm.startsWith("java:")) {
    const n = r?.classes ?? Number(cm.slice(5));
    return { mode: "java", classes: Number.isFinite(n) ? n : 0 };
  }
  if (cm === "none" || cm === "shell" || cm === "shell-no-compiler") return { mode: "shell", classes: 0 };
  return { mode: "unknown", classes: 0 };
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
