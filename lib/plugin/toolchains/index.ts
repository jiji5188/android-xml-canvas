// lib/plugin/toolchains/index.ts — M409：内置工具链注册入口
//
// 新增一门语言：在 toolchains/ 下加一个文件 → 这里 import + register 一行 → 完事。
// 宿主（use-build-apk / use-debug-run / XmlEditor）一行都不用改。

import { ToolchainRegistry, type Toolchain } from "../toolchain-registry";
import { androidJavaToolchain } from "./android-java";
import { jsToolchain } from "./js";

export { androidJavaToolchain } from "./android-java";
export type { AndroidJavaToolchain, DebugSourceInput } from "./android-java";
export { jsToolchain } from "./js";
export type { JsToolchain } from "./js";

/**
 * 注册内置工具链（幂等：重复调用只覆盖，不重复）。
 * 注意：适配器的 build/run 入参是窄类型，注册时收窄成宽类型 Toolchain。
 */
export function registerBuiltinToolchains(): void {
  ToolchainRegistry.register(androidJavaToolchain as unknown as Toolchain);
  ToolchainRegistry.register(jsToolchain as unknown as Toolchain);
}
