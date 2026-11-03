// @vitest-environment jsdom
// M90b：代码编辑器 4 个颜色跟亮/暗主题走
import { describe, expect, it } from "vitest";
import {
  DARK_EDITOR_COLORS,
  DEFAULT_EDITOR_THEME,
  applyEditorTheme,
  colorsFor,
  normalizeTheme,
  parseTheme,
  themeVars,
  type EditorTheme,
} from "../lib/xml/editor-theme";

const withDark = (patch: Partial<EditorTheme["dark"]> = {}, base = DEFAULT_EDITOR_THEME): EditorTheme => ({
  ...base,
  dark: patch,
});

describe("M90b 代码编辑器分亮/暗", () => {
  it("浅色模式仍然用 editorTheme 的平铺字段（向后兼容）", () => {
    const t = { ...DEFAULT_EDITOR_THEME, cursor: "#111111", selBg: "#222222" };
    expect(colorsFor(t, "light").cursor).toBe("#111111");
    expect(colorsFor(t, "light").selBg).toBe("#222222");
    // 不传 mode 默认浅色
    expect(colorsFor(t)).toEqual(colorsFor(t, "light"));
  });

  it("深色模式没单独设过时用 DARK_EDITOR_COLORS，绝不回落到浅色值", () => {
    const c = colorsFor(DEFAULT_EDITOR_THEME, "dark");
    expect(c.cursor).toBe(DARK_EDITOR_COLORS.cursor);
    expect(c.selBg).toBe(DARK_EDITOR_COLORS.selBg);
    expect(c.curBg).toBe(DARK_EDITOR_COLORS.curBg);
    // 浅色光标是深色 #24292F，在深底上会看不见 —— 必须不同
    expect(c.cursor).not.toBe(DEFAULT_EDITOR_THEME.cursor);
  });

  it("深色单独改过的项生效，没改的项仍走深色默认", () => {
    const t = withDark({ cursor: "#FF0000" });
    const c = colorsFor(t, "dark");
    expect(c.cursor).toBe("#FF0000");
    expect(c.selBg).toBe(DARK_EDITOR_COLORS.selBg);
    // 浅色不受影响
    expect(colorsFor(t, "light").cursor).toBe(DEFAULT_EDITOR_THEME.cursor);
  });

  it("themeVars 按 mode 输出不同的 CSS 变量", () => {
    const light = themeVars(DEFAULT_EDITOR_THEME, "light");
    const dark = themeVars(DEFAULT_EDITOR_THEME, "dark");
    expect(light["--axv-code-cursor"]).toBe(DEFAULT_EDITOR_THEME.cursor);
    expect(dark["--axv-code-cursor"]).toBe(DARK_EDITOR_COLORS.cursor);
    expect(dark["--axv-code-sel-bg"]).toBe(DARK_EDITOR_COLORS.selBg);
    expect(dark["--axv-code-cur-bg"]).toBe(DARK_EDITOR_COLORS.curBg);
    // 字号/高亮方案不跟亮暗变
    expect(dark["--axv-code-font-size"]).toBe(light["--axv-code-font-size"]);
  });

  it("showCur=false 时两套都是 transparent", () => {
    const t = { ...DEFAULT_EDITOR_THEME, showCur: false };
    expect(themeVars(t, "light")["--axv-code-cur-bg"]).toBe("transparent");
    expect(themeVars(t, "dark")["--axv-code-cur-bg"]).toBe("transparent");
  });

  it("选区文字色 transparent → inherit（亮暗都一样）", () => {
    expect(themeVars(DEFAULT_EDITOR_THEME, "light")["--axv-code-sel-fg"]).toBe("inherit");
    expect(themeVars(DEFAULT_EDITOR_THEME, "dark")["--axv-code-sel-fg"]).toBe("inherit");
  });

  it("normalizeTheme 保留合法 dark，丢掉非法项；没有 dark 时不写这个 key", () => {
    const t = normalizeTheme({
      dark: { cursor: "#ABCDEF", selBg: "not-a-color", evil: "#fff" },
    });
    expect(t.dark?.cursor).toBe("#ABCDEF");
    expect(t.dark?.selBg).toBeUndefined();
    expect(Object.keys(t)).not.toContain("evil");
    expect(Object.keys(normalizeTheme({}))).not.toContain("dark");
  });

  it("旧数据（只有平铺字段，没有 dark）解析后深色仍安全", () => {
    const legacy = JSON.stringify({
      hl: "light",
      cursor: "#24292F",
      selBg: "rgba(4, 64, 159, 0.18)",
      selFg: "transparent",
      curBg: "rgba(11, 95, 165, 0.08)",
      showCur: true,
      fontSize: 13,
      indent: 4,
    });
    const t = parseTheme(legacy);
    expect(t.dark).toBeUndefined();
    expect(colorsFor(t, "dark").cursor).toBe(DARK_EDITOR_COLORS.cursor);
  });

  it("applyEditorTheme 写到 DOM 的是当前模式那一套", () => {
    const root = document.createElement("div");
    applyEditorTheme(DEFAULT_EDITOR_THEME, "dark", root);
    expect(root.style.getPropertyValue("--axv-code-cursor")).toBe(DARK_EDITOR_COLORS.cursor);
    applyEditorTheme(DEFAULT_EDITOR_THEME, "light", root);
    expect(root.style.getPropertyValue("--axv-code-cursor")).toBe(DEFAULT_EDITOR_THEME.cursor);
  });
});
