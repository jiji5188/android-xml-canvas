// test/xml_plugin_fetch.test.ts
import { describe, it, expect } from "vitest";
import { pluginUrl, pluginFileName, manifestUrl, cacheKey, verifyDownload, expectedDownloadBytes, PLUGINS_REPO, PLUGINS_BASE } from "@/lib/xml/plugin-fetch";

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
  it("拼出 raw 直链", () => {
    const u = pluginUrl("ecj-d8", "3.33.0");
    expect(u).toBe(`${PLUGINS_BASE}/ecj-d8-3.33.0.zip`);
    expect(u).toContain("raw.githubusercontent.com/" + PLUGINS_REPO);
  });
  it("文件名可单独取", () => {
    expect(pluginFileName("kotlin", "1.9")).toBe("kotlin-1.9.zip");
  });
  it("manifest URL 按 id/version 分目录", () => {
    expect(manifestUrl("ecj-d8", "3.33.0")).toBe(`${PLUGINS_BASE}/ecj-d8/3.33.0/manifest.json`);
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
