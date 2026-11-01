// lib/xml/hsv.ts — M63：HSV ↔ RGB 转换（给新的 HSV 取色器用）
//
// 为什么单独一个文件：取色器面板要用 HSV 建模（色相/饱和度/明度），
// 但项目里到处存的是 Rgba/ARGB；转换必须是纯函数、可单测、无浏览器依赖。

export interface Hsv {
  /** 0~360 */
  h: number;
  /** 0~1 */
  s: number;
  /** 0~1 */
  v: number;
}

/** HSV → RGB（0~255，四舍五入） */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const vv = clamp01(v);
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** RGB(0~255) → HSV */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = clamp01(r / 255);
  const gg = clamp01(g / 255);
  const bb = clamp01(b / 255);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 灰色（含黑/白）没有色相，取值时保留原来的 H，避免拖到灰区时色相跳回 0 */
export function rgbToHsvKeepHue(r: number, g: number, b: number, keepHue: number): Hsv {
  const hsv = rgbToHsv(r, g, b);
  return hsv.s === 0 ? { ...hsv, h: keepHue } : hsv;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 取色面板的纯 CSS 背景：底色 hsl(H,100%,50%) + 横白（S）+ 纵黑（V） */
export function hsvPanelBackground(h: number): string {
  const hue = Math.round(((h % 360) + 360) % 360);
  return (
    `linear-gradient(to top, #000, rgba(0,0,0,0)),` +
    `linear-gradient(to right, #fff, rgba(255,255,255,0)),` +
    `hsl(${hue} 100% 50%)`
  );
}
