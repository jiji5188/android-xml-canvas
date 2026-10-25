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
