import { describe, it, expect } from "vitest";
import {
  THEME_PRESETS,
  DEFAULT_PRESET_ID,
  THEME_TOKEN_ORDER,
  THEME_TOKEN_LABEL,
  themeTokens,
  themeCssVars,
  cssVarOf,
  presetById,
  hsl,
} from "../lib/xml/theme-presets";

const HEX = /^#[0-9a-f]{6}$/i;

function lum(hex: string): number {
  const c = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

describe("M16h 主题配色方案", () => {
  it("预设齐全且 id 唯一，默认是丁香紫", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_PRESET_ID);
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("每套主题亮/暗两档都填满所有 token，且都是合法 hex", () => {
    for (const p of THEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const t = themeTokens(p.id, mode);
        for (const key of THEME_TOKEN_ORDER) {
          expect(t[key], `${p.id}/${mode}/${key}`).toBeTruthy();
          expect(t[key], `${p.id}/${mode}/${key}`).toMatch(HEX);
        }
        // 工具栏、主背景、标题、描述、面板都必须真实存在且互不相同
        expect(t.toolbarBg).not.toBe(t.appBg);
        expect(t.panelBg).not.toBe(t.toolbarBg);
        expect(t.title).not.toBe(t.desc);
      }
    }
  });

  it("工具栏/背景/面板/标题/描述确实随预设变化（不是只换了主色）", () => {
    const a = themeTokens("lilac", "light");
    const b = themeTokens("ocean", "light");
    for (const key of ["appBg", "toolbarBg", "panelBg", "panelHead", "title", "desc", "railBg"] as const) {
      expect(a[key], key).not.toBe(b[key]);
    }
  });

  it("深色的标题比背景亮、浅色的标题比背景暗", () => {
    for (const p of THEME_PRESETS) {
      const light = themeTokens(p.id, "light");
      const dark = themeTokens(p.id, "dark");
      expect(lum(light.title)).toBeLessThan(lum(light.appBg));
      expect(lum(dark.title)).toBeGreaterThan(lum(dark.appBg));
      // 描述文字也要跟背景拉开层次
      expect(lum(dark.desc)).toBeGreaterThan(lum(dark.panelBg));
    }
  });

  it("token → CSS 变量名映射稳定（面板要用到旧变量名）", () => {
    expect(cssVarOf("panelBg")).toBe("--axv-surface");
    expect(cssVarOf("panelHead")).toBe("--axv-surface-head");
    expect(cssVarOf("panelBorder")).toBe("--axv-outline");
    expect(cssVarOf("toolbarBg")).toBe("--axv-toolbar-bg");
    expect(cssVarOf("appBg")).toBe("--axv-app-bg");
    expect(cssVarOf("primary")).toBe("--axv-primary");
    expect(cssVarOf("surfaceSunken")).toBe("--axv-surface-sunken");
    for (const key of THEME_TOKEN_ORDER) expect(THEME_TOKEN_LABEL[key]).toBeTruthy();
  });

  it("themeCssVars 不产生重复变量名", () => {
    const vars = themeCssVars("lilac", "dark");
    const names = Object.keys(vars);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("--axv-toolbar-bg");
    for (const v of Object.values(vars)) {
      expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\(.*\))$/i);
    }
  });

  it("未知预设 id 回落到第一个预设", () => {
    expect(presetById("nope").id).toBe(THEME_PRESETS[0].id);
  });

  it("hsl() 转换正确（0/120/240 三原色）", () => {
    expect(hsl(0, 100, 50)).toBe("#ff0000");
    expect(hsl(120, 100, 50)).toBe("#00ff00");
    expect(hsl(240, 100, 50)).toBe("#0000ff");
    expect(hsl(0, 0, 100)).toBe("#ffffff");
    expect(hsl(0, 0, 0)).toBe("#000000");
  });
});
