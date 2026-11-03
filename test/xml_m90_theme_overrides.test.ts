// M90：纯逻辑测试——配色方案覆盖表（themeOverrides）
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET_ID,
  LS_KEY_THEME_OVERRIDES,
  normalizeOverrides,
  THEME_PRESETS,
  THEME_TOKEN_ORDER,
  themeCssVars,
  themeTokens,
  type ThemeTokenOverrides,
} from "../lib/xml/theme-presets";

describe("M90 theme overrides", () => {
  it("无覆盖时 themeTokens 与原来一致", () => {
    for (const p of THEME_PRESETS) {
      for (const m of ["light", "dark"] as const) {
        expect(themeTokens(p.id, m)).toEqual(themeTokens(p.id, m, undefined));
        expect(themeTokens(p.id, m, {})).toEqual(themeTokens(p.id, m));
      }
    }
  });

  it("单项覆盖生效，且其他 token 不受影响", () => {
    const ov: ThemeTokenOverrides = { primary: "#123456" };
    const t = themeTokens(DEFAULT_PRESET_ID, "light", ov);
    expect(t.primary).toBe("#123456");
    const base = themeTokens(DEFAULT_PRESET_ID, "light");
    expect(t.title).toBe(base.title);
    expect(t.toolbarBg).toBe(base.toolbarBg);
  });

  it("themeCssVars 带上覆盖后的值", () => {
    const vars = themeCssVars(DEFAULT_PRESET_ID, "dark", { primary: "#112233" });
    expect(vars["--axv-primary"]).toBe("#112233");
  });

  it("非法 token 名 / 非法值 被丢弃，不污染结果", () => {
    const base = themeTokens(DEFAULT_PRESET_ID, "light");
    const t = themeTokens(DEFAULT_PRESET_ID, "light", {
      notAToken: "#ffffff", // 未知 token → 丢
      "background-image": "url(evil)", // 注入攻击 → 丢
      primary: "", // 空串 → 丢
      surface: "   ", // 空白 → 丢
      panelBg: "#abcdef", // 合法 → 保留
    });
    expect(t.primary).toBe(base.primary);
    expect(t.panelBg).toBe("#abcdef");
    expect(Object.keys(t)).toEqual(Object.keys(base));
  });

  it("normalizeOverrides 宽松解析：坏数据全丢，好数据保留", () => {
    const norm = normalizeOverrides({
      [THEME_PRESETS[0].id]: {
        light: { primary: "#ff0000", bad: 42, evil: { nested: true } },
        dark: { appBg: "#000001" },
      },
      "no-such-preset": { light: { primary: "#111111" } },
      null: "x",
    } as unknown);
    expect(norm[THEME_PRESETS[0].id].light?.primary).toBe("#ff0000");
    expect(norm[THEME_PRESETS[0].id].dark?.appBg).toBe("#000001");
    expect(norm["no-such-preset"]).toBeUndefined();
    expect(norm[THEME_PRESETS[0].id].light?.bad).toBeUndefined();
    expect(norm[THEME_PRESETS[0].id].light?.evil).toBeUndefined();
  });

  it("normalizeOverrides 全空/全坏 → 返回 {}（调用方可以放心删 key）", () => {
    expect(normalizeOverrides(null)).toEqual({});
    expect(normalizeOverrides("junk")).toEqual({});
    expect(normalizeOverrides({ a: { b: 1 } })).toEqual({});
  });

  it("覆盖值可以是 rgba() 字符串（用于 hover 类场景）", () => {
    const t = themeTokens(DEFAULT_PRESET_ID, "light", { scrim: "rgba(10, 20, 30, 0.4)" });
    expect(t.scrim).toBe("rgba(10, 20, 30, 0.4)");
  });

  it("LS_KEY 与持久化 key 对齐", () => {
    expect(LS_KEY_THEME_OVERRIDES).toBe("axv.themeOverrides");
  });

  it("THEME_TOKEN_ORDER 仍是 13 项（子页要逐项展示）", () => {
    expect(THEME_TOKEN_ORDER.length).toBe(13);
  });
});
