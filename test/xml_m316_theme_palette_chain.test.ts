import { describe, it, expect } from "vitest";
import { writeThemeIntoValues, androidThemeById, findAppThemeStyle } from "../lib/xml/android-theme-presets";
import { buildPalette } from "../lib/xml/theme-palette";
import { collectThemeAttrs, parseStylesXml } from "../lib/xml/resdir";
import { androidColorToCss } from "../lib/xml/color-argb";

// M316 数据链验证：writeThemeIntoValues 写出的 themes.xml → parseStylesXml + collectThemeAttrs
// → buildPalette 读出的 primary/surface，应与预设调色板一致（证明预览框会跟着主题变色）
function paletteFromThemeXml(xml: string) {
  const raw = new Map<string, { parent?: string; attrs: Record<string, string> }>();
  parseStylesXml(xml, raw as any);
  const themeAttrs = collectThemeAttrs(raw as any);
  const palette = buildPalette({ themeAttrs, colors: {} } as any);
  return { themeAttrs, palette };
}

describe("M316 主题写回 → 预览调色板链路", () => {
  it("Material3 · Light 写回后 buildPalette 取到预设主色", () => {
    const preset = androidThemeById("material3-light");
    const xml = writeThemeIntoValues("", preset);
    const { themeAttrs, palette } = paletteFromThemeXml(xml);
    expect(themeAttrs.colorPrimary).toBe(preset.light.primary);
    // buildPalette 把 #AARRGGBB 转成 CSS，应与 androidColorToCss 一致
    expect(palette.fromProject).toBe(true);
    expect(palette.primary.toLowerCase()).toBe(androidColorToCss(preset.light.primary).toLowerCase());
  });

  it("Material3 · Dark 写回后 buildPalette 取到深色 surface（近黑）", () => {
    const preset = androidThemeById("material3-dark");
    const xml = writeThemeIntoValues("", preset);
    const { palette } = paletteFromThemeXml(xml);
    expect(palette.fromProject).toBe(true);
    // 深色 surface #FF141218 → androidColorToCss 后为 #141218（近黑）
    expect(palette.surface.toLowerCase()).toBe(androidColorToCss(preset.dark!.surface).toLowerCase());
  });

  it("同名 style 替换后旧主色不残留", () => {
    const p1 = androidThemeById("material2-light");
    const p2 = androidThemeById("material3-light");
    let xml = writeThemeIntoValues("", p1);
    xml = writeThemeIntoValues(xml, p2);
    const { themeAttrs } = paletteFromThemeXml(xml);
    expect(themeAttrs.colorPrimary).toBe(p2.light.primary);
  });
});

describe("findAppThemeStyle（M317 原生预览应用主题）", () => {
  it("themes.xml 里有 Theme.MyApp → 返回它", () => {
    const xml =
      "<resources><style name=\"Theme.MyApp\" parent=\"Theme.Material3.Light\"/></resources>";
    expect(findAppThemeStyle([{ path: "values/themes.xml", text: xml }])).toBe(
      "Theme.MyApp",
    );
  });
  it("没有 Theme.MyApp 但有 theme 开头的 style → 返回它", () => {
    const xml = "<resources><style name=\"Theme.Legacy\"/><style name=\"Btn\"/></resources>";
    expect(findAppThemeStyle([{ path: "values/styles.xml", text: xml }])).toBe(
      "Theme.Legacy",
    );
  });
  it("没有主题文件 → undefined（预览不崩）", () => {
    expect(
      findAppThemeStyle([{ path: "values/strings.xml", text: "<resources/>" }]),
    ).toBeUndefined();
    expect(findAppThemeStyle([])).toBeUndefined();
  });
});
