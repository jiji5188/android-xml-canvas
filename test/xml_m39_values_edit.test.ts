import { describe, expect, it } from "vitest";
import {
  appendItem,
  colorForPreview,
  detectIndent,
  escValue,
  hasName,
  isColorValue,
  lineAt,
  parseValues,
  removeItem,
  renderItem,
  setItemName,
  setItemValue,
  uniqueName,
} from "@/lib/xml/values-edit";

const COLORS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 主色 -->
    <color name="primary">#0B5FA5</color>
    <color name="accent">#FF6600</color>
    <dimen name="gap">8dp</dimen>
</resources>
`;

describe("M39 parseValues", () => {
  it("解析出条目、顺序、值区间、行号", () => {
    const d = parseValues(COLORS);
    expect(d.ok).toBe(true);
    expect(d.items.map((i) => i.name)).toEqual(["primary", "accent", "gap"]);
    expect(d.items.map((i) => i.kind)).toEqual(["color", "color", "dimen"]);
    expect(d.items[0].value).toBe("#0B5FA5");
    expect(d.items[0].line).toBe(4);
    expect(d.items[2].line).toBe(6);
    // 值区间精确指向文本
    const it0 = d.items[0];
    expect(COLORS.slice(it0.valueFrom, it0.valueTo)).toBe("#0B5FA5");
    expect(COLORS.slice(it0.elemFrom, it0.elemEnd)).toBe('<color name="primary">#0B5FA5</color>');
  });

  it("<item type=...> 归到 type 对应的 kind", () => {
    const xml = `<resources><item type="color" name="c1">#fff</item><item name="x">y</item></resources>`;
    const d = parseValues(xml);
    expect(d.items[0].kind).toBe("color");
    expect(d.items[0].itemType).toBe("color");
    expect(d.items[1].kind).toBe("other");
  });

  it("自闭合条目也算一条（值为空）", () => {
    const d = parseValues(`<resources><string name="empty" /></resources>`);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].value).toBe("");
    expect(d.items[0].tag).toBe("string");
  });

  it("CDATA 展示时去掉包裹，但区间仍覆盖原文", () => {
    const xml = `<resources><string name="a"><![CDATA[<b>hi</b>]]></string></resources>`;
    const d = parseValues(xml);
    expect(d.items[0].value).toBe("<b>hi</b>");
    expect(xml.slice(d.items[0].valueFrom, d.items[0].valueTo)).toContain("CDATA");
  });

  it("嵌套 style 的子项不会被当成顶层条目", () => {
    const xml = `<resources><style name="AppTheme" parent="X"><item name="android:textColor">#fff</item></style></resources>`;
    const d = parseValues(xml);
    expect(d.items.map((i) => i.name)).toEqual(["AppTheme"]);
    expect(d.items[0].kind).toBe("other");
  });

  it("属性里带 > 也不会把标签截断", () => {
    const xml = `<resources><string name="arrow">a &gt; b</string></resources>`;
    const d = parseValues(xml);
    expect(d.items[0].value).toBe("a &gt; b");
  });

  it("没有 resources / 没有闭合标签时报错", () => {
    expect(parseValues("<LinearLayout/>").ok).toBe(false);
    expect(parseValues("<resources><color name=\"a\">#fff</color>").ok).toBe(false);
  });

  it("空文件不抛异常", () => {
    expect(() => parseValues("")).not.toThrow();
    expect(parseValues("").items).toEqual([]);
  });
});

describe("M39 编辑操作（保留注释与格式）", () => {
  it("setItemValue 只改值，其他字不动", () => {
    const d = parseValues(COLORS);
    const out = setItemValue(COLORS, d.items[1], "#00FF00");
    expect(out).toContain('<color name="accent">#00FF00</color>');
    expect(out).toContain("<!-- 主色 -->");
    expect(out).toContain('<color name="primary">#0B5FA5</color>');
    expect(out.length).toBe(COLORS.length); // #FF6600 → #00FF00 长度相同
  });

  it("setItemValue 会转义 & < >", () => {
    const d = parseValues(COLORS);
    const out = setItemValue(COLORS, d.items[0], "a & b < c");
    expect(out).toContain("a &amp; b &lt; c");
  });

  it("setItemName 只改 name 属性值", () => {
    const d = parseValues(COLORS);
    const out = setItemName(COLORS, d.items[0], "brand");
    expect(out).toContain('<color name="brand">#0B5FA5</color>');
  });

  it("removeItem 连行一起删，不留空行", () => {
    const d = parseValues(COLORS);
    const out = removeItem(COLORS, d.items[1]);
    expect(out).not.toContain("accent");
    expect(out).not.toContain("\n\n\n"); // 没有连续空行
    expect(parseValues(out).items.map((i) => i.name)).toEqual(["primary", "gap"]);
  });

  it("appendItem 插在 </resources> 前，沿用 4 空格缩进", () => {
    const out = appendItem(COLORS, { tag: "color", name: "newC", value: "#123456" });
    const d = parseValues(out);
    expect(d.items.map((i) => i.name)).toEqual(["primary", "accent", "gap", "newC"]);
    expect(out).toContain('    <color name="newC">#123456</color>\n</resources>');
  });

  it("appendItem 尊重已有 2 空格缩进与 CRLF", () => {
    const xml = "<resources>\r\n  <color name=\"a\">#fff</color>\r\n</resources>\r\n";
    const out = appendItem(xml, { tag: "color", name: "b", value: "#000" });
    expect(out).toContain('  <color name="b">#000</color>\r\n</resources>');
  });

  it("appendItem 支持 <item type=...>", () => {
    const out = appendItem(COLORS, {
      tag: "item",
      itemType: "dimen",
      name: "half",
      value: "4dp",
    });
    expect(out).toContain('<item type="dimen" name="half">4dp</item>');
    expect(parseValues(out).items.at(-1)?.kind).toBe("dimen");
  });

  it("单行 resources 也能追加", () => {
    const out = appendItem("<resources></resources>", { tag: "string", name: "a", value: "b" });
    expect(parseValues(out).items).toHaveLength(1);
  });
});

describe("M39 工具函数", () => {
  it("escValue / lineAt", () => {
    expect(escValue('a"b&c<d')).toBe('a"b&amp;c&lt;d');
    expect(lineAt("a\nb\nc", 4)).toBe(3);
    expect(lineAt("abc", 0)).toBe(1);
  });

  it("isColorValue / colorForPreview", () => {
    expect(isColorValue("#fff")).toBe(true);
    expect(isColorValue("#0B5FA5")).toBe(true);
    expect(isColorValue("#80FFFFFF")).toBe(true);
    expect(isColorValue("@color/primary")).toBe(true);
    expect(isColorValue("8dp")).toBe(false);
    expect(colorForPreview("#0B5FA5")).toBe("#0B5FA5");
    expect(colorForPreview("#abc")).toBe("#aabbcc");
    expect(colorForPreview("#8abc")).toBe("#aabbcc");
    expect(colorForPreview("#80FFFFFF")).toBe("#FFFFFF");
    expect(colorForPreview("8dp")).toBeNull();
    expect(colorForPreview("@color/primary")).toBeNull();
  });

  it("detectIndent 默认 4 空格、认 tab", () => {
    expect(detectIndent(COLORS)).toBe("    ");
    expect(detectIndent("<resources>\n\t<color name=\"a\">#fff</color>\n</resources>")).toBe("\t");
    expect(detectIndent("<resources></resources>")).toBe("    ");
  });

  it("hasName / uniqueName 去重", () => {
    const d = parseValues(COLORS);
    expect(hasName(d, "primary")).toBe(true);
    expect(hasName(d, "primary", d.items[0])).toBe(false);
    expect(uniqueName(d, "primary")).toBe("primary_2");
    expect(uniqueName(d, "brand new!")).toBe("brand_new_");
  });

  it("renderItem 只给 item 加 type", () => {
    expect(renderItem("color", "a", "#fff")).toBe('    <color name="a">#fff</color>');
    expect(renderItem("item", "a", "1dp", { itemType: "dimen" })).toContain('type="dimen"');
    expect(renderItem("string", "a", "b", { itemType: "dimen" })).not.toContain("type=");
  });
});
