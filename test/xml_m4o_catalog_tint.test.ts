// test/xml_m4o_catalog_tint.test.ts — CardView 模板属性修正 + tint 进属性目录
// 用户 2026-10-28：① CardView 模板用了不存在的 android:radius，应为 app:cardCornerRadius
//                 ② ImageView/ImageButton 特有的 tint（色调）要能加进属性列表
import { describe, it, expect } from "vitest";
import { WIDGET_MAP } from "../components/widget-catalog";
import { ATTR_CATALOG, editorFor } from "../components/attr-catalog";
import { parseLayoutXml } from "../lib/xml/parser";

describe("M4o CardView 模板", () => {
  const xml = WIDGET_MAP["card"].xml;

  it("不再用不存在的 android:radius，改用 app:cardCornerRadius", () => {
    expect(xml).not.toContain("android:radius");
    expect(xml).toContain("app:cardCornerRadius=");
  });

  it("带 app: 前缀就必须声明 xmlns:app", () => {
    expect(xml).toContain('xmlns:app="http://schemas.android.com/apk/res-auto"');
  });

  it("模板能被解析成 0 个 error", () => {
    const wrapped = xml.replace(/\s*\n\s*/g, "\n");
    const { root, issues } = parseLayoutXml(wrapped);
    expect(root?.tag).toBe("androidx.cardview.widget.CardView");
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("M4o tint 属性", () => {
  it("属性目录里有 tint（颜色编辑器）和 tintMode（枚举）", () => {
    const tint = ATTR_CATALOG.find((a) => a.name === "tint");
    const mode = ATTR_CATALOG.find((a) => a.name === "tintMode");
    expect(tint?.editor).toBe("color");
    expect(tint?.tags).toContain("ImageView");
    expect(tint?.tags).toContain("ImageButton");
    expect(mode?.editor).toBe("enum");
    expect(mode?.options).toContain("src_in");
  });

  it("editorFor 对 tint 返回 color，不再落到普通输入框", () => {
    expect(editorFor("tint", "").editor).toBe("color");
    expect(editorFor("tintMode", "src_in").editor).toBe("enum");
  });

  it("ImageButton 也能看到 tint（tags 命中）", () => {
    const tint = ATTR_CATALOG.find((a) => a.name === "tint");
    expect(tint?.tags?.includes("ImageButton")).toBe(true);
  });
});
