import { describe, it, expect } from "vitest";
import {
  ANDROID_THEME_PRESETS,
  androidThemeGroups,
  androidThemeById,
  writeThemeIntoValues,
  themeToItems,
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
});
