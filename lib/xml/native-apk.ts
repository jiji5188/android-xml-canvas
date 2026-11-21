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
  /** M262：项目 AndroidManifest.xml 原文（设备端 aapt2 link 直接用它，不再合成只含 ShellActivity 的清单） */
  manifestText?: string;
  /** M266：项目自带的依赖库（.jar / .aar），设备端 ECJ 编译时加进 classpath，解决 androidx/jxl 等引用 */
  libs?: { path: string; base64: string }[];
  /** M272：项目里引用 R 的包名清单（多包共存/反编译工程），设备端给每个包复制一份 R.java */
  rPackages?: string[];
  /** M286：是否注入「运行日志抽屉」（日志/生命周期/崩溃），默认 false */
  axvLog?: boolean;
  /** M464（方案 A）：发布包模式 = 不注壳 dex / 不注 ShellActivity / 不注日志抽屉 → APK 与 gradle 构建等价。默认 false（带壳，老行为） */
  releaseMode?: boolean;
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
  /** M216："none" = 无 Java 源码的布局壳；M254："java:<classes>:<dex>" = 编译了 <classes> 个类并注入 <dex> 个 dex（缓存命中时 classes=0）；老包 "java:<n>" = <n> 个 dex */
  compileMode?: string;
  /** M216：编译并注入的 dex 数量（只有 compileMode 以 java: 开头时才有意义；M254 起优先用 compileMode 解析） */
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
      // M254：ECJ 会刷一堆 "res-miss: ... messages_zh.properties" 资源缺失告警（无害但刷屏），
      // 展示前滤掉，只留真正有意义的日志行；连续空行压缩掉
      if (r.log) r.log = cleanBuildLog(r.log);
      fn(r);
    };
  });
}

/** M254：滤掉 ECJ 的 res-miss 告警行 + 压缩连续空行（这些不影响构建，纯噪音） */
export function cleanBuildLog(log: string): string {
  if (!log) return log;
  const lines = log
    .split("\n")
    .filter((l) => !/^\s*res-miss:/.test(l) && !/^\s*res miss:/.test(l));
  // 压缩 ≥2 个连续空行为 1 个
  return lines
    .reduce<string[]>((acc, l) => {
      if (l.trim() === "" && acc[acc.length - 1] === "") return acc;
      acc.push(l);
      return acc;
    }, [""] as string[])
    .join("\n")
    .replace(/\n\s*$/, "");
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
  /** 真编译的 .class 个数（M254 起由原生上报；缓存命中时未知记 0） */
  classes: number;
  /** 注入的 dex 个数（>0 就是真的能跑逻辑） */
  dex: number;
} {
  const cm = r?.compileMode || "";
  if (cm.startsWith("java:")) {
    const rest = cm.slice(5);
    // M254：新格式 java:<classes>:<dex>；老包只有 java:<n>（那时 n 是 dex 数）
    const parts = rest.split(":");
    const a = Number(parts[0]);
    const b = parts.length > 1 ? Number(parts[1]) : a;
    const classes = Number.isFinite(a) ? a : 0;
    const dex = Number.isFinite(b) ? b : 0;
    return { mode: "java", classes, dex };
  }
  if (cm === "none" || cm === "shell" || cm === "shell-no-compiler") return { mode: "shell", classes: 0, dex: 0 };
  return { mode: "unknown", classes: 0, dex: 0 };
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
