// @vitest-environment jsdom
// test/xml_m235_compiler_plugin.test.ts — M235：编译器插件管理

import { describe, expect, it, vi } from "vitest";
import { BUILTIN_COMPILER, fetchCompilerInfo, COMPILER_MANIFEST_URL } from "@/lib/plugin/compiler";

describe("BUILTIN_COMPILER", () => {
  it("id 是 compiler-ecj-d8", () => {
    expect(BUILTIN_COMPILER.id).toBe("compiler-ecj-d8");
  });
  it("language 是 java", () => {
    expect(BUILTIN_COMPILER.language).toBe("java");
  });
  it("name 标明是 Java 编译器", () => {
    expect(BUILTIN_COMPILER.name).toContain("Java");
  });
  it("version 是 3.33.0", () => {
    expect(BUILTIN_COMPILER.version).toBe("3.33.0");
  });
  it("source 是 builtin", () => {
    expect(BUILTIN_COMPILER.source).toBe("builtin");
  });
});

describe("fetchCompilerInfo", () => {
  it("manifest 成功时返回 info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "ecj-d8",
            name: "Java 编译器（ECJ + D8）",
            language: "java",
            version: "3.34.0",
            loader: "dex",
            files: [{ path: "a" }, { path: "b" }],
          }),
          { status: 200 },
        ),
      ),
    );
    const info = await fetchCompilerInfo();
    expect(info?.id).toBe("ecj-d8");
    expect(info?.language).toBe("java");
    expect(info?.version).toBe("3.34.0");
    expect(info?.fileCount).toBe(2);
    vi.restoreAllMocks();
  });

  it("manifest 404 时返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const info = await fetchCompilerInfo();
    expect(info).toBeNull();
    vi.restoreAllMocks();
  });

  it("manifest URL 正确", () => {
    expect(COMPILER_MANIFEST_URL).toContain("jsdelivr");
    expect(COMPILER_MANIFEST_URL).toContain("manifest.json");
  });
});
