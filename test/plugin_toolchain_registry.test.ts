// test/plugin_toolchain_registry.test.ts — M409：工具链插件化骨架
//
// 只测「注册表 + 能力位 + 零行为变更的适配器」，不测真实构建（真机才有原生桥）。
import { beforeEach, describe, expect, it } from "vitest";
import type { Toolchain } from "@/lib/plugin/toolchain-registry";
import { ToolchainRegistry } from "@/lib/plugin/toolchain-registry";
import {
  androidJavaToolchain,
  jsToolchain,
  registerBuiltinToolchains,
} from "@/lib/plugin/toolchains";
import { buildJsWorkerScript, hasJsRun } from "@/lib/xml/js-run";

function fakeToolchain(id: Toolchain["id"], exts: string[]): Toolchain {
  return {
    id,
    displayName: id,
    fileExtensions: exts,
    editorKind: "code",
    capabilities: {
      hasCanvas: false,
      hasRes: false,
      hasManifest: false,
      hasGradle: false,
      artifact: "script",
      runMode: "interpret",
    },
    syntax: { name: id, extensions: exts, lineComment: ["#"] },
    templates: [],
    canBuild: () => true,
    build: async () => ({ ok: true }),
  };
}

describe("M409 ToolchainRegistry", () => {
  beforeEach(() => {
    ToolchainRegistry.reset();
  });

  it("注册 / 按 id 取 / size", () => {
    ToolchainRegistry.register(fakeToolchain("c", [".c", ".h"]));
    ToolchainRegistry.register(fakeToolchain("python", [".py"]));
    expect(ToolchainRegistry.size).toBe(2);
    expect(ToolchainRegistry.get("c")?.displayName).toBe("c");
    expect(ToolchainRegistry.get("python")).not.toBeNull();
    expect(ToolchainRegistry.get("js")).toBeNull();
  });

  it("重复注册同 id 覆盖（幂等）", () => {
    ToolchainRegistry.register(fakeToolchain("c", [".c"]));
    ToolchainRegistry.register(fakeToolchain("c", [".c", ".h"]));
    expect(ToolchainRegistry.size).toBe(1);
    expect(ToolchainRegistry.get("c")?.fileExtensions).toEqual([".c", ".h"]);
  });

  it("按文件名找工具链（大小写不敏感、路径也能喂）", () => {
    ToolchainRegistry.register(androidJavaToolchain as unknown as Toolchain);
    expect(ToolchainRegistry.forFile("MainActivity.java")?.id).toBe("android-java");
    expect(ToolchainRegistry.forFile("src\\com\\x\\Foo.KT")?.id).toBe("android-java");
    expect(ToolchainRegistry.forFile("build.gradle.kts")?.id).toBe("android-java");
    expect(ToolchainRegistry.forFile("main.py")).toBeNull();
  });

  it("空文件名返回 null（不抛）", () => {
    ToolchainRegistry.register(fakeToolchain("c", [".c"]));
    expect(ToolchainRegistry.forFile("")).toBeNull();
  });

  it("reset 清空", () => {
    ToolchainRegistry.register(fakeToolchain("ts", [".ts"]));
    ToolchainRegistry.reset();
    expect(ToolchainRegistry.size).toBe(0);
    expect(ToolchainRegistry.ids()).toEqual([]);
  });
});

describe("M409 android-java 适配器", () => {
  it("能力位：全开 + APK + dex", () => {
    expect(androidJavaToolchain.capabilities).toEqual({
      hasCanvas: true,
      hasRes: true,
      hasManifest: true,
      hasGradle: true,
      artifact: "apk",
      runMode: "dex",
    });
  });

  it("语法：Java / 双斜杠行注释", () => {
    expect(androidJavaToolchain.syntax.name).toBe("Java");
    expect(androidJavaToolchain.syntax.lineComment).toEqual(["//"]);
    expect(androidJavaToolchain.syntax.blockComment).toEqual(["/*", "*/"]);
  });

  it("模板来自 NEW_FILE_CATEGORIES（含 M405b 的 java-debug）", () => {
    const keys = androidJavaToolchain.templates.map((t) => t.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("java:java-debug");
  });

  it("网页/无原生桥环境：canBuild() 为 false", () => {
    expect(androidJavaToolchain.canBuild()).toBe(false);
  });

  it("无原生桥时 build() 返回 ok:false + step:env（不抛）", async () => {
    const r = await androidJavaToolchain.build({
      pkg: "com.example.app",
      layout: "activity_main",
      files: [],
      keystore: "/tmp/k.p12",
      storePass: "x",
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("无原生桥时 canRun() 为 false，compileDex/runDex 返回 env（不抛）", async () => {
    expect(androidJavaToolchain.canRun?.()).toBe(false);
    const c = await androidJavaToolchain.compileDex({ pkg: "com.example.app", javaSources: [] });
    expect(c.ok).toBe(false);
    expect(c.step).toBe("env");
    const r = await androidJavaToolchain.runDex({ dex: [] });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("无原生桥时 run() 返回 ok:false + step:env（不抛，也不碰 debugRun）", async () => {
    const r = await androidJavaToolchain.run({
      pkg: "com.example.app",
      javaSources: [{ path: "com/example/app/Main.java", code: "class Main {}" }],
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("registerBuiltinToolchains 幂等注册（android-java + js 两个）", () => {
    ToolchainRegistry.reset();
    registerBuiltinToolchains();
    registerBuiltinToolchains();
    expect(ToolchainRegistry.size).toBe(2);
    expect(ToolchainRegistry.get("android-java")).not.toBeNull();
    expect(ToolchainRegistry.get("js")).not.toBeNull();
  });
});

describe("M412 编辑器外壳 + 目录探测", () => {
  it("editorKind：android-java 用全功能编辑器，js 用纯代码工作区", () => {
    expect(androidJavaToolchain.editorKind).toBe("android-xml");
    expect(jsToolchain.editorKind).toBe("code");
  });

  it("detect：Android 项目强信号叠加打分", () => {
    const files = (rels: string[]) => rels.map((rel) => ({ rel }));
    // 标准 Android 工程：高分
    expect(
      androidJavaToolchain.detect?.(
        files(["settings.gradle", "app/build.gradle", "app/src/main/AndroidManifest.xml", "app/src/main/res/layout/activity_main.xml"]),
      ),
    ).toBeGreaterThanOrEqual(10);
    // 只有 settings.gradle：弱信号，不爆分
    expect(androidJavaToolchain.detect?.(files(["settings.gradle"]))).toBe(3);
    // 空目录：0
    expect(androidJavaToolchain.detect?.(files([]))).toBe(0);
  });

  it("detect：js 项目（package.json 最强信号，不与 Android 混淆）", () => {
    const files = (rels: string[]) => rels.map((rel) => ({ rel }));
    expect(jsToolchain.detect?.(files(["package.json", "index.js"]))).toBeGreaterThanOrEqual(8);
    expect(jsToolchain.detect?.(files(["app/src/main/AndroidManifest.xml"]))).toBe(0);
  });

  it("detect：Windows 反斜杠路径也能认", () => {
    expect(
      androidJavaToolchain.detect?.([{ rel: "app\\src\\main\\AndroidManifest.xml" }]),
    ).toBe(10);
  });
});

describe("M409 JavaScript 工具链（第二门语言）", () => {
  it("能力位：无画布/资源/清单/Gradle，artifact=script，runMode=interpret", () => {
    expect(jsToolchain.capabilities).toEqual({
      hasCanvas: false,
      hasRes: false,
      hasManifest: false,
      hasGradle: false,
      artifact: "script",
      runMode: "interpret",
    });
  });

  it("无构建步：canBuild=false 且 build 未实现（纯脚本）", () => {
    expect(jsToolchain.canBuild()).toBe(false);
    // 窄类型下不声明 build（纯脚本无构建步），运行时属性确实不存在
    expect((jsToolchain as unknown as { build?: unknown }).build).toBeUndefined();
  });

  it("forFile 能命中 .js/.mjs/.cjs，且不会误抢 .java", () => {
    ToolchainRegistry.reset();
    registerBuiltinToolchains();
    expect(ToolchainRegistry.forFile("src/app.js")?.id).toBe("js");
    expect(ToolchainRegistry.forFile("m.mjs")?.id).toBe("js");
    expect(ToolchainRegistry.forFile("c.cjs")?.id).toBe("js");
    expect(ToolchainRegistry.forFile("Main.java")?.id).toBe("android-java");
  });

  it("Node 环境无 Worker：canRun=false，run() 返回 ok:false + step:env", async () => {
    expect(hasJsRun()).toBe(false);
    expect(jsToolchain.canRun?.()).toBe(false);
    const r = await jsToolchain.run({ code: "console.log(1)" });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("Worker 脚本包含控制台重定向 / main 调用 / 异常上报", () => {
    const src = buildJsWorkerScript("function main(a){return a.length}", ["x"]);
    expect(src).toContain("console");
    expect(src).toContain("postMessage");
    expect(src).toContain("main(args)");
    expect(src).toContain("AsyncFunction");
    // 源码 / 参数以 JSON 字面量嵌入（不会被当代码执行）
    expect(src).toContain(JSON.stringify("function main(a){return a.length}"));
    expect(src).toContain(JSON.stringify(["x"]));
  });
});
