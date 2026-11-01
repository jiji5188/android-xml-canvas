// test/xml_m65_res_refs.test.ts — M65：资源引用解析 + 在 values 文件里定位行号
import { describe, expect, it } from "vitest";
import { dirMatchesType, findValuesDefLine, parseResRef, resDirPrefix } from "../lib/xml/res-refs";

const strings = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">示例</string>
    <string name="other">其他</string>
    <!-- 注释里的 <string name="app_name"> 不算 -->
</resources>
`;

describe("M65 parseResRef", () => {
  it("解析普通资源引用", () => {
    expect(parseResRef("@string/app_name")).toMatchObject({ type: "string", name: "app_name" });
    expect(parseResRef("  @color/brand_blue  ")).toMatchObject({ type: "color", name: "brand_blue" });
    expect(parseResRef("@dimen/gap_8")).toMatchObject({ type: "dimen", name: "gap_8" });
    expect(parseResRef("@layout/activity_main")).toMatchObject({ type: "layout", name: "activity_main" });
  });

  it("框架资源 / 新建 id / 普通文本都不跳", () => {
    expect(parseResRef("@+id/btn_ok")).toBeNull();
    expect(parseResRef("@android:string/ok")).toBeNull();
    expect(parseResRef("?attr/colorPrimary")).toBeNull();
    expect(parseResRef("16dp")).toBeNull();
    expect(parseResRef("")).toBeNull();
    expect(parseResRef("@unknown/x")).toBeNull();
  });
});

describe("M65 目录与行号", () => {
  it("限定符目录也要命中（layout-land / values-night）", () => {
    expect(dirMatchesType("layout", "layout")).toBe(true);
    expect(dirMatchesType("layout-land", "layout")).toBe(true);
    expect(dirMatchesType("values-night", "color")).toBe(true);
    expect(dirMatchesType("values", "color")).toBe(true);
    expect(dirMatchesType("drawable-xxhdpi", "mipmap")).toBe(false);
    expect(dirMatchesType("layout", "color")).toBe(false);
  });

  it("values 类型统一去 values* 找", () => {
    expect(resDirPrefix("string")).toBe("values");
    expect(resDirPrefix("dimen")).toBe("values");
    expect(resDirPrefix("mipmap")).toBe("mipmap");
  });

  it("返回定义所在行号（1 起）", () => {
    expect(findValuesDefLine(strings, "string", "app_name")).toBe(3);
    expect(findValuesDefLine(strings, "string", "other")).toBe(4);
  });

  it("同名资源不存在时返回 0", () => {
    expect(findValuesDefLine(strings, "string", "nope")).toBe(0);
    expect(findValuesDefLine(strings, "color", "app_name")).toBe(0);
  });

  it("style 的 name 也认（不同标签）", () => {
    const styles = `<resources>
  <style name="AppTheme" parent="Theme.Material">
    <item name="colorPrimary">#FF0000</item>
  </style>
</resources>`;
    expect(findValuesDefLine(styles, "style", "AppTheme")).toBe(2);
  });
});
