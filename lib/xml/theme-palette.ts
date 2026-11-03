// lib/xml/theme-palette.ts — M92：从工程主题（styles.xml/themes.xml，含 values-night）算出预览调色板
// 目标：预览里的「按钮主色 / 页面底色 / 默认文字色」跟真机主题一致，而不是写死的灰。
// 纯函数，不碰 DOM，便于单测。

import type { ResourceTable, ThemePalette } from "./types";
import { resolveColor } from "./resolve";
import { androidColorToCss } from "./color-argb";

/** 没读到工程主题时的兜底（Material 默认观感） */
export const LIGHT_PALETTE: ThemePalette = {
  primary: "#757575",
  onPrimary: "#FFFFFF",
  surface: "#FFFFFF",
  onSurface: "#1D1B20",
  fromProject: false,
};

export const DARK_PALETTE: ThemePalette = {
  primary: "#D0BCFF",
  onPrimary: "#381E72",
  surface: "#141218",
  onSurface: "#E6E0E9",
  fromProject: false,
};

/** 主题属性名在 styles.xml 里可能带 android: 前缀，两种都认 */
function pick(attrs: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!attrs) return undefined;
  for (const k of keys) {
    if (attrs[k] !== undefined) return attrs[k];
    if (attrs["android:" + k] !== undefined) return attrs["android:" + k];
    if (attrs["app:" + k] !== undefined) return attrs["app:" + k];
  }
  return undefined;
}

/** 把主题里的原始值（#hex / @color/x / ?attr/x）解成 CSS 颜色；解不出返回 fallback */
function toCss(raw: string | undefined, res: ResourceTable, fallback: string): string {
  const v = (raw || "").trim();
  if (!v) return fallback;
  if (v.startsWith("#")) {
    try {
      return androidColorToCss(v);
    } catch {
      return fallback;
    }
  }
  try {
    const out = resolveColor(v, res, [], "", "theme");
    // resolveColor 失败时给 #888888，这时宁可回落到主题兜底色
    if (!out || out === "#888888" || out.startsWith("?attr/")) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

/**
 * 计算预览调色板。
 * - 浅色：优先 day 主题属性 → @color 同名资源 → LIGHT_PALETTE
 * - 深色：优先 values-night 主题属性 → night colors → DARK_PALETTE
 */
export function buildPalette(res: ResourceTable): ThemePalette {
  const night = !!res.nightMode;
  const base = night ? DARK_PALETTE : LIGHT_PALETTE;
  const attrs = night
    ? { ...(res.themeAttrs ?? {}), ...(res.themeAttrsNight ?? {}) }
    : res.themeAttrs;
  const colors = { ...(res.colors ?? {}), ...(night ? res.colorsNight ?? {} : {}) };
  // 只有真的读到工程主题（styles/themes 里有主题 item）才把调色板交给工程；
  // 否则保持工具原本的中性灰白观感，不用 DEFAULT_RESOURCES 的同名色去偷换。
  const hasTheme = !!attrs && Object.keys(attrs).length > 0;

  const read = (keys: string[], colorKeys: string[], fallback: string): string => {
    const raw = pick(attrs, keys);
    if (raw) return toCss(raw, res, fallback);
    if (hasTheme) {
      for (const ck of colorKeys) {
        const c = colors[ck];
        if (c) return toCss(c, res, fallback);
      }
    }
    return fallback;
  };

  return {
    primary: read(
      ["colorPrimary", "colorAccent", "colorSecondary"],
      ["colorPrimary", "colorAccent", "primary"],
      base.primary,
    ),
    onPrimary: read(
      ["colorOnPrimary", "textColorPrimaryInverse"],
      ["colorOnPrimary"],
      base.onPrimary,
    ),
    surface: read(
      ["windowBackground", "colorBackground", "colorSurface", "backgroundColor"],
      ["colorBackground", "colorSurface", "windowBackground"],
      base.surface,
    ),
    onSurface: read(
      ["colorOnSurface", "colorOnBackground", "textColorPrimary"],
      ["colorOnSurface", "textColorPrimary"],
      base.onSurface,
    ),
    fromProject: hasTheme,
  };
}
