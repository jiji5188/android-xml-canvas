import { describe, it, expect } from "vitest";
import { LIBRARY_CATALOG, libKey, libDownloadUrl, groupCatalog, mavenBase } from "../lib/xml/library-catalog";

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

  it("分组正确（material/androidx/thirdparty）", () => {
    const groups = groupCatalog();
    expect(groups.map((g) => g.kind)).toEqual(["material", "androidx", "thirdparty"]);
    const mat = groups.find((g) => g.kind === "material")!;
    expect(mat.libs.length).toBe(1);
    expect(mat.libs[0].artifact).toBe("material");
    const ax = groups.find((g) => g.kind === "androidx")!;
    expect(ax.libs.length).toBeGreaterThan(5);
  });
});
