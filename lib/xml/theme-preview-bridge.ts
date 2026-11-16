// lib/xml/theme-preview-bridge.ts — M320：主题面板「预览」按钮 → 跳原生 ThemePreviewActivity
// 只有 APK 壳里有 window.AxvNative.openThemePreview；浏览器/桌面端没有 → 返回 false（调用方走 CSS 模拟或禁用）。

import { axvNativeIf } from "@/lib/xml/native-bridge";
import type { AndroidThemePreset } from "@/lib/xml/android-theme-presets";

interface ThemePreviewBridge {
  openThemePreview?: (presetId: string, parent: string, paletteJson: string) => void;
}

/** 取预设的展示调色板（深色预设用 dark，否则 light）转成 {primary,onPrimary,secondary,surface,onSurface} */
export function presetPaletteJson(p: AndroidThemePreset): string {
  const c = p.dark ?? p.light;
  return JSON.stringify({
    primary: c.primary,
    onPrimary: c.onPrimary,
    secondary: c.secondary,
    surface: c.surface,
    onSurface: c.onSurface,
  });
}

/** 尝试跳原生主题预览页。返回 true = 走原生（APK 端）；false = 没桥（浏览器端）。 */
export function openThemePreviewNative(p: AndroidThemePreset): boolean {
  const b = axvNativeIf<ThemePreviewBridge>((x) => typeof x.openThemePreview === "function");
  if (!b) return false;
  try {
    b.openThemePreview?.(p.id, p.parent, presetPaletteJson(p));
    return true;
  } catch {
    return false;
  }
}
