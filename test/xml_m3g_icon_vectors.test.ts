// test/xml_m3g_icon_vectors.test.ts — M3g 图标选择器：TTF → Android vector XML
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIconFont, getIconVector, iconResourceName, hasIcon, isIconFontLoaded } from "../lib/xml/icon-vectors";

const ttf = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "material-symbols-rounded.ttf"));

describe("M3g 图标 vector 转换", () => {
  it("加载 TTF 后 isIconFontLoaded 为 true，共 4000+ glyph", async () => {
    await loadIconFont(ttf.buffer.slice(0));
    expect(isIconFontLoaded()).toBe(true);
    for (const n of ["search", "home", "menu", "close", "check", "add", "delete", "settings", "person", "favorite"]) {
      expect({ n, ok: hasIcon(n) }).toEqual({ n, ok: true });
    }
  });

  it("不存在的图标名返回 false", () => {
    expect(hasIcon("definitely_not_an_icon_xyz")).toBe(false);
  });

  it("getIconVector 生成合法 vector XML（含 pathData）", () => {
    const xml = getIconVector("search");
    expect(xml).not.toBeNull();
    expect(xml).toContain("<vector");
    expect(xml).toContain("android:width=\"24dp\"");
    expect(xml).toContain("android:pathData=\"");
    // pathData 非空且是合法 SVG 路径命令
    const m = /android:pathData="([^"]+)"/.exec(xml!);
    expect(m?.[1].length).toBeGreaterThan(50);
    expect(/^[MLCQZ ]/.test(m![1])).toBe(true);
  });

  it("home 的 pathData 含 M 命令（有起点）", () => {
    const xml = getIconVector("home");
    const m = /android:pathData="([^"]+)"/.exec(xml!);
    expect(m?.[1]).toMatch(/^M/);
  });

  it("iconResourceName 生成合法 Android 资源名", () => {
    expect(iconResourceName("search")).toBe("ic_search");
    expect(iconResourceName("home")).toBe("ic_home");
    // 带点/横线/大写的名字
    expect(iconResourceName("MyIcon")).toBe("ic_myicon");
    expect(iconResourceName("ic-x")).toBe("ic_ic_x"); // 前缀+名字
    // 特殊字符被替换
    expect(iconResourceName("add:plus")).toBe("ic_add_plus");
    // 带连字符
    expect(iconResourceName("add-plus")).toBe("ic_add_plus");
    // 超长名字截断到 31
    expect(iconResourceName("a".repeat(50)).length).toBe(31);
  });

  it("不同 fillColor 参数生效", () => {
    const xml = getIconVector("check", "#FF0000");
    expect(xml).toContain("android:fillColor=\"#FF0000\"");
  });

  it("getIconVector 未知图标返回 null", () => {
    expect(getIconVector("no_such_icon_abc")).toBeNull();
  });
});
