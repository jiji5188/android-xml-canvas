// lib/plugin/toolchains/js.ts — M409 step4：JavaScript 工具链（第二门语言，验证接口设计）
//
// 选 JS 当第二门语言的理由：
//   - 不需要原生编译（设备上 WebView 直接跑）→ 立刻能验证「加语言 = 加一个文件」是否成立
//   - 已有 lib/xml/js-run.ts 沙箱（Worker + 超时 + 输出捕获）
//
// 无构建产物：artifact = "script"，canBuild() = false（UI 不显示「构建」按钮，只显示「▶ 运行」）

import type { JsRunInput, JsRunResult } from "@/lib/xml/js-run";
import { hasJsRun, runJs } from "@/lib/xml/js-run";
import type { Toolchain } from "../toolchain-registry";

/** 类型安全的 JS 工具链 */
export interface JsToolchain extends Omit<Toolchain, "id" | "build" | "run"> {
  id: "js";
  run(input: JsRunInput): Promise<JsRunResult>;
}

export const jsToolchain: JsToolchain = {
  id: "js",
  displayName: "JavaScript",
  fileExtensions: [".js", ".mjs", ".cjs"],
  // M412：纯代码工作区（无画布/资源/清单）
  editorKind: "code",

  /** M412：目录探测——package.json 是最强信号，其次是入口脚本 */
  detect(files) {
    const rels = files.map((f) => f.rel.replace(/\\/g, "/").toLowerCase());
    const has = (p: string) => rels.some((r) => r === p);
    let score = 0;
    if (has("package.json")) score += 8;
    if (has("index.js") || has("main.js") || has("app.js")) score += 4;
    if (rels.some((r) => r.endsWith(".js") || r.endsWith(".mjs"))) score += 1;
    return score;
  },

  capabilities: {
    hasCanvas: false,
    hasRes: false,
    hasManifest: false,
    hasGradle: false,
    artifact: "script",
    runMode: "interpret",
  },

  syntax: {
    name: "JavaScript",
    extensions: [".js", ".mjs", ".cjs"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    lexiconId: "javascript",
  },

  templates: [],

  canBuild: () => false,
  canRun: () => hasJsRun(),

  run: (input: JsRunInput) => runJs(input),
};
