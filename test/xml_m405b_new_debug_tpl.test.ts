// test/xml_m405b_new_debug_tpl.test.ts — M405b：新建文件「调试入口类」模板 + 工具栏 ＋ 菜单 4 项
import { describe, expect, it } from "vitest";
import { NEW_FILE_CATEGORIES, findTemplate, renderTemplate } from "@/lib/xml/new-file";
import { DEFAULT_NEW_ITEMS, type NewItemKind } from "@/components/ToolbarNewMenu";

describe("M405b java-debug 模板", () => {
  it("java 分类里有 java-debug 模板，含 main/debug 入口", () => {
    const ft = findTemplate("java", "java-debug");
    expect(ft).toBeTruthy();
    expect(ft?.tpl.ext).toBe(".java");
    const out = renderTemplate(ft!.tpl.body, "MyCalc");
    expect(out).toContain("public class MyCalc");
    expect(out).toContain("public static void debug()");
    expect(out).toContain("public static void main(String[] args)");
    expect(out).toContain("System.out.println");
  });
  it("java-debug 模板在 NEW_FILE_CATEGORIES 里能查到", () => {
    const cat = NEW_FILE_CATEGORIES.find((c) => c.key === "java")!;
    expect(cat.templates.some((t) => t.key === "java-debug")).toBe(true);
  });
});

describe("M405b 工具栏 ＋ 菜单 4 项", () => {
  it("默认含 activity/java/debug/layout 4 项", () => {
    const items = DEFAULT_NEW_ITEMS((k: NewItemKind) => void 0);
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(["activity", "java", "debug", "layout"]);
    expect(items[2].label).toContain("调试入口");
  });
});
