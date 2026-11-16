import { describe, it, expect } from "vitest";
import {
  ANDROID_THEME_PRESETS,
  androidThemeGroups,
  androidThemeById,
  writeThemeIntoValues,
  themeToItems,
  argbToCss,
} from "../lib/xml/android-theme-presets";

describe("M316 Android 主题预设库", () => {
  it("三大系列都有条目", () => {
    const groups = androidThemeGroups();
    const names = groups.map((g) => g.group);
    expect(names).toContain("appcompat");
    expect(names).toContain("material2");
    expect(names).toContain("material3");
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });

  it("每个 preset 都有合法 parent + 调色板", () => {
    for (const p of ANDROID_THEME_PRESETS) {
      expect(p.parent.length).toBeGreaterThan(0);
      expect(/^#/.test(p.light.primary)).toBe(true);
      expect(/^#/.test(p.light.surface)).toBe(true);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(0);
    }
  });

  it("material3 变体覆盖 DayNight/Light/Dark/NoActionBar/全屏", () => {
    const m3 = ANDROID_THEME_PRESETS.filter((p) => p.group === "material3");
    const joined = m3.map((p) => p.parent).join(",");
    expect(joined).toContain("DayNight");
    expect(joined).toContain("Light");
    expect(joined).toContain("Dark");
    expect(joined).toContain("NoActionBar");
    expect(joined).toContain("Fullscreen");
  });

  it("themeToItems 输出标准 Material 颜色项", () => {
    const m3l = androidThemeById("material3-light");
    const items = themeToItems(m3l);
    expect(items.find((i) => i.item === "colorPrimary")?.value).toBe(m3l.light.primary);
    expect(items.find((i) => i.item === "colorOnPrimary")?.value).toBe(m3l.light.onPrimary);
  });

  it("写回空 themes.xml 生成骨架", () => {
    const out = writeThemeIntoValues("", androidThemeById("material2-light"));
    expect(out).toContain("<resources>");
    expect(out).toContain('<style name="Theme.MyApp" parent="Theme.MaterialComponents.Light">');
    expect(out).toContain('<item name="colorPrimary">#FF6200EE</item>');
    expect(out).toContain("</resources>");
  });

  it("替换已有同名 style，保留其它 style", () => {
    const xml = `<resources>
      <style name="Theme.MyApp" parent="Theme.Material3.Light"><item name="colorPrimary">#111111</item></style>
      <style name="Other"><item name="x">y</item></style>
    </resources>`;
    const out = writeThemeIntoValues(xml, androidThemeById("material3-light"));
    expect(out).toContain("Theme.Material3.Light");
    expect(out).not.toContain("#111111");
    expect(out).toContain("Other"); // 其它 style 保留
    // 不重复
    expect(out.match(/Theme\.MyApp/g)).toHaveLength(1);
  });

  it("全屏主题多写 windowFullscreen", () => {
    const items = themeToItems(androidThemeById("material3-fullscreen"));
    expect(items.find((i) => i.item === "android:windowFullscreen")?.value).toBe("true");
  });

  it("argbToCss 把 Android #AARRGGBB 转成 CSS 颜色", () => {
    // 关键回归：不转的话 #FF9E9E9E 会被浏览器当 #RRGGBBAA → 半透明淡红
    expect(argbToCss("#FF9E9E9E")).toBe("rgb(158, 158, 158)");
    expect(argbToCss("#FF000000")).toBe("rgb(0, 0, 0)");
    expect(argbToCss("#80000000")).toBe("rgba(0, 0, 0, 0.502)");
    expect(argbToCss("#6200EE")).toBe("#6200EE"); // 无 alpha 原样
  });
});

import { findAppThemeStyle } from "../lib/xml/android-theme-presets";

describe("M321 对话框主题区分", () => {
  it("有独立的 dialog 分组，8 个对话框预设均标 kind=dialog", () => {
    const groups = androidThemeGroups();
    const dg = groups.find((g) => g.group === "dialog");
    expect(dg).toBeTruthy();
    expect(dg!.items.length).toBe(8);
    for (const p of dg!.items) expect(p.kind).toBe("dialog");
  });

  it("非 dialog 预设 kind 缺省为 activity", () => {
    const m3l = androidThemeById("material3-light");
    expect(m3l.kind ?? "activity").toBe("activity");
  });

  it("dialog 主题的 themeToItems 不写 windowBackground/colorBackground（弹窗背景由系统 Dialog 自带）", () => {
    const dl = androidThemeById("material2-light-dialog");
    expect(dl.kind).toBe("dialog");
    const items = themeToItems(dl);
    expect(items.find((i) => i.item === "android:windowBackground")).toBeUndefined();
    expect(items.find((i) => i.item === "android:colorBackground")).toBeUndefined();
    // 但颜色项仍在
    expect(items.find((i) => i.item === "colorPrimary")?.value).toBe(dl.light.primary);
  });

  it("activity 主题仍写 windowBackground", () => {
    const m3l = androidThemeById("material3-light");
    const items = themeToItems(m3l);
    expect(items.find((i) => i.item === "android:windowBackground")?.value).toBe(m3l.light.surface);
  });

  it("dialog 主题写回默认用 styleName=Theme.MyDialog（不覆盖 app 的 Theme.MyApp）", () => {
    const dl = androidThemeById("material3-light-dialog");
    const out = writeThemeIntoValues("", dl);
    expect(out).toContain('<style name="Theme.MyDialog" parent="Theme.Material3.Light.Dialog">');
    expect(out).not.toContain('Theme.MyApp');
  });

  it("findAppThemeStyle 排除 dialog 主题（不把 Theme.MyDialog 当应用主题）", () => {
    const xml = `<resources>
      <style name="Theme.MyApp" parent="Theme.Material3.Light"><item name="colorPrimary">#FF6750A4</item></style>
      <style name="Theme.MyDialog" parent="Theme.Material3.Light.Dialog"><item name="colorPrimary">#FF6750A4</item></style>
    </resources>`;
    expect(findAppThemeStyle([{ path: "values/themes.xml", text: xml }])).toBe("Theme.MyApp");
    // 只有 dialog 主题时 → undefined（不拿它当 app 主题）
    const onlyDialog = `<resources>
      <style name="Theme.MyDialog" parent="Theme.Material3.Light.Dialog"><item name="colorPrimary">#FF6750A4</item></style>
    </resources>`;
    expect(findAppThemeStyle([{ path: "values/themes.xml", text: onlyDialog }])).toBeUndefined();
  });
});
