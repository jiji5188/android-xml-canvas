// M342：insertIntoStyle 单元测试
import { describe, it, expect } from "vitest";
import { parseValues, insertIntoStyle, groupByContainer, appendStyle } from "@/lib/xml/values-edit";

const SAMPLE = `<resources>
    <style name="Theme.MyApp" parent="Theme.Material3.Light.NoActionBar">
        <item name="android:colorPrimary">#0B5FA5</item>
        <item name="android:colorAccent">#D32F2F</item>
    </style>
    <style name="Theme.MyApp.Dialog" parent="Theme.MyApp">
        <item name="android:windowBackground">@color/white</item>
    </style>
    <string name="app_name">My App</string>
</resources>
`;

describe("insertIntoStyle", () => {
  it("在 style 闭合标签前插入新属性", () => {
    const doc = parseValues(SAMPLE);
    expect(doc.ok).toBe(true);
    // 找到第一个 style head
    const head = doc.items.find((i) => i.name === "Theme.MyApp" && i.valueFrom < 0)!;
    expect(head).toBeDefined();

    const next = insertIntoStyle(SAMPLE, head, { tag: "item", name: "android:statusBarColor", value: "#1B1B1B" });
    expect(next).toContain("<item name=\"android:statusBarColor\">#1B1B1B</item>");
    // 新属性在 </style> 之前
    const styleClose = next.indexOf("</style>");
    const newAttr = next.indexOf("android:statusBarColor");
    expect(newAttr).toBeLessThan(styleClose);

    // 验证解析正确
    const doc2 = parseValues(next);
    expect(doc2.ok).toBe(true);
    const groups = groupByContainer(doc2);
    const g0 = groups.find((g) => g.head?.name === "Theme.MyApp")!;
    expect(g0.children.length).toBe(3);
    const names = g0.children.map((c) => c.name);
    expect(names).toContain("android:statusBarColor");
  });

  it("多个 style 节点互不影响", () => {
    const doc = parseValues(SAMPLE);
    // 往第二个 style 插入
    const head2 = doc.items.find((i) => i.name === "Theme.MyApp.Dialog" && i.valueFrom < 0)!;
    const next = insertIntoStyle(SAMPLE, head2, { tag: "item", name: "android:colorPrimary", value: "#FF5722" });
    // 第一个 style 不变
    expect(next.indexOf("<item name=\"android:colorPrimary\">#0B5FA5</item>")).toBeGreaterThanOrEqual(0);
    // 第二个 style 有新属性
    const doc2 = parseValues(next);
    const groups = groupByContainer(doc2);
    const g1 = groups.find((g) => g.head?.name === "Theme.MyApp")!;
    const g2 = groups.find((g) => g.head?.name === "Theme.MyApp.Dialog")!;
    expect(g1.children.length).toBe(2);
    expect(g2.children.length).toBe(2);
    const newAttr = g2.children.find((c) => c.name === "android:colorPrimary");
    expect(newAttr?.value).toBe("#FF5722");
  });

  it("空 style 节点（自闭合）也能插入", () => {
    const empty = `<resources>\n    <style name="Theme.Empty" parent="Theme.Material3.Light" />\n</resources>\n`;
    const doc = parseValues(empty);
    expect(doc.ok).toBe(true);
    const head = doc.items.find((i) => i.name === "Theme.Empty" && i.valueFrom < 0)!;
    expect(head).toBeDefined();
    const next = insertIntoStyle(empty, head, { tag: "item", name: "android:colorPrimary", value: "#123456" });
    expect(next).toContain("<item name=\"android:colorPrimary\">#123456</item>");
    expect(next).toContain("</style>");
  });

  it("保持原有属性顺序", () => {
    const doc = parseValues(SAMPLE);
    const head = doc.items.find((i) => i.name === "Theme.MyApp" && i.valueFrom < 0)!;
    const next = insertIntoStyle(SAMPLE, head, { tag: "item", name: "android:windowBackground", value: "#FFFFFF" });
    const doc2 = parseValues(next);
    const groups = groupByContainer(doc2);
    const g0 = groups.find((g) => g.head?.name === "Theme.MyApp")!;
    const names = g0.children.map((c) => c.name);
    // 原有 2 个 + 新增 1 个 = 3
    expect(names.length).toBe(3);
    // 原有顺序不变
    expect(names[0]).toBe("android:colorPrimary");
    expect(names[1]).toBe("android:colorAccent");
    expect(names[2]).toBe("android:windowBackground");
  });

  it("沿用该 style 子项现有缩进（而非顶层+2）", () => {
    // 顶层 2 空格、子项 6 缩进（非标准 4+2）
    const xml = `<resources>\n  <style name="A">\n      <item name="x">1</item>\n  </style>\n</resources>\n`;
    const doc = parseValues(xml);
    const head = doc.items.find((i) => i.name === "A" && i.valueFrom < 0)!;
    const next = insertIntoStyle(xml, head, { tag: "item", name: "y", value: "2" });
    expect(next).toContain("      <item name=\"y\">2</item>");
    // 原有子项顺序保持
    const doc2 = parseValues(next);
    const g = groupByContainer(doc2).find((x) => x.head?.name === "A")!;
    expect(g.children.map((c) => c.name)).toEqual(["x", "y"]);
  });

  it("无子项的 style 用顶层+2 缩进", () => {
    const xml = `<resources>\n    <style name="B" parent="Theme.Material"/>\n    <string name="s">hi</string>\n</resources>\n`;
    const doc = parseValues(xml);
    const head = doc.items.find((i) => i.name === "B" && i.valueFrom < 0)!;
    expect(head).toBeDefined();
    const next = insertIntoStyle(xml, head, { tag: "item", name: "x", value: "1" });
    expect(next).toContain("      <item name=\"x\">1</item>"); // 4+2=6
    expect(next).toContain("</style>");
  });
});

describe("appendStyle（M342 新建 style 节点）", () => {
  const EMPTY = `<resources>\n    <string name="s">hi</string>\n</resources>\n`;

  it("在 </resources> 前插入完整 style 块（带 parent）", () => {
    const next = appendStyle(EMPTY, "Theme.New", "Theme.Material3.Light");
    expect(next).toContain(`<style name="Theme.New" parent="Theme.Material3.Light">`);
    expect(next).toContain(`</style>`);
    // 在 string 之后、</resources> 之前
    expect(next.indexOf("<string")).toBeLessThan(next.indexOf("Theme.New"));
    expect(next.indexOf("Theme.New")).toBeLessThan(next.lastIndexOf("</resources>"));
    const doc = parseValues(next);
    expect(doc.ok).toBe(true);
    const head = doc.items.find((i) => i.name === "Theme.New" && i.valueFrom < 0)!;
    expect(head).toBeDefined();
    expect(head.parent).toBe("Theme.Material3.Light");
  });

  it("不带 parent 也能建", () => {
    const next = appendStyle(EMPTY, "Theme.Bare");
    expect(next).toContain(`<style name="Theme.Bare">`);
    expect(next).not.toContain("Theme.Bare\" parent");
  });

  it("连续新建多个 style 互不干扰", () => {
    const next1 = appendStyle(EMPTY, "Theme.A");
    const next2 = appendStyle(next1, "Theme.B");
    const doc = parseValues(next2);
    const heads = doc.items.filter((i) => i.valueFrom < 0);
    expect(heads.map((h) => h.name)).toEqual(["Theme.A", "Theme.B"]);
  });

  it("空 resources 文件（无子项）也能插入", () => {
    const next = appendStyle("<resources>\n</resources>", "Theme.X", "Theme.Material");
    expect(next).toContain("Theme.X");
    const doc = parseValues(next);
    expect(doc.ok).toBe(true);
  });
});
