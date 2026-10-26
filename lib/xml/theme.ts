// lib/xml/theme.ts — 预览框「手机外壳」配色/尺寸小工具
// 状态栏与导航栏要跟随根布局背景色自动反色（深底白字 / 浅底黑字），
// 这是纯函数，抽出来方便单测，也避免组件里堆 CSS 解析代码。

export type Rgb = [number, number, number];

/** 把 #rgb / #rrggbb / rgb() / rgba() 解析成 [r,g,b]；不是纯色返回 null（如渐变） */
export function parseRgb(raw: string): Rgb | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [
      parseInt(f.slice(0, 2), 16),
      parseInt(f.slice(2, 4), 16),
      parseInt(f.slice(4, 6), 16),
    ];
  }
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const p = rgb[1]
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map((v) => parseFloat(v));
    if (p.length >= 3 && p.slice(0, 3).every((v) => !Number.isNaN(v))) {
      return [p[0], p[1], p[2]];
    }
  }
  return null;
}

/** 相对亮度 0~1（W3C 近似权重，够用来判断深浅） */
export function luminance([r, g, b]: Rgb): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export const PHONE_FG_DARK = "rgba(0,0,0,0.86)";
export const PHONE_FG_LIGHT = "rgba(255,255,255,0.94)";

/** 按背景色选前景色：浅底深字 / 深底浅字。无法解析（渐变等）时按浅底处理 */
export function readableOn(bgRaw: string): { bg: string; fg: string } {
  const raw = (bgRaw || "").trim();
  const rgb = parseRgb(raw);
  if (!rgb) return { bg: raw || "#FFFFFF", fg: PHONE_FG_DARK };
  return { bg: raw, fg: luminance(rgb) > 0.6 ? PHONE_FG_DARK : PHONE_FG_LIGHT };
}

/** 屏幕 dp 尺寸（Pixel 7 级别） */
export const SCREEN_DP = { w: 412, h: 892 } as const;
/** 系统状态栏高度（dp，Android 默认 24dp） */
export const STATUS_BAR_DP = 24;
/** 三键导航栏高度（dp） */
export const NAV_BAR_DP = 48;

/**
 * 应用内容区可用高度（dp）= 屏高 - 状态栏 - 导航栏。
 * 根布局 match_parent 时应当正好填满这个高度。
 */
export function phoneBodyDp(screenH: number = SCREEN_DP.h): number {
  return screenH - STATUS_BAR_DP - NAV_BAR_DP;
}
