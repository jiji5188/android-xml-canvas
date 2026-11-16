// lib/xml/android-theme-presets.ts — M316：Android 系统内置主题预设库 + 写回 themes.xml
//
// 用途：用户挑一个「AppCompat / Material2 / Material3 / 系统」主题变体，
//   - 预览框用它的调色板画样张（按钮/卡片/开关/进度条/文字层级）
//   - 选中后把 <style name="Theme.MyApp" parent="..."> + 各 color item 写进 themes.xml
//
// 纯数据 + 纯函数，不碰 DOM，便于单测。

export type ThemeGroup = "appcompat" | "material2" | "material3" | "system";

export interface AndroidThemePalette {
  primary: string;
  onPrimary: string;
  secondary: string;
  surface: string;
  onSurface: string;
  onSurfaceVariant: string;
}

export interface AndroidThemePreset {
  id: string;
  group: ThemeGroup;
  /** 展示名（如 "Material 3 · 深色"） */
  name: string;
  /** 写进 themes.xml 的 parent 属性值 */
  parent: string;
  /** 一句话说明（用户看的就是这个） */
  note: string;
  /** 预览用调色板（浅） */
  light: AndroidThemePalette;
  /** 预览用调色板（深；没有就复用 light 的 onSurface 反转） */
  dark?: AndroidThemePalette;
}

export const THEME_GROUP_ORDER: ThemeGroup[] = [
  "appcompat",
  "material2",
  "material3",
  "system",
];

export const THEME_GROUP_LABEL: Record<ThemeGroup, string> = {
  appcompat: "AppCompat 全系列",
  material2: "Material 2 变体",
  material3: "Material 3 变体",
  system: "系统内置主题",
};

/** 取色工具 */
function pal(
  primary: string,
  onPrimary: string,
  secondary: string,
  surface: string,
  onSurface: string,
  onSurfaceVariant: string,
): AndroidThemePalette {
  return { primary, onPrimary, secondary, surface, onSurface, onSurfaceVariant };
}

export const ANDROID_THEME_PRESETS: AndroidThemePreset[] = [
  // ===== AppCompat（旧工程 / AIDE 真机观感，按钮方角）=====
  {
    id: "appcompat",
    group: "appcompat",
    name: "AppCompat（深色）",
    parent: "Theme.AppCompat",
    note: "最基础的深色主题，旧 App 默认观感：方角按钮、经典 Material 1 控件",
    light: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
    dark: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "appcompat-light",
    group: "appcompat",
    name: "AppCompat · Light",
    parent: "Theme.AppCompat.Light",
    note: "浅色经典主题，白底黑字 + 灰主色，适合信息密集界面",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
  },
  {
    id: "appcompat-dark",
    group: "appcompat",
    name: "AppCompat · Dark",
    parent: "Theme.AppCompat",
    note: "深色经典主题，深灰底浅字",
    light: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
    dark: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "appcompat-light-noactionbar",
    group: "appcompat",
    name: "AppCompat · Light.NoActionBar",
    parent: "Theme.AppCompat.Light.NoActionBar",
    note: "浅色、无系统 ActionBar，适合自绘 Toolbar / 全屏自定顶部",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
  },

  // ===== Material 2（MaterialComponents，圆角 4dp 按钮）=====
  {
    id: "material2",
    group: "material2",
    name: "Material 2（浅色）",
    parent: "Theme.MaterialComponents",
    note: "Material Design 2 标准浅色，紫主色 + 圆角 4dp 按钮 + 阴影",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material2-light",
    group: "material2",
    name: "Material 2 · Light",
    parent: "Theme.MaterialComponents.Light",
    note: "Material 2 浅色，白底 + 紫主色，最常用",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material2-dark",
    group: "material2",
    name: "Material 2 · Dark",
    parent: "Theme.MaterialComponents",
    note: "Material 2 深色，深灰底 + 浅紫主色",
    light: pal("#BB86C6", "#FF1B1B1F", "#FF03DAC6", "#FF121212", "#FFE0E0E0", "#FFBDBDBD"),
    dark: pal("#BB86C6", "#FF1B1B1F", "#FF03DAC6", "#FF121212", "#FFE0E0E0", "#FFBDBDBD"),
  },
  {
    id: "material2-noactionbar",
    group: "material2",
    name: "Material 2 · NoActionBar",
    parent: "Theme.MaterialComponents.NoActionBar",
    note: "Material 2 无 ActionBar，配合自绘 Toolbar 用",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },

  // ===== Material 3（胶囊按钮 / 圆角 20dp / 动态色）=====
  {
    id: "material3-light",
    group: "material3",
    name: "Material 3 · Light",
    parent: "Theme.Material3.Light",
    note: "Material 3 浅色，紫罗兰主色 + 胶囊按钮 + 24dp 圆角卡片",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material3-dark",
    group: "material3",
    name: "Material 3 · Dark",
    parent: "Theme.Material3.Dark",
    note: "Material 3 深色，深紫底 + 浅紫主色，OLED 友好",
    light: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
    dark: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
  },
  {
    id: "material3-daynight",
    group: "material3",
    name: "Material 3 · DayNight",
    parent: "Theme.Material3.DayNight",
    note: "Material 3 跟随系统深浅色，白天浅、夜里深，一套代码",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
    dark: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
  },
  {
    id: "material3-noactionbar",
    group: "material3",
    name: "Material 3 · NoActionBar",
    parent: "Theme.Material3.DynamicColors.Light.NoActionBar",
    note: "Material 3 无 ActionBar + 动态色（跟壁纸取色，Android 12+ 最佳）",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material3-fullscreen",
    group: "material3",
    name: "Material 3 · 全屏",
    parent: "Theme.Material3.Light.NoActionBar.Fullscreen",
    note: "Material 3 全屏沉浸式，状态栏/导航栏隐藏，适合游戏/媒体/专注场景",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
  },

  // ===== 系统内置 =====
  {
    id: "system-device-default",
    group: "system",
    name: "系统 · DeviceDefault",
    parent: "@android:style/Theme.DeviceDefault",
    note: "跟随厂商 ROM 默认外观（华为/小米/三星各家风格不同），兼容性最好",
    light: pal("#FF2196F3", "#FFFFFFFF", "#FF2196F3", "#FFFFFFFF", "#FF000000", "#FF757575"),
  },
  {
    id: "system-holo",
    group: "system",
    name: "系统 · Holo（经典）",
    parent: "@android:style/Theme.Holo",
    note: "Android 4 时代经典 Holo 深色蓝，怀旧风 / 低版本兼容",
    light: pal("#FF33B5E5", "#FF000000", "#FF33B5E5", "#FF000000", "#FFFFFFFF", "#FF8E8E93"),
    dark: pal("#FF33B5E5", "#FF000000", "#FF33B5E5", "#FF000000", "#FFFFFFFF", "#FF8E8E93"),
  },
  {
    id: "system-holo-light",
    group: "system",
    name: "系统 · Holo.Light",
    parent: "@android:style/Theme.Holo.Light",
    note: "Holo 浅色版，老式白底蓝主色",
    light: pal("#FF33B5E5", "#FFFFFFFF", "#FF33B5E5", "#FFFFFFFF", "#FF000000", "#FF757575"),
  },
  {
    id: "system-material",
    group: "system",
    name: "系统 · Material",
    parent: "@android:style/Theme.Material",
    note: "原生 Material（无 AndroidX），API 21+ 系统主题",
    light: pal("#FF2196F3", "#FFFFFFFF", "#FF2196F3", "#FFFFFFFF", "#FF000000", "#FF757575"),
    dark: pal("#FF80CBC4", "#FF000000", "#FF2196F3", "#FF212121", "#FFFFFFFF", "#FFB0BEC5"),
  },
];

/** 按分组折叠（UI 用） */
export function androidThemeGroups(): { group: ThemeGroup; label: string; items: AndroidThemePreset[] }[] {
  const out: { group: ThemeGroup; label: string; items: AndroidThemePreset[] }[] = [];
  for (const g of THEME_GROUP_ORDER) {
    out.push({ group: g, label: THEME_GROUP_LABEL[g], items: ANDROID_THEME_PRESETS.filter((p) => p.group === g) });
  }
  return out;
}

export function androidThemeById(id: string | undefined): AndroidThemePreset {
  return ANDROID_THEME_PRESETS.find((p) => p.id === id) ?? ANDROID_THEME_PRESETS[0];
}

/**
 * Android ARGB 颜色（#AARRGGBB / #RRGGBB）→ CSS 可用颜色。
 * 关键：调色板值是 Android 格式 #AARRGGBB，而浏览器把 8 位 hex 当 #RRGGBBAA 解析，
 * 直接拿去当 CSS 会把 #FF9E9E9E 渲染成半透明浅红。这里统一转换。
 */
export function argbToCss(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(/^#([0-9a-fA-F]{8})$/);
  if (m) {
    const a = parseInt(m[1].slice(0, 2), 16);
    const r = parseInt(m[1].slice(2, 4), 16);
    const g = parseInt(m[1].slice(4, 6), 16);
    const b = parseInt(m[1].slice(6, 8), 16);
    if (a === 255) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }
  return s; // #RGB / #RRGGBB / rgb() / 名称 原样返回
}

/* ===== 写回 themes.xml ===== */

/** 主题调色板 → 要写进 <style> 的 item 列表 */
export function themeToItems(preset: AndroidThemePreset): { item: string; value: string }[] {
  const p = preset.light;
  const items: { item: string; value: string }[] = [
    { item: "colorPrimary", value: p.primary },
    { item: "colorOnPrimary", value: p.onPrimary },
    { item: "colorSecondary", value: p.secondary },
    { item: "colorOnSurface", value: p.onSurface },
    { item: "colorOnSurfaceVariant", value: p.onSurfaceVariant },
    { item: "android:colorBackground", value: p.surface },
    { item: "android:windowBackground", value: p.surface },
  ];
  if (preset.id === "material3-fullscreen" || preset.parent.includes(".Fullscreen")) {
    items.push({ item: "android:windowFullscreen", value: "true" });
  }
  return items;
}

/**
 * 把主题写进 themes.xml（values 资源）。
 * - themes.xml 不存在 / 没有 <resources> 时生成骨架
 * - 已有同 styleName 的 <style> 则替换（保留其它 <style>）
 * - 没有则插到 </resources> 前
 */
export function writeThemeIntoValues(
  themesXml: string,
  preset: AndroidThemePreset,
  styleName = "Theme.MyApp",
): string {
  const items = themeToItems(preset);
  const styleBlock = [
    `    <style name="${styleName}" parent="${preset.parent}">`,
    ...items.map((i) => `        <item name="${i.item}">${i.value}</item>`),
    `    </style>`,
  ].join("\n");

  let out = themesXml;
  // 1) 没有 <resources> 骨架就补
  if (!/<resources[\s>]/.test(out)) {
    out = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${styleBlock}\n</resources>\n`;
    return out;
  }
  // 2) 有同名 <style> 就替换整块
  const styleRe = new RegExp(
    `<style\\s+[^>]*name\\s*=\\s*["']${escapeRegExp(styleName)}["'][^>]*>[\\s\\S]*?<\\/style>`,
    "g",
  );
  if (styleRe.test(out)) {
    out = out.replace(styleRe, styleBlock);
    return out;
  }
  // 3) 插到 </resources> 前；没有 </resources> 就追加
  const closeIdx = out.search(/<\/resources>/);
  if (closeIdx >= 0) {
    return out.slice(0, closeIdx) + styleBlock + "\n" + out.slice(closeIdx);
  }
  return out + "\n" + styleBlock + "\n</resources>\n";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
