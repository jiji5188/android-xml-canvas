// lib/xml/resources.ts — 内置默认资源表 + 用户粘贴的 values 片段解析
// @string / @dimen / @color 的兜底值（M1 覆盖常见项，未定义走默认 + 提示）

import type { ResourceTable } from "./types";

export const DEFAULT_RESOURCES: ResourceTable = {
  strings: {
    app_name: "My App",
    title: "标题",
    subtitle: "副标题",
    button_ok: "确定",
    button_cancel: "取消",
    hint: "提示文本",
    placeholder: "请输入",
    confirm: "确认",
  },
  // dimen 一律存 dp 数值（resolve 时换算）
  dimens: {
    margin_small: 8,
    margin_medium: 16,
    margin_large: 24,
    spacing: 12,
    text_size_small: 12,
    text_size_medium: 14,
    text_size_large: 18,
    card_radius: 12,
    padding: 16,
    item_height: 56,
  },
  colors: {
    primary: "#6750A4",
    on_primary: "#FFFFFF",
    secondary: "#625B71",
    surface: "#FEF7FF",
    on_surface: "#1D1B20",
    on_surface_variant: "#49454F",
    background: "#FFFFFF",
    card_background: "#FFFFFF",
    divider: "#E0D9E3",
    white: "#FFFFFF",
    black: "#000000",
    error: "#B3261E",
    accent: "#6750A4",
    text_primary: "#1D1B20",
    text_secondary: "#49454F",
    page_bg: "#FEF7FF",
    card_bg: "#FFFFFF",
    border: "#E0D9E3",
    gray: "#808080",
    lightgray: "#E0E0E0",
    darkgray: "#424242",
    transparent: "transparent",
  },
};

/** 解析用户粘贴的 <resources>...</resources> 片段，合并进默认表（用户优先） */
/**
 * @android:color/xxx 框架内置色（常用子集，够预览用；未命中走 resolveColor 兜底）
 * 颜色取自 AOSP values/colors.xml（近似值即可，预览工具不做像素级还原）
 */
export const FRAMEWORK_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  background_light: "#FFFFFF",
  background_dark: "#303030",
  background_holo_light: "#F5F5F5",
  background_holo_dark: "#F3303030",
  primary_light: "#FFFFFF",
  primary_dark: "#212121",
  primary_light_dark: "#303030",
  primary_dark_light: "#EEEEEE",
  holo_blue_light: "#33B5E5",
  holo_blue_dark: "#0099CC",
  holo_red_light: "#FF4444",
  holo_green_light: "#669900",
  holo_orange_light: "#FF8800",
  highlight_blue_bright: "#FFFF4444",
  bright_foreground_light: "#000000",
  bright_foreground_dark: "#FFFFFF",
  bright_foreground_disabled_light: "#BEBEBE",
  bright_foreground_disabled_dark: "#80FFFFFF",
  dark_foreground_light: "#DEDEDE",
  dark_foreground_dark: "#434343",
  hint_foreground_light: "#80808080",
  hint_foreground_dark: "#80CCCCCC",
  primary_text_light: "#DE000000",
  primary_text_dark: "#DEFFFFFF",
  primary_text_disabled_light: "#42000000",
  primary_text_disabled_dark: "#42FFFFFF",
  secondary_text_light: "#8A000000",
  secondary_text_dark: "#8AFFFFFF",
  secondary_text_disabled_light: "#42000000",
  secondary_text_disabled_dark: "#42FFFFFF",
  activated_text_light: "#FF000000",
  activated_text_dark: "#FFFFFFFF",
  link_text_light: "#FF0000EE",
  link_text_dark: "#FF0099CC",
  gray: "#808080",
  grey: "#808080",
  darker_gray: "#444444",
  lighter_gray: "#CCCCCC",
  dkgray: "#444444",
  ltgray: "#CCCCCC",
  light_grey: "#EEEEEE",
  dark_grey: "#333333",
  tab_indicator_selected: "#FF0099CC",
  tab_indicator_unselected: "#40000000",
  button_normal: "#FFFFFF",
  button_pressed: "#33000000",
  suggestion_background: "#33000000",
};

/**
 * @android:style / ?android:attr 里常见 TextAppearance 的内置展开
 * 覆盖 Material 主题高频引用项；未命中静默忽略（不误报 warn，因为框架样式表太大）
 */
export const FRAMEWORK_STYLES: Record<string, { attrs: Record<string, string> }> = {
  "TextAppearance.AppCompat.Body1": {
    attrs: { "textSize": "14sp", "textColor": "?attr/textColorPrimary" },
  },
  "TextAppearance.AppCompat.Body2": {
    attrs: { "textSize": "14sp", "textColor": "?attr/textColorSecondary" },
  },
  "TextAppearance.AppCompat.Caption": {
    attrs: { "textSize": "12sp", "textColor": "?attr/textColorSecondary" },
  },
  "TextAppearance.AppCompat.Subhead": {
    attrs: { "textSize": "14sp", "textColor": "?attr/textColorPrimary" },
  },
  "TextAppearance.AppCompat.Title": {
    attrs: { "textSize": "16sp", "textColor": "?attr/textColorPrimary", "textStyle": "bold" },
  },
  "TextAppearance.Material.Body1": {
    attrs: { "textSize": "14sp", "textColor": "#DE000000" },
  },
  "TextAppearance.Material.Body2": {
    attrs: { "textSize": "14sp", "textColor": "#8A000000" },
  },
  "TextAppearance.Material.Caption": {
    attrs: { "textSize": "12sp", "textColor": "#8A000000" },
  },
  "TextAppearance.Material.Headline": {
    attrs: { "textSize": "20sp", "textColor": "#DE000000" },
  },
  "TextAppearance.Material.Title": {
    attrs: { "textSize": "16sp", "textColor": "#DE000000", "textStyle": "bold" },
  },
  "TextAppearance.Material.Widget.Button": {
    attrs: { "textSize": "14sp", "textAllCaps": "true", "textColor": "#FFFFFF" },
  },
  "Widget.Material.Button": {
    attrs: { "background": "#6750A4", "textColor": "#FFFFFF", "textSize": "14sp", "textAllCaps": "true" },
  },
  "Widget.Material.Button.Colored": {
    attrs: { "background": "#6750A4", "textColor": "#FFFFFF", "textSize": "14sp", "textAllCaps": "true" },
  },
  "Widget.AppCompat.Button": {
    attrs: { "textSize": "14sp", "textAllCaps": "true" },
  },
};

export function mergeResourceFragment(xmlFragment: string): ResourceTable {
  const merged: ResourceTable = {
    strings: { ...DEFAULT_RESOURCES.strings },
    dimens: { ...DEFAULT_RESOURCES.dimens },
    colors: { ...DEFAULT_RESOURCES.colors },
  };
  const trim = xmlFragment.trim();
  // 去掉 <resources> 包裹（若存在）
  const inner = trim.startsWith("<resources")
    ? trim.replace(/^<resources[^>]*>/, "").replace(/<\/resources>$/, "")
    : trim;

  const tagRe = /<(string|dimen|color)\s+name="([^"]+)"\s*(?:formatin="[^"]*")?>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(inner)) !== null) {
    const kind = m[1];
    const name = m[2];
    const val = m[3].trim();
    if (kind === "string") merged.strings[name] = val;
    else if (kind === "dimen") merged.dimens[name] = parseDimenToDp(val);
    else if (kind === "color") merged.colors[name] = val;
  }
  // 框架样式兜底：项目 styles 没有时补 @android:style/* 常见项（键去 android: 前缀存）
  if (!merged.styles) {
    merged.styles = {};
  }
  for (const [k, v] of Object.entries(FRAMEWORK_STYLES)) {
    if (!merged.styles[k]) merged.styles[k] = { name: k, attrs: v.attrs };
  }
  return merged;
}

/** "@dimen/margin_small" / "@16dp" / "16dp" → dp 数值 */
export function parseDimenToDp(raw: string): number {
  const s = raw.trim().replace(/^@/, "");
  const m = s.match(/^([\d.]+)\s*(px|dp|sp|pt|in|mm)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] || "dp";
  switch (unit) {
    case "px": return n * 0.5; // 近似：160dpi 下 px→dp
    case "pt": return n * 1.3333;
    case "in": return n * 160;
    case "mm": return n * 6.338;
    default: return n; // dp/sp
  }
}
