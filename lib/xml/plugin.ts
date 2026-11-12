// lib/xml/plugin.ts — 插件机制纯逻辑（可单测）
//
// 设计（对标竞品「手机编程」的插件化，填合法件）：
//   一个插件 = 一个目录 + 一份 manifest.json。主程序只认 manifest，不认识具体编译器。
//   加语言/加编译器/加模板 = 丢一个目录进来，壳代码零改动。
//
// 本模块只做「纯逻辑」：解析 manifest、逐文件校验、目录发现、缺件精确定位。
// 原生侧（MainActivity）和 JS 下载侧（plugin-fetch.ts）都调这里，保证口径一致。

/** 一个资源文件条目（manifest.files[] 的一项） */
export interface PluginFileEntry {
  /** 相对插件目录的文件名（如 "tool1.bin.gz"） */
  path: string;
  /** 文件未压缩字节数（用于校验，防止 0 字节/截断） */
  size: number;
  /** 未压缩内容的 sha256（hex，小写） */
  sha256: string;
  /** 角色标注（compiler-dex / classpath / i18n / runtime / ...），仅人读 */
  role?: string;
}

/** 一个插件的清单 */
export interface PluginManifest {
  /** 插件 id（目录名，如 "ecj-d8"） */
  id: string;
  /** 人类可读名（如 "Java 编译器（ECJ + D8）"） */
  name: string;
  /** 编译器/工具版本 */
  version: string;
  /** 加载方式（原生据此选 InMemoryDexClassLoader / loadLibrary / ...） */
  loader: "dex" | "native" | "wasm" | "zip";
  /** 各文件清单 */
  files: PluginFileEntry[];
}

export type Severity = "error" | "warn";

/** 校验结果里的一条问题 */
export interface PluginIssue {
  severity: Severity;
  /** 缺的是哪个文件（path），无则 "" */
  file: string;
  msg: string;
}

/** 一个插件的校验状态 */
export interface PluginCheck {
  id: string;
  ok: boolean;
  issues: PluginIssue[];
  /** 全部文件合计字节（按 manifest 期望值） */
  expectedBytes: number;
}

/** 按「目录名 == id」发现 manifest：给定 { id: manifestText } */
export function parsePluginManifest(id: string, text: string): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const m = raw as Record<string, unknown> | undefined;
    void m;
    throw new Error("插件 " + id + " 的 manifest.json 不是合法 JSON：" + String(e));
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id !== id) {
    // manifest.id 必须与目录名一致（防止放错位置）
    throw new Error("插件 manifest 的 id('" + String(o.id) + "') 与目录名('" + id + "') 不一致");
  }
  if (typeof o.name !== "string" || typeof o.version !== "string") {
    throw new Error("插件 " + id + " 缺 name/version 字段");
  }
  const loader = o.loader;
  if (loader !== "dex" && loader !== "native" && loader !== "wasm" && loader !== "zip") {
    throw new Error("插件 " + id + " 的 loader('" + String(loader) + "') 不受支持");
  }
  if (!Array.isArray(o.files) || o.files.length === 0) {
    throw new Error("插件 " + id + " 的 files 为空或不是数组");
  }
  const files: PluginFileEntry[] = o.files.map((f, i) => {
    const ff = f as Record<string, unknown>;
    if (typeof ff.path !== "string" || typeof ff.size !== "number" || typeof ff.sha256 !== "string") {
      throw new Error("插件 " + id + " 的 files[" + i + "] 缺 path/size/sha256");
    }
    const role = typeof ff.role === "string" ? ff.role : "";
    const isOptional = role === "i18n"; // 目录型/可缺省项：允许 size=0 / sha256 空
    if (!isOptional) {
      if (!/^[a-f0-9]{64}$/.test(ff.sha256)) {
        throw new Error("插件 " + id + " 的 files[" + i + "] sha256 非法（需 64 位小写 hex）");
      }
      if (ff.size <= 0) throw new Error("插件 " + id + " 的 files[" + i + "] size 必须为正");
    }
    return { path: ff.path, size: ff.size, sha256: ff.sha256, role: role || undefined };
  });
  return { id, name: o.name, version: o.version, loader, files };
}

/**
 * 按 manifest 校验「实际可读到的文件」。
 * @param manifest     清单
 * @param actual       { path -> { size, sha256 } } 实际读到/能读到文件的统计。
 *                     读不到的文件**不出现在 actual**（等价于缺失）
 * @returns 校验状态（含逐文件缺件/损坏的精确问题）
 */
export function checkPlugin(manifest: PluginManifest, actual: Record<string, { size: number; sha256: string }>): PluginCheck {
  const issues: PluginIssue[] = [];
  let expectedBytes = 0;
  for (const f of manifest.files) {
    expectedBytes += f.size;
    const a = actual[f.path];
    if (!a) {
      issues.push({ severity: "error", file: f.path, msg: "缺文件（" + (f.role || "未知") + "）：" + f.path });
      continue;
    }
    if (a.size !== f.size) {
      issues.push({ severity: "error", file: f.path, msg: "大小不符（期望 " + f.size + "，实际 " + a.size + "），可能截断" });
      continue;
    }
    if (a.sha256.toLowerCase() !== f.sha256.toLowerCase()) {
      issues.push({ severity: "error", file: f.path, msg: "哈希不符（sha256 对不上），文件已损坏或被改" });
    }
  }
  return { id: manifest.id, ok: issues.length === 0, issues, expectedBytes };
}

/**
 * 把一组 manifest 文本（{ id: text }）解析成 manifest 列表。
 * 单个坏 manifest 不影响其它插件（记为 error 状态，不抛）。
 */
export function discoverPlugins(src: Record<string, string>): { ok: PluginCheck[]; failed: PluginIssue[] } {
  const ok: PluginCheck[] = [];
  const failed: PluginIssue[] = [];
  for (const id of Object.keys(src).sort()) {
    try {
      ok.push({ id, ok: true, issues: [], expectedBytes: 0 }); // 先占位，调用方再 fill 实际校验
      parsePluginManifest(id, src[id]);
    } catch (e) {
      failed.push({ severity: "error", file: "manifest.json", msg: "插件 " + id + " 解析失败：" + String((e as Error).message) });
    }
  }
  return { ok, failed };
}

/** 人类可读汇总（用于日志/缓存管理页） */
export function summarize(checks: PluginCheck[]): string {
  if (checks.length === 0) return "没有插件";
  const lines: string[] = [];
  for (const c of checks) {
    if (c.ok) lines.push("✓ " + c.id + " 就绪（" + (c.expectedBytes / 1048576).toFixed(1) + "MB）");
    else for (const is of c.issues) lines.push("✗ " + c.id + (is.file ? " " + is.file : "") + "：" + is.msg);
  }
  return lines.join("\n");
}
