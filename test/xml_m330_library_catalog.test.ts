import { describe, it, expect } from "vitest";
import { LIBRARY_CATALOG, libKey, libDownloadUrl, libDownloadUrls, groupCatalog, mavenBase } from "../lib/xml/library-catalog";

describe("M330 library-catalog（内置库目录）", () => {
  it("目录非空且每个条目字段完整", () => {
    expect(LIBRARY_CATALOG.length).toBeGreaterThan(10);
    for (const e of LIBRARY_CATALOG) {
      expect(e.group.length).toBeGreaterThan(0);
      expect(e.artifact.length).toBeGreaterThan(0);
      expect(e.version.length).toBeGreaterThan(0);
      expect(e.kind).toMatch(/androidx|material|thirdparty/);
      expect(e.note.length).toBeGreaterThan(0);
      expect(typeof e.isAar).toBe("boolean");
    }
  });

  it("libKey 唯一且含坐标", () => {
    const keys = new Set(LIBRARY_CATALOG.map(libKey));
    expect(keys.size).toBe(LIBRARY_CATALOG.length);
    expect(keys.has("com.google.android.material:material:1.12.0")).toBe(true);
  });

  it("下载 URL 正确（Google Maven vs Maven Central）", () => {
    const mat = LIBRARY_CATALOG.find((e) => e.artifact === "material")!;
    expect(libDownloadUrl(mat)).toBe("https://dl.google.com/dl/android/maven2/com/google/android/material/material/1.12.0/material-1.12.0.aar");
    const gson = LIBRARY_CATALOG.find((e) => e.artifact === "gson")!;
    expect(libDownloadUrl(gson)).toBe("https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar");
    expect(mavenBase(gson)).toBe("https://repo1.maven.org/maven2");
    expect(mavenBase(mat)).toBe("https://dl.google.com/dl/android/maven2");
  });

  it("M331 候选镜像：局域网最先，国内镜像在前、官方源在后", () => {
    const mat = LIBRARY_CATALOG.find((e) => e.artifact === "material")!;
    const urls = libDownloadUrls(mat);
    expect(urls.length).toBe(5);
    expect(urls[0]).toBe("http://192.168.31.101:8080/_dl/libs/material-1.12.0.aar");
    expect(urls[1]).toContain("maven.aliyun.com/repository/google/");
    expect(urls[3]).toContain("repo.huaweicloud.com");
    expect(urls[4]).toContain("dl.google.com");
    expect(urls[1]).toContain("material-1.12.0.aar");
    const gson = LIBRARY_CATALOG.find((e) => e.artifact === "gson")!;
    const gu = libDownloadUrls(gson);
    expect(gu[0]).toBe("http://192.168.31.101:8080/_dl/libs/gson-2.10.1.jar");
    expect(gu[1]).toContain("maven.aliyun.com/repository/central/");
    expect(gu[4]).toContain("repo1.maven.org");
  });

  it("分组正确（material/androidx/thirdparty）", () => {
    const groups = groupCatalog();
    expect(groups.map((g) => g.kind)).toEqual(["material", "androidx", "thirdparty"]);
    const mat = groups.find((g) => g.kind === "material")!;
    expect(mat.libs.length).toBe(1);
    expect(mat.libs[0].artifact).toBe("material");
    const ax = groups.find((g) => g.kind === "androidx")!;
    expect(ax.libs.length).toBeGreaterThan(5);
  });

  it("M334 新增二维码/实用库：ZXing + retrofit 在清单里", () => {
    const zx = LIBRARY_CATALOG.find((e) => e.artifact === "core" && e.group === "com.google.zxing");
    expect(zx).toBeDefined();
    expect(zx!.isAar).toBe(false);
    expect(zx!.note).toContain("二维码");
    const retrofit = LIBRARY_CATALOG.find((e) => e.artifact === "retrofit");
    expect(retrofit?.isAar).toBe(false);
  });
});
