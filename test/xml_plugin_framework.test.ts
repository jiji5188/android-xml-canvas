// test/xml_plugin_framework.test.ts
import { describe, it, expect } from "vitest";
import { parsePluginManifest, checkPlugin, summarize } from "@/lib/xml/plugin";

const good = JSON.stringify({
  id: "ecj-d8",
  name: "Java 编译器（ECJ + D8）",
  version: "3.33.0",
  loader: "dex",
  files: [
    { path: "tool1.bin.gz", size: 1000, sha256: "aa".repeat(32), role: "compiler-dex" },
    { path: "android.jar.gz", size: 5000, sha256: "bb".repeat(32), role: "classpath" },
    { path: "msgs.bin.gz", size: 200, sha256: "cc".repeat(32), role: "i18n" },
  ],
});
const actualGood = {
  "tool1.bin.gz": { size: 1000, sha256: "aa".repeat(32) },
  "android.jar.gz": { size: 5000, sha256: "bb".repeat(32) },
  "msgs.bin.gz": { size: 200, sha256: "cc".repeat(32) },
};

describe("parsePluginManifest", () => {
  it("正常解析", () => {
    const m = parsePluginManifest("ecj-d8", good);
    expect(m.id).toBe("ecj-d8");
    expect(m.loader).toBe("dex");
    expect(m.files).toHaveLength(3);
    expect(m.files[0].role).toBe("compiler-dex");
  });
  it("id 与目录不一致抛错", () => {
    expect(() => parsePluginManifest("other", good)).toThrow(/不一致/);
  });
  it("坏 JSON 抛错", () => {
    expect(() => parsePluginManifest("x", "{not json")).toThrow(/JSON/);
  });
  it("缺 files 抛错", () => {
    const bad = JSON.stringify({ id: "x", name: "n", version: "1", loader: "dex", files: [] });
    expect(() => parsePluginManifest("x", bad)).toThrow(/files/);
  });
  it("sha256 非法抛错", () => {
    const bad = JSON.stringify({ id: "x", name: "n", version: "1", loader: "dex", files: [{ path: "a", size: 1, sha256: "zzz" }] });
    expect(() => parsePluginManifest("x", bad)).toThrow(/sha256/);
  });
  it("未知 loader 抛错", () => {
    const bad = JSON.stringify({ id: "x", name: "n", version: "1", loader: "weird", files: [{ path: "a", size: 1, sha256: "aa".repeat(32) }] });
    expect(() => parsePluginManifest("x", bad)).toThrow(/loader/);
  });
});

describe("checkPlugin", () => {
  it("全对 → ok", () => {
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), actualGood);
    expect(c.ok).toBe(true);
    expect(c.issues).toHaveLength(0);
    expect(c.expectedBytes).toBe(6200);
  });
  it("缺一个文件 → 精确报是哪个", () => {
    const a: Record<string, { size: number; sha256: string }> = {
      "tool1.bin.gz": { size: 1000, sha256: "aa".repeat(32) },
      "android.jar.gz": { size: 5000, sha256: "bb".repeat(32) },
      "msgs.bin.gz": { size: 200, sha256: "cc".repeat(32) },
    };
    delete a["tool1.bin.gz"];
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), a);
    expect(c.ok).toBe(false);
    expect(c.issues).toHaveLength(1);
    expect(c.issues[0].file).toBe("tool1.bin.gz");
    expect(c.issues[0].msg).toMatch(/缺文件/);
  });
  it("大小不符 → 报截断", () => {
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), {
      "tool1.bin.gz": { size: 10, sha256: "aa".repeat(32) },
      "android.jar.gz": actualGood["android.jar.gz"],
      "msgs.bin.gz": actualGood["msgs.bin.gz"],
    });
    expect(c.issues.find((i) => i.file === "tool1.bin.gz")?.msg).toMatch(/大小不符/);
  });
  it("哈希不符 → 报损坏", () => {
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), {
      "tool1.bin.gz": { size: 1000, sha256: "dd".repeat(32) },
      "android.jar.gz": actualGood["android.jar.gz"],
      "msgs.bin.gz": actualGood["msgs.bin.gz"],
    });
    expect(c.issues.find((i) => i.file === "tool1.bin.gz")?.msg).toMatch(/哈希不符/);
  });
  it("多个缺失全部报出", () => {
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), { "tool1.bin.gz": actualGood["tool1.bin.gz"] });
    expect(c.issues).toHaveLength(2); // android + msgs 缺
  });
});

describe("summarize", () => {
  it("ok 的列就绪", () => {
    const s = summarize([checkPlugin(parsePluginManifest("ecj-d8", good), actualGood)]);
    expect(s).toMatch(/✓ ecj-d8 就绪/);
  });
  it("坏的列原因", () => {
    const c = checkPlugin(parsePluginManifest("ecj-d8", good), { "tool1.bin.gz": actualGood["tool1.bin.gz"] });
    expect(summarize([c])).toMatch(/✗ ecj-d8/);
  });
});
