"use client";

// lib/xml/color-picker-hsv.ts — 移植自 colorpicker.html 的 HSV/ARGB 取色逻辑（独立版）。
// 与现有 HsvPicker（纯 CSS 渐变版）不同：这里按你给的页面实现，用 canvas 画 HSV 面板，
// 并保留“弹窗式”交互：遮罩 + 居中弹窗 + 色相/透明度滑杆 + ARGB/RGBA 输入 + 预设 + 复制/确认。

export type PickerColor = {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-1 */
  v: number;
  /** 0-1 */
  a: number;
};

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s, v };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function argbToRgba(argb: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(argb.trim());
  if (!m) return null;
  return { a: parseInt(m[1], 16) / 255, r: parseInt(m[2], 16), g: parseInt(m[3], 16), b: parseInt(m[4], 16) };
}

export function rgbaToArgbHex(r: number, g: number, b: number, a: number): string {
  const pad = (n: number) => n.toString(16).padStart(2, "0");
  return `#${pad(Math.round(a * 255))}${pad(r)}${pad(g)}${pad(b)}`.toUpperCase();
}

export function rgbaText(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

export function colorToPickerColor(r: number, g: number, b: number, a: number): PickerColor {
  return { ...rgbToHsv(r, g, b), a };
}

export function parsePickerInputToColor(
  input: "argb" | "rgba",
  text: string,
  fallback: PickerColor,
): PickerColor | null {
  const t = text.trim();
  if (input === "argb") {
    const c = argbToRgba(t);
    if (!c) return null;
    return colorToPickerColor(c.r, c.g, c.b, c.a);
  }
  const m = t.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
  if (!m) return null;
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
  if (m[4]) return colorToPickerColor(r, g, b, Number(m[4]));
  return colorToPickerColor(r, g, b, fallback.a);
}

export function defaultPickerColor(): PickerColor {
  return { h: 200, s: 0.7, v: 0.85, a: 1 };
}
