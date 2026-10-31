// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_THEME,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HL_PRESETS,
  applyEditorTheme,
  isColor,
  normalizeTheme,
  paletteOf,
  parseTheme,
  themeVars,
} from "@/lib/xml/editor-theme";

describe("M37 editor-theme 纯逻辑", () => {

  it("M40：indent 归一（越界收进 2-8，字符串/NaN 回默认）", () => {
    expect(normalizeTheme({ indent: 24 }).indent).toBe(8);
    expect(normalizeTheme({ indent: 1 }).indent).toBe(2);
    expect(normalizeTheme({ indent: "6" }).indent).toBe(6);
    expect(normalizeTheme({ indent: "abc" }).indent).toBe(4);
    expect(normalizeTheme(null).indent).toBe(4);
  });
  it("默认值与字号边界", () => {
    expect(DEFAULT_EDITOR_THEME).toEqual({
      hl: "light",
      cursor: "#24292F",
      selBg: "rgba(4, 64, 159, 0.18)",
      selFg: "transparent",
      curBg: "rgba(11, 95, 165, 0.08)",
      showCur: true,
      fontSize: 13,
      indent: 4,
    });
    expect(FONT_SIZE_MIN).toBe(11);
    expect(FONT_SIZE_MAX).toBe(16);
  });

  it("HL_PRESETS 五个方案字段齐全", () => {
    expect(HL_PRESETS).toHaveLength(5);
    for (const p of HL_PRESETS) {
      for (const k of ["bg", "fg", "tag", "attr", "str", "comm", "decl"] as const) {
        expect(typeof p.palette[k]).toBe("string");
      }
    }
    expect(paletteOf("dark").fg).toBe("#C9D1D9");
    expect(paletteOf("不存在的").tag).toBe(HL_PRESETS[0].palette.tag);
  });

  it("isColor：合法与非法", () => {
    expect(isColor("#abc")).toBe(true);
    expect(isColor("#aabbcc")).toBe(true);
    expect(isColor("rgba(1,2,3,0.5)")).toBe(true);
    expect(isColor("transparent")).toBe(true);
    expect(isColor("")).toBe(true);
    expect(isColor("red")).toBe(false); // 命名色不接受，避免与 color input 不一致
    expect(isColor("#12")).toBe(false);
    expect(isColor("rgb(256,0,0)")).toBe(false);
  });

  it("normalizeTheme：非法值回默认、字号夹在边界内", () => {
    const t = normalizeTheme({
      hl: "no-such",
      cursor: "red",
      selBg: "#000",
      selFg: "123",
      fontSize: 999,
    });
    expect(t.hl).toBe("light");
    expect(t.cursor).toBe(DEFAULT_EDITOR_THEME.cursor);
    expect(t.selBg).toBe("#000");
    expect(t.selFg).toBe("transparent");
    expect(t.fontSize).toBe(FONT_SIZE_MAX);
    expect(normalizeTheme({ fontSize: 1 }).fontSize).toBe(FONT_SIZE_MIN);
  });

  it("parseTheme：空/坏 JSON 回默认", () => {
    expect(parseTheme(null)).toEqual(DEFAULT_EDITOR_THEME);
    expect(parseTheme("{oops")).toEqual(DEFAULT_EDITOR_THEME);
    expect(parseTheme(JSON.stringify({ hl: "dark", fontSize: 15 }))).toEqual({
      ...DEFAULT_EDITOR_THEME,
      hl: "dark",
      fontSize: 15,
    });
  });

  it("themeVars：深色方案带 bg/fg，浅色不带", () => {
    const d = themeVars({ ...DEFAULT_EDITOR_THEME, hl: "dark" });
    expect(d["--axv-code-bg"]).toBe("#0D1117");
    expect(d["--axv-code-fg"]).toBe("#C9D1D9");
    expect(d["--axv-x-tag"]).toBe("#79C0FF");
    expect(d["--axv-code-cursor"]).toBe(DEFAULT_EDITOR_THEME.cursor);
    expect(d["--axv-code-font-size"]).toBe("13px");
    const l = themeVars(DEFAULT_EDITOR_THEME);
    expect(l["--axv-code-bg"]).toBeUndefined();
    expect(l["--axv-x-tag"]).toBe("#0B5FA5");
  });

  it("当前行背景：开关关掉时写 transparent", () => {
    const on = themeVars(DEFAULT_EDITOR_THEME);
    expect(on["--axv-code-cur-bg"]).toBe("rgba(11, 95, 165, 0.08)");
    const off = themeVars({ ...DEFAULT_EDITOR_THEME, showCur: false });
    expect(off["--axv-code-cur-bg"]).toBe("transparent");
    const custom = themeVars({ ...DEFAULT_EDITOR_THEME, curBg: "#ffeecc" });
    expect(custom["--axv-code-cur-bg"]).toBe("#ffeecc");
  });

  it("showCur 非布尔 → 回默认 true；curBg 非法 → 回默认色", () => {
    const t = normalizeTheme({ showCur: "yes", curBg: "chartreuse" });
    expect(t.showCur).toBe(true);
    expect(t.curBg).toBe(DEFAULT_EDITOR_THEME.curBg);
    expect(t.indent).toBe(4);
    expect(normalizeTheme({ showCur: false }).showCur).toBe(false);
  });
});

describe("M37 applyEditorTheme（DOM）", () => {
  it("写到 documentElement，清空残留的 bg/fg 覆盖", () => {
    const de = document.documentElement;
    de.style.setProperty("--axv-code-bg", "#111");
    de.style.setProperty("--axv-code-fg", "#eee");
    applyEditorTheme(DEFAULT_EDITOR_THEME); // 浅色 → 应移除 bg/fg
    expect(de.style.getPropertyValue("--axv-code-bg")).toBe("");
    expect(de.style.getPropertyValue("--axv-code-cursor")).toBe("#24292F");
    applyEditorTheme({ ...DEFAULT_EDITOR_THEME, hl: "dark" });
    expect(de.style.getPropertyValue("--axv-code-bg")).toBe("#0D1117");
    de.style.removeProperty("--axv-code-bg");
    de.style.removeProperty("--axv-code-cursor");
  });
});
