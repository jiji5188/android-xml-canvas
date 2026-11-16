// lib/xml/android-theme-presets.ts — M316：Android 系统内置主题预设库 + 写回 themes.xml
//
// 用途：用户挑一个「AppCompat / Material2 / Material3 / 系统」主题变体，
//   - 预览框用它的调色板画样张（按钮/卡片/开关/进度条/文字层级）
//   - 选中后把 <style name="Theme.MyApp" parent="..."> + 各 color item 写进 themes.xml
//
// 纯数据 + 纯函数，不碰 DOM，便于单测。

export type ThemeGroup = "appcompat" | "material2" | "material3" | "system" | "dialog";

/** 主题用途：activity = 整页主题（setTheme 到 Activity）；dialog = 对话框主题（只能挂在 Dialog 上，套到 Activity 会背景透明/窗口装饰异常） */
export type ThemeKind = "activity" | "dialog";

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
  /** M321：用途，缺省 = activity。dialog 组的主题只能用在对话框上 */
  kind?: ThemeKind;
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
  "dialog",
];

export const THEME_GROUP_LABEL: Record<ThemeGroup, string> = {
  appcompat: "AppCompat 全系列",
  material2: "Material 2 变体",
  material3: "Material 3 变体",
  system: "系统内置主题",
  dialog: "对话框主题（Dialog）",
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
    name: "AppCompat · 深色",
    parent: "Theme.AppCompat",
    note: "最基础的深色主题，旧 App 默认观感：方角按钮、经典 Material 1 控件",
    light: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
    dark: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "appcompat-light",
    group: "appcompat",
    name: "AppCompat · 浅色",
    parent: "Theme.AppCompat.Light",
    note: "浅色经典主题，白底黑字 + 灰主色，适合信息密集界面",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
  },
  {
    id: "appcompat-dark",
    group: "appcompat",
    name: "AppCompat · 深色",
    parent: "Theme.AppCompat",
    note: "深色经典主题，深灰底浅字",
    light: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
    dark: pal("#FF9E9E9E", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "appcompat-light-noactionbar",
    group: "appcompat",
    name: "AppCompat · 浅色无ActionBar",
    parent: "Theme.AppCompat.Light.NoActionBar",
    note: "浅色、无系统 ActionBar，适合自绘 Toolbar / 全屏自定顶部",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
  },

  // ===== Material 2（MaterialComponents，圆角 4dp 按钮）=====
  {
    id: "material2",
    group: "material2",
    name: "Material 2 · 浅色",
    parent: "Theme.MaterialComponents",
    note: "Material Design 2 标准浅色，紫主色 + 圆角 4dp 按钮 + 阴影",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material2-light",
    group: "material2",
    name: "Material 2 · 浅色",
    parent: "Theme.MaterialComponents.Light",
    note: "Material 2 浅色，白底 + 紫主色，最常用",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material2-dark",
    group: "material2",
    name: "Material 2 · 深色",
    parent: "Theme.MaterialComponents",
    note: "Material 2 深色，深灰底 + 浅紫主色",
    light: pal("#BB86C6", "#FF1B1B1F", "#FF03DAC6", "#FF121212", "#FFE0E0E0", "#FFBDBDBD"),
    dark: pal("#BB86C6", "#FF1B1B1F", "#FF03DAC6", "#FF121212", "#FFE0E0E0", "#FFBDBDBD"),
  },
  {
    id: "material2-noactionbar",
    group: "material2",
    name: "Material 2 · 无ActionBar",
    parent: "Theme.MaterialComponents.NoActionBar",
    note: "Material 2 无 ActionBar，配合自绘 Toolbar 用",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },

  // ===== Material 3（胶囊按钮 / 圆角 20dp / 动态色）=====
  {
    id: "material3-light",
    group: "material3",
    name: "Material 3 · 浅色",
    parent: "Theme.Material3.Light",
    note: "Material 3 浅色，紫罗兰主色 + 胶囊按钮 + 24dp 圆角卡片",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material3-dark",
    group: "material3",
    name: "Material 3 · 深色",
    parent: "Theme.Material3.Dark",
    note: "Material 3 深色，深紫底 + 浅紫主色，OLED 友好",
    light: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
    dark: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
  },
  {
    id: "material3-daynight",
    group: "material3",
    name: "Material 3 · 跟随系统",
    parent: "Theme.Material3.DayNight",
    note: "Material 3 跟随系统深浅色，白天浅、夜里深，一套代码",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
    dark: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF141218", "#FFE6E0E9", "#FFCAC4D0"),
  },
  {
    id: "material3-noactionbar",
    group: "material3",
    name: "Material 3 · 无ActionBar",
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
    name: "系统 · 厂商默认",
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
    name: "系统 · Holo 浅色",
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

  // ===== M321：对话框主题（Dialog）——只能挂在 Dialog 上，套到 Activity 会背景透明/窗口装饰异常 =====
  {
    id: "appcompat-dialog",
    group: "dialog",
    kind: "dialog",
    name: "AppCompat · 对话框",
    parent: "Theme.AppCompat.Dialog",
    note: "对话框专用（深色），弹窗圆角卡片，适合确认/输入弹窗",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
    dark: pal("#FFB0BEC5", "#FF000000", "#FF009688", "#FF303030", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "appcompat-light-dialog",
    group: "dialog",
    kind: "dialog",
    name: "AppCompat · 对话框（浅色）",
    parent: "Theme.AppCompat.Light.Dialog",
    note: "对话框专用（浅色），白底弹窗，最常见",
    light: pal("#FF757575", "#FFFFFFFF", "#FF009688", "#FFFFFFFF", "#FF212121", "#FF616161"),
  },
  {
    id: "material2-dialog",
    group: "dialog",
    kind: "dialog",
    name: "Material 2 · 对话框",
    parent: "Theme.MaterialComponents.Dialog",
    note: "对话框专用（Material2 深色），圆角 4dp 弹窗",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
    dark: pal("#FFBB86FC", "#FF000000", "#FF03DAC6", "#FF1E1E1E", "#FFE6E1E5", "#FFCAC4D0"),
  },
  {
    id: "material2-light-dialog",
    group: "dialog",
    kind: "dialog",
    name: "Material 2 · 对话框（浅色）",
    parent: "Theme.MaterialComponents.Light.Dialog",
    note: "对话框专用（Material2 浅色），白底紫主色弹窗",
    light: pal("#FF6200EE", "#FFFFFFFF", "#FF03DAC6", "#FFFFFFFF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "material3-dialog",
    group: "dialog",
    kind: "dialog",
    name: "Material 3 · 对话框",
    parent: "Theme.Material3.DayNight.Dialog",
    note: "对话框专用（M3 跟随系统），圆角 28dp 大圆角弹窗",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
    dark: pal("#FFD0BCFF", "#FF381E72", "#FFCCC2DC", "#FF1C1B1F", "#FFE6E1E5", "#FFCAC4D0"),
  },
  {
    id: "material3-light-dialog",
    group: "dialog",
    kind: "dialog",
    name: "Material 3 · 对话框（浅色）",
    parent: "Theme.Material3.Light.Dialog",
    note: "对话框专用（M3 浅色），白底大圆角弹窗",
    light: pal("#FF6750A4", "#FFFFFFFF", "#FF625B71", "#FFFDF7FF", "#FF1D1B20", "#FF49454F"),
  },
  {
    id: "system-material-dialog",
    group: "dialog",
    kind: "dialog",
    name: "系统 · Material 对话框",
    parent: "@android:style/Theme.Material.Dialog",
    note: "系统 Material 对话框主题（无 AndroidX），API 21+",
    light: pal("#FF2196F3", "#FFFFFFFF", "#FF2196F3", "#FFFFFFFF", "#FF000000", "#FF757575"),
    dark: pal("#FF80CBC4", "#FF000000", "#FF2196F3", "#FF212121", "#FFFFFFFF", "#FFB0BEC5"),
  },
  {
    id: "system-device-default-dialog",
    group: "dialog",
    kind: "dialog",
    name: "系统 · 厂商默认对话框",
    parent: "@android:style/Theme.DeviceDefault.Dialog",
    note: "跟随厂商 ROM 的对话框外观，兼容性最好",
    light: pal("#FF2196F3", "#FFFFFFFF", "#FF2196F3", "#FFFFFFFF", "#FF000000", "#FF757575"),
  },
];

export interface ThemePreviewFeatures {
  /** 预览时是否隐藏 ActionBar（无标题栏主题 / 对话框主题 / 全屏主题） */
  noActionBar: boolean;
  /** 预览时是否隐藏状态栏/导航栏（全屏主题） */
  fullscreen: boolean;
  /** 对话框弹窗的视觉风格（决定弹窗圆角/按钮形状/标题样式，不同主题不同布局） */
  dialogStyle: "holo" | "material2" | "material3" | "appcompat" | "system";
}

/**
 * M324：从 preset 推断预览特征——无ActionBar/全屏/对话框弹窗风格。
 * 纯函数，便于单测。规则：
 *  - noActionBar：parent 含 NoActionBar / 是 dialog 主题 / fullscreen / Material3 默认无 ActionBar
 *  - fullscreen：parent 含 Fullscreen
 *  - dialogStyle：按 parent 名归到 holo/material3/material2/appcompat/system 五档，决定弹窗长什么样
 */
export function inferPreviewFeatures(p: AndroidThemePreset): ThemePreviewFeatures {
  const par = p.parent || "";
  const isDialog = p.kind === "dialog";
  const hasNoActionBar = /NoActionBar/i.test(par) || isDialog || /Fullscreen/i.test(par);
  // Material3 全系默认不带 ActionBar
  const m3NoBar = /Material3/i.test(par);
  const noActionBar = hasNoActionBar || m3NoBar;
  const fullscreen = /Fullscreen/i.test(par) || p.id === "material3-fullscreen";

  let dialogStyle: ThemePreviewFeatures["dialogStyle"];
  if (/Holo/i.test(par)) dialogStyle = "holo";
  else if (/Material3/i.test(par)) dialogStyle = "material3";
  else if (/MaterialComponents/i.test(par)) dialogStyle = "material2";
  else if (/AppCompat/i.test(par)) dialogStyle = "appcompat";
  else if (/Material/i.test(par)) dialogStyle = "material2"; // 原生 Theme.Material 近似 M2
  else dialogStyle = "system"; // DeviceDefault 等
  return { noActionBar, fullscreen, dialogStyle };
}

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
  const isDialog = preset.kind === "dialog";
  const items: { item: string; value: string }[] = [
    { item: "colorPrimary", value: p.primary },
    { item: "colorOnPrimary", value: p.onPrimary },
    { item: "colorSecondary", value: p.secondary },
    { item: "colorOnSurface", value: p.onSurface },
    { item: "colorOnSurfaceVariant", value: p.onSurfaceVariant },
  ];
  // 对话框主题：背景由系统 Dialog 自带（dialog 窗口背景），硬写 windowBackground 会把弹窗画成满屏方块
  if (!isDialog) {
    items.push({ item: "android:colorBackground", value: p.surface });
    items.push({ item: "android:windowBackground", value: p.surface });
  }
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
  styleName?: string,
): string {
  // M321：对话框主题默认写 Theme.MyDialog（不覆盖 app 的 Theme.MyApp）
  const name = styleName ?? (preset.kind === "dialog" ? "Theme.MyDialog" : "Theme.MyApp");
  const items = themeToItems(preset);
  const styleBlock = [
    `    <style name="${name}" parent="${preset.parent}">`,
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
    `<style\\s+[^>]*name\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/style>`,
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

/**
 * M317：从 res 文件清单里找出「应用主题」的 style 名，交给原生预览 applyStyle。
 * 看 values/themes.xml / values/styles.xml，抓所有 <style name>，优先 Theme.MyApp（主题面板写的那个），
 * 否则优先 name 以 theme 开头的；都没有返回 undefined（PreviewActivity 用默认主题，不崩）。
 */
export function findAppThemeStyle(
  files: { path: string; text?: string }[],
): string | undefined {
  for (const f of files) {
    const isThemeFile =
      /^values\/(themes|styles)\.xml$/i.test(f.path) ||
      /^values\/[\w-]*\/(themes|styles)\.xml$/i.test(f.path);
    if (!isThemeFile) continue;
    const text = f.text || "";
    const names: string[] = [];
    const re = /<style\s+[^>]*name\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.push(m[1]);
    if (names.length === 0) continue;
    // M321：排除对话框主题 style（Theme.MyDialog / *Dialog*），它们不能当应用主题套到 Activity
    const appNames = names.filter((n) => !/dialog/i.test(n));
    if (appNames.length === 0) continue;
    if (appNames.includes("Theme.MyApp")) return "Theme.MyApp";
    const withTheme = appNames.find((n) => /(^|\.)theme/i.test(n));
    return withTheme || appNames[0];
  }
  return undefined;
}
