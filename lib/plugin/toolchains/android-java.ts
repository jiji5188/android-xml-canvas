// lib/plugin/toolchains/android-java.ts — M409：Android (Java/Kotlin) 工具链适配器
//
// 这一步是「零行为变更的纯加法」：内部全部转调现有实现，不改一行现有逻辑。
//   build → lib/xml/native-apk.ts#buildApk        （打 APK）
//   run   → lib/xml/debug-run.ts#debugCompile + #debugRun（设备端编译 dex + 动态执行）
//
// 以后加 C / C++ / Python / JS / TS 时，照这个文件再写一个即可，宿主一行不改。

import type { BuildApkInput, BuildApkResult } from "@/lib/xml/native-apk";
import { buildApk, hasBuildApk } from "@/lib/xml/native-apk";
import type {
  DebugCompileInput,
  DebugCompileResult,
  DebugRunInput,
  DebugRunResult,
} from "@/lib/xml/debug-run";
import { debugCompile, debugRun, hasDebugRun } from "@/lib/xml/debug-run";
import type {
  Toolchain,
  ToolchainTemplateSpec,
} from "../toolchain-registry";
import { NEW_FILE_CATEGORIES } from "@/lib/xml/new-file";

/**
 * 「运行」的源输入：工具链内部先编译成 dex，再动态执行。
 * 对外只暴露一个 run()，调用方不用关心是两步。
 */
export interface DebugSourceInput {
  /** 应用包名（生成 R.java 用） */
  pkg: string;
  /** 项目 Java 源码（path 相对项目根） */
  javaSources: { path: string; code: string }[];
  /** 依赖库（.jar / .aar 实体） */
  libs?: { path: string; base64: string }[];
  /** 候选入口类全限定名（自动探测用） */
  candidates?: string[];
  /** 显式入口类（不传则自动探测 main / debug） */
  entryClass?: string;
  /** 入口方法名 */
  entryMethod?: string;
  /** main(String[]) 的 args */
  args?: string[];
  /** 执行超时（毫秒），默认 30000 */
  timeoutMs?: number;
}

/** 类型安全的 Android 工具链（注册表里是宽类型 Toolchain，取出来可强转成这个） */
export interface AndroidJavaToolchain extends Omit<Toolchain, "id" | "build" | "run"> {
  id: "android-java";
  build(input: BuildApkInput): Promise<BuildApkResult>;
  /** ① 编译成 dex（两步调试的第一段，保留供需要进度提示的调用方使用） */
  compileDex(input: DebugCompileInput): Promise<DebugCompileResult>;
  /** ② 动态加载执行（两步调试的第二段） */
  runDex(input: DebugRunInput): Promise<DebugRunResult>;
  /** 两步合一（便捷入口；日志合并） */
  run(input: DebugSourceInput): Promise<DebugRunResult>;
}

/** 把现有 NEW_FILE_CATEGORIES 展平成工具链模板（「＋」菜单直接渲染） */
function templates(): ToolchainTemplateSpec[] {
  return NEW_FILE_CATEGORIES.flatMap((c) =>
    c.templates.map((t) => ({
      key: `${c.key}:${t.key}`,
      label: t.label,
      ext: t.ext,
      body: t.body,
      companion: t.companion,
    })),
  );
}

export const androidJavaToolchain: AndroidJavaToolchain = {
  id: "android-java",
  displayName: "Android (Java/Kotlin)",
  fileExtensions: [".java", ".kt", ".kts"],
  // M412：入口页按这个挂全功能编辑器（画布 + 资源 + 清单 + 签名）
  editorKind: "android-xml",

  /**
   * M412：目录探测——三个强信号叠加打分。
   * 只要有 app/src/main/AndroidManifest.xml 就基本确定（10 分），
   * 单独的 settings.gradle / res 目录只能算弱信号（不抢 JS 项目的 package.json）。
   */
  detect(files) {
    const rels = files.map((f) => f.rel.replace(/\\/g, "/").toLowerCase());
    const has = (p: string) => rels.some((r) => r === p);
    const hasUnder = (p: string) => rels.some((r) => r.endsWith("/" + p) || r.startsWith(p));
    let score = 0;
    if (has("app/src/main/androidmanifest.xml")) score += 10;
    if (has("settings.gradle") || has("settings.gradle.kts")) score += 3;
    if (has("app/build.gradle") || has("app/build.gradle.kts")) score += 3;
    if (hasUnder("src/main/res/")) score += 2;
    if (rels.some((r) => /\.(java|kt)$/.test(r))) score += 1;
    return score;
  },

  capabilities: {
    hasCanvas: true,
    hasRes: true,
    hasManifest: true,
    hasGradle: true,
    artifact: "apk",
    runMode: "dex",
  },

  syntax: {
    name: "Java",
    extensions: [".java"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    lexiconId: "java",
  },

  get templates() {
    return templates();
  },

  canBuild: () => hasBuildApk(),
  canRun: () => hasDebugRun(),

  build: (input: BuildApkInput) => buildApk(input),

  compileDex: (input: DebugCompileInput) => debugCompile(input),

  runDex: (input: DebugRunInput) => debugRun(input),

  /**
   * 两步合一：先编译成 dex（失败直接返回 compile 步），再动态执行。
   * 日志合并（编译日志 + 执行日志），便于面板一次展示。
   */
  run: async (input: DebugSourceInput): Promise<DebugRunResult> => {
    if (!hasDebugRun()) {
      return {
        ok: false,
        step: "env",
        log: "当前不在 App 里（网页版没有 ECJ/D8），请在手机上调试运行",
      };
    }
    const compileInput: DebugCompileInput = {
      pkg: input.pkg,
      javaSources: input.javaSources,
      libs: input.libs,
      candidates: input.candidates,
    };
    const c = await debugCompile(compileInput);
    if (!c.ok || !c.dex || c.dex.length === 0) {
      return { ok: false, step: c.step || "compile", log: c.log };
    }
    const runInput: DebugRunInput = {
      dex: c.dex,
      entryClass: input.entryClass,
      entryMethod: input.entryMethod,
      args: input.args,
      timeoutMs: input.timeoutMs,
      candidates: input.candidates,
    };
    const r = await debugRun(runInput);
    const log = [c.log, r.log].filter((x): x is string => !!x && x.trim() !== "").join("\n");
    return { ...r, log: log || undefined };
  },
};

/** 旧导出兼容：注册入口已移到 toolchains/index.ts */
