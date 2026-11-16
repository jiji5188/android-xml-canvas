// @vitest-environment node
// M338：themes.xml 结构化视图（样式节点 name+parent 在前，属性配置缩进 + 中文说明）
import { describe, expect, it } from "vitest";
import { parseValues, removeItem, setItemValue, groupByContainer, topLevelNamesFromFiles } from "../lib/xml/values-edit";
import {
  THEME_ITEM_DESCS,
  allItemDescs,
  SYSTEM_PARENT_THEMES,
  themeItemDesc,
  themeItemDescText,
  themeItemType,
} from "../lib/xml/theme-item-descs";

const THEMES = `<resources>
  <style name="Theme.MyApp" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="colorPrimary">@color/primary</item>
    <item name="colorOnPrimary">@color/white</item>
    <item name="android:statusBarColor">?attr/colorPrimary</item>
    <item name="windowActionBar">false</item>
    <item name="myCustomAttr">1</item>
  </style>
</resources>`;

describe("M338 主题属性说明表", () => {
  it("收录 35 条 M3 / 系统属性", () => {
    expect(THEME_ITEM_DESCS).toHaveLength(35);
    for (const d of THEME_ITEM_DESCS) {
      expect(d.attr).toBeTruthy();
      expect(d.desc).toBeTruthy();
      expect(d.type).toMatch(/^(color|dimen|text|bool|other)$/);
    }
  });

  it("按名查说明（带/不带 android: 前缀都能命中）", () => {
    expect(themeItemDesc("colorPrimary")?.desc).toBe("M3 主色");
    expect(themeItemDesc("colorPrimary")?.type).toBe("color");
    expect(themeItemDesc("android:statusBarColor")?.desc).toBe("状态栏颜色");
    expect(themeItemDesc("statusBarColor")?.desc).toBe("状态栏颜色"); // 前缀回退
    expect(themeItemDescText("colorScrim")).toBe("遮罩颜色");
    expect(themeItemType("shapeCornerLarge")).toBe("dimen");
    expect(themeItemDesc("myCustomAttr")).toBeUndefined();
    expect(themeItemDescText("myCustomAttr")).toBe("");
    expect(themeItemType("myCustomAttr")).toBe("other");
  });
});

describe("M338 parseValues 结构化（样式在前、子项缩进 + 类型补齐）", () => {
  it("style 标题行排在最前，带 parent；子项 inStyle/depth=1", () => {
    const d = parseValues(THEMES);
    expect(d.ok).toBe(true);
    // 容器标题行（valueFrom=-1）排第一
    const head = d.items[0];
    expect(head.tag).toBe("style");
    expect(head.name).toBe("Theme.MyApp");
    expect(head.parent).toBe("Theme.Material3.DayNight.NoActionBar");
    expect(head.valueFrom).toBe(-1);
    expect(head.depth).toBe(0);
    // 子项紧随其后，都带 inStyle
    for (let i = 1; i < d.items.length; i++) {
      expect(d.items[i].inStyle).toBe("Theme.MyApp");
      expect(d.items[i].depth).toBe(1);
    }
  });

  it("style 里没写 type 的 item 按说明表补类型（colorPrimary→color，windowActionBar→bool）", () => {
    const d = parseValues(THEMES);
    const byName = Object.fromEntries(d.items.map((i) => [i.name, i]));
    expect(byName["colorPrimary"].kind).toBe("color");
    expect(byName["colorOnPrimary"].kind).toBe("color");
    expect(byName["android:statusBarColor"].kind).toBe("color");
    expect(byName["windowActionBar"].kind).toBe("bool");
    // 表里没有的自定义属性保持 other
    expect(byName["myCustomAttr"].kind).toBe("other");
  });

  it("改嵌套 item 的值正确回写，且不会动到样式标题行", () => {
    const d = parseValues(THEMES);
    const cp = d.items.find((i) => i.name === "colorPrimary")!;
    const out = setItemValue(THEMES, cp, "@color/newprimary");
    expect(out).toContain('<item name="colorPrimary">@color/newprimary</item>');
    expect(out).toContain('parent="Theme.Material3.DayNight.NoActionBar"');
    expect(out).toContain('<item name="windowActionBar">false</item>');
  });

  it("删样式标题行 = 删整个 <style> 块；删某 item 只删那一行", () => {
    const d = parseValues(THEMES);
    const head = d.items[0];
    const noStyle = removeItem(THEMES, head);
    expect(noStyle).not.toContain("colorPrimary");
    expect(noStyle).not.toContain("Theme.MyApp");
    const cp = d.items.find((i) => i.name === "colorPrimary")!;
    const noCp = removeItem(THEMES, cp);
    // 只删 <item name="colorPrimary"> 这一行；其它 item（值里引用 colorPrimary 的）保留
    expect(noCp).not.toContain('<item name="colorPrimary">');
    expect(noCp).toContain("<style");
    expect(noCp).toContain("colorOnPrimary");
    expect(noCp).toContain('<item name="windowActionBar">false</item>');
  });

  it("M341 allItemDescs 去重且含 24 条控件样式属性", () => {
    const all = allItemDescs();
    expect(all.length).toBeGreaterThan(30); // 35 主题 + 24 控件 + 10 额外，去重后
    const names = all.map((d) => d.attr);
    // 无重复
    expect(new Set(names).size).toBe(names.length);
    // 控件属性在
    expect(names).toContain("android:background");
    expect(names).toContain("android:padding");
    expect(names).toContain("android:layout_width");
    // 主题属性在
    expect(names).toContain("colorPrimary");
  });

  it("M341 SYSTEM_PARENT_THEMES 常用系统主题名", () => {
    expect(SYSTEM_PARENT_THEMES.length).toBeGreaterThanOrEqual(6);
    expect(SYSTEM_PARENT_THEMES).toContain("Theme.Material3.Light");
    expect(SYSTEM_PARENT_THEMES).toContain("Theme.Material3.DayNight.NoActionBar");
    expect(SYSTEM_PARENT_THEMES).toContain("@android:style/Theme.DeviceDefault");
    expect(new Set(SYSTEM_PARENT_THEMES).size).toBe(SYSTEM_PARENT_THEMES.length);
  });

  it("M341 groupByContainer：style 容器收拢子项（含折叠）；无子项不折", () => {
    const d = parseValues(THEMES);
    const groups = groupByContainer(d);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    // head 是 style 标题行（顶层，inStyle 未设）
    expect(g.head?.name).toBe("Theme.MyApp");
    expect(g.children.length).toBe(5);
    expect(g.children.every((c) => c.inStyle === "Theme.MyApp")).toBe(true);
  });

  it("M341 topLevelNamesFromFiles：跨文件收顶层名、排除指定文件、不含 style 子项", () => {
    const colors = `<resources><color name="primary">#FF000000</color></resources>`;
    const themes = `<resources><style name="Theme.MyApp" parent="Theme.Material.Light"><item name="colorPrimary">#FF0</item></style></resources>`;
    const all = topLevelNamesFromFiles([
      { rel: "values/colors.xml", text: colors },
      { rel: "values/themes.xml", text: themes },
    ]);
    expect(all).toContain("primary");      // 顶层 color
    expect(all).toContain("Theme.MyApp"); // 顶层 style 名
    expect(all).not.toContain("colorPrimary"); // style 子项不算
    // 排除当前文件（themes）→ 只剩 colors 的 primary
    const onlyColors = topLevelNamesFromFiles(
      [
        { rel: "values/colors.xml", text: colors },
        { rel: "values/themes.xml", text: themes },
      ],
      "values/themes.xml",
    );
    expect(onlyColors).toContain("primary");
    expect(onlyColors).not.toContain("Theme.MyApp");
  });
});
