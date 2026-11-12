// test/xml_plugin_fetch.test.ts
import { describe, it, expect } from "vitest";
import { pluginUrl, cacheKey, verifyDownload, expectedDownloadBytes, PLUGINS_REPO } from "@/lib/xml/plugin-fetch";

const manifest = JSON.stringify({
  id: "ecj-d8",
  name: "Java 编译器",
  version: "3.33.0",
  loader: "dex",
  files: [
    { path: "tool1.bin", size: 1000, sha256: "aa".repeat(32), role: "compiler-dex" },
    { path: "android.jar", size: 5000, sha256: "bb".repeat(32), role: "classpath" },
    { path: "res", size: 0, sha256: "", role: "i18n" },
  ],
});

describe("pluginUrl", () => {
  it("拼出 GitHub Release 附件 URL", () => {
    const u = pluginUrl("ecj-d8", "3.33.0");
    expect(u).toBe(`https://github.com/${PLUGINS_REPO}/releases/download/ecj-d8-3.33.0/ecj-d8-3.33.0.zip`);
  });
  it("带 token 时不影响 base（token 走 header）", () => {
    const u = pluginUrl("kotlin", "1.9", "ghp_xxx");
    expect(u).toContain("kotlin-1.9/kotlin-1.9.zip");
  });
});

describe("cacheKey", () => {
  it("id+version 唯一", () => {
    expect(cacheKey("ecj-d8", "3.33.0")).toBe("axv.plugin.ecj-d8.3.33.0");
    expect(cacheKey("ecj-d8", "3.33.0")).not.toBe(cacheKey("ecj-d8", "3.34.0"));
  });
});

describe("verifyDownload", () => {
  it("全对 → ok", () => {
    const c = verifyDownload(manifest, "ecj-d8", {
      "tool1.bin": { size: 1000, sha256: "aa".repeat(32) },
      "android.jar": { size: 5000, sha256: "bb".repeat(32) },
      res: { size: 0, sha256: "" },
    });
    expect(c.ok).toBe(true);
  });
  it("tool1 缺 → 精确报", () => {
    const c = verifyDownload(manifest, "ecj-d8", {
      "android.jar": { size: 5000, sha256: "bb".repeat(32) },
      res: { size: 0, sha256: "" },
    });
    expect(c.ok).toBe(false);
    expect(c.issues.find((i) => i.file === "tool1.bin")?.msg).toMatch(/缺/);
  });
});

describe("expectedDownloadBytes", () => {
  it("合计各文件 size", () => {
    expect(expectedDownloadBytes(manifest, "ecj-d8")).toBe(6000);
  });
});
