// lib/plugin/compiler.ts — M235：编译器插件管理
//
// 编译器（ECJ + D8 dex + android.jar）现在是内置资源（assets/compiler/），
// 但 axv-plugins 仓库里有最新版 manifest.json。这里提供：
//   - fetchCompilerManifest()：拉 axv-plugins 的 manifest，返回版本信息
//   - COMPILER_PLUGIN_META：硬编码的编译器插件元数据（和 EditorRegistry 风格一致）
//
// 下载编译器是 Native 层（MainActivity.ensureCompiler / M228 下载器），
// 这个文件只做「查版本 + 显示状态」，不实际下载。

export interface CompilerPluginInfo {
  id: string;
  name: string;
  language: string; // "java" | "kotlin" | "c" | "cpp" | "html" | "ts" | "js"
  version: string;
  source: "builtin" | "remote";
  manifestUrl: string;
  loader: string; // "dex"
  fileCount: number;
}

/** axv-plugins 仓库里编译器的 manifest URL（jsDelivr） */
export const COMPILER_MANIFEST_URL =
  "https://cdn.jsdelivr.net/gh/jiji5188/axv-plugins@main/manifest.json";

/** 拉编译器 manifest，返回解析后的信息。网络失败返回 null */
export async function fetchCompilerInfo(): Promise<CompilerPluginInfo | null> {
  try {
    const r = await fetch(COMPILER_MANIFEST_URL, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const m = (await r.json()) as {
      id: string;
      name?: string;
      language?: string;
      version?: string;
      loader?: string;
      files?: Array<{ path: string }>;
    };
    return {
      id: m.id || "compiler",
      name: m.name || "Java 编译器（ECJ + D8）",
      language: m.language || "java",
      version: m.version || "unknown",
      source: "remote",
      manifestUrl: COMPILER_MANIFEST_URL,
      loader: m.loader || "dex",
      fileCount: m.files?.length || 0,
    };
  } catch {
    return null;
  }
}

/** 硬编码的内置编译器信息（不依赖网络，APK 内 assets 一定有） */
export const BUILTIN_COMPILER: CompilerPluginInfo = {
  id: "compiler-ecj-d8",
  name: "Java 编译器（ECJ + D8）",
  language: "java",
  version: "3.33.0",
  source: "builtin",
  manifestUrl: COMPILER_MANIFEST_URL,
  loader: "dex",
  fileCount: 3, // tool1 + tool2 + msgs (+ android.jar external)
};
