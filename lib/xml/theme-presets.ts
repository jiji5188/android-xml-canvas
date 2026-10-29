// lib/xml/theme-presets.ts — 编辑器界面主题（配色方案预设）
//
// 一套主题 = 一组语义 token。预设只声明「主色相 + 饱和度倾向」，
// 其余 token 在这里按统一规则推导（亮/暗各一套），这样每套主题的
// 工具栏、主背景、面板、标题、描述、边框都能整体协调，不会出现只换了主色、
// 工具栏和背景还留在旧配色上的情况。
//
// 关于面板/设置面板只读这里的数据，不要再往组件里写死颜色。

export type ThemeMode = "light" | "dark";

/** 语义 token → CSS 变量名（顺序即设置面板的展示顺序） */
export const THEME_TOKEN_ORDER = [
  "appBg",
  "toolbarBg",
  "toolbarSoft",
  "panelBg",
  "panelHead",
  "panelBorder",
  "title",
  "desc",
  "primary",
  "onPrimary",
  "primarySoft",
  "railBg",
  "surfaceSunken",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_ORDER)[number];

export const THEME_TOKEN_LABEL: Record<ThemeTokenKey, string> = {
  appBg: "主体背景",
  toolbarBg: "工具栏",
  toolbarSoft: "工具条底色",
  panelBg: "面板背景",
  panelHead: "面板标题栏",
  panelBorder: "面板描边",
  title: "标题文字",
  desc: "描述文字",
  primary: "主色",
  onPrimary: "主色上的文字",
  primarySoft: "主色浅底",
  railBg: "侧边栏",
  surfaceSunken: "凹陷面",
};

export interface ThemePreset {
  id: string;
  name: string;
  /** 一句话风格说明 */
  note: string;
  /** 主色相 0~360 */
  hue: number;
  /** 主色饱和度的缩放（0.6 = 更灰；1.4 = 更艳） */
  sat?: number;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "lilac", name: "丁香紫", note: "默认，Material 3 的紫调", hue: 265 },
  { id: "ocean", name: "海蓝", note: "冷色、偏工程感", hue: 214, sat: 1.1 },
  { id: "pine", name: "松绿", note: "低饱和青绿，久看不累", hue: 162, sat: 0.95 },
  { id: "amber", name: "暖橙", note: "暖调，适合长时间改布局", hue: 26, sat: 1.15 },
  { id: "rose", name: "玫瑰", note: "偏粉红，界面更活泼", hue: 342, sat: 1.05 },
  { id: "graphite", name: "石墨", note: "近乎无彩，专注看画布", hue: 250, sat: 0.35 },
];

export const DEFAULT_PRESET_ID = "lilac";

export function presetById(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

/* ---------- 颜色推导 ---------- */

/** HSL → #rrggbb（s/l 用 0~100） */
export function hsl(h: number, s: number, l: number): string {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const v = L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** 一套主题的全部 token（含面板展示顺序之外的内部 token） */
export function themeTokens(presetId: string, mode: ThemeMode): Record<string, string> {
  const p = presetById(presetId);
  const k = p.sat ?? 1;
  const h = p.hue;
  const s = (v: number) => Math.max(0, Math.min(100, v * k));

  if (mode === "light") {
    return {
      appBg: hsl(h, s(24), 96.5),
      toolbarBg: hsl(h, s(26), 94.5),
      toolbarSoft: hsl(h, s(22), 90),
      panelBg: hsl(h, s(40), 98.2),
      panelHead: hsl(h, s(22), 96.2),
      panelBorder: hsl(h, s(16), 87),
      title: hsl(h, s(18), 13),
      desc: hsl(h, s(10), 45),
      primary: hsl(h, s(52), 41),
      onPrimary: "#ffffff",
      primarySoft: hsl(h, s(58), 94),
      railBg: hsl(h, s(24), 94.8),
      surfaceSunken: hsl(h, s(20), 93.5),
      outline: hsl(h, s(16), 87),
      outlineStrong: hsl(h, s(13), 75),
      onSurface: hsl(h, s(18), 13),
      onSurfaceVariant: hsl(h, s(10), 45),
      primarySoftBorder: hsl(h, s(46), 79),
      hover: "rgba(0, 0, 0, 0.045)",
      scrim: "rgba(20, 18, 32, 0.55)",
      danger: "#b3261e",
      ok: "#1f7a3d",
    };
  }
  return {
    appBg: hsl(h, s(18), 8),
    toolbarBg: hsl(h, s(18), 11),
    toolbarSoft: hsl(h, s(16), 17),
    panelBg: hsl(h, s(16), 12),
    panelHead: hsl(h, s(18), 9.5),
    panelBorder: hsl(h, s(14), 21),
    title: hsl(h, s(14), 93),
    desc: hsl(h, s(10), 63),
    primary: hsl(h, s(56), 76),
    onPrimary: hsl(h, s(60), 12),
    primarySoft: hsl(h, s(28), 21),
    railBg: hsl(h, s(18), 9.5),
    surfaceSunken: hsl(h, s(20), 6.5),
    outline: hsl(h, s(14), 21),
    outlineStrong: hsl(h, s(12), 30),
    onSurface: hsl(h, s(14), 93),
    onSurfaceVariant: hsl(h, s(10), 63),
    primarySoftBorder: hsl(h, s(30), 34),
    hover: "rgba(255, 255, 255, 0.06)",
    scrim: "rgba(0, 0, 0, 0.62)",
    danger: "#f2b8b5",
    ok: "#9fd9a8",
  };
}

/** token → CSS 自定义属性名 */
export function cssVarOf(token: string): string {
  const special: Record<string, string> = {
    panelBg: "--axv-surface",
    panelHead: "--axv-surface-head",
    panelBorder: "--axv-outline",
    title: "--axv-title",
    desc: "--axv-desc",
    toolbarBg: "--axv-toolbar-bg",
    toolbarSoft: "--axv-toolbar-soft",
    appBg: "--axv-app-bg",
    railBg: "--axv-rail-bg",
  };
  return special[token] ?? `--axv-${token.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`;
}

/** 取一套主题的 CSS 变量表（测试/服务端渲染也能用，不碰 DOM） */
export function themeCssVars(presetId: string, mode: ThemeMode): Record<string, string> {
  const tokens = themeTokens(presetId, mode);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) {
    if (k === "hover" || k === "scrim" || k === "danger" || k === "ok") {
      out[cssVarOf(k)] = v;
      continue;
    }
    out[cssVarOf(k)] = v;
  }
  return out;
}

/** 浏览器里应用主题：写到 <html> 的内联样式上（覆盖 :root 默认值） */
export function applyThemeToDom(presetId: string, mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-axv-theme", mode);
  root.setAttribute("data-axv-preset", presetById(presetId).id);
  const vars = themeCssVars(presetId, mode);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
