// lib/xml/editor-theme.ts — M37：代码编辑器的可配置外观
//
// 用户要求：光标颜色、选中背景/文字颜色、语法高亮风格都能在设置面板里改。
// 实现方式：全部落到 CSS 变量（documentElement 上），编辑器 CSS 只读 var()。
//   --axv-code-cursor     光标
//   --axv-code-sel-bg     选区背景
//   --axv-code-sel-fg     选区文字
//   --axv-code-font-size  字号（行高固定 21px，改动会影响行号/错误色带对齐，不开放）
//   --axv-code-bg / -fg   代码区底色/正文色（跟随高亮方案）
//   --axv-x-tag / attr / str / comm / decl  语法着色
//
// 纯逻辑放这里，便于单测；DOM 应用集中在 applyEditorTheme()。

export const LS_KEY_EDITOR_THEME = "axv.editorTheme";

export interface EditorPalette {
  bg: string;
  fg: string;
  tag: string;
  attr: string;
  str: string;
  comm: string;
  decl: string;
}

export interface EditorTheme {
  /** 高亮方案 id（见 HL_PRESETS） */
  hl: string;
  /** 光标颜色 */
  cursor: string;
  /** 选区背景 */
  selBg: string;
  /** 选区文字颜色；transparent = 保留高亮层原色 */
  selFg: string;
  /** M37b：当前行背景色 */
  curBg: string;
  /** M37b：是否显示当前行高亮 */
  showCur: boolean;
  /** 字号 px（11-16） */
  fontSize: number;
  /** M40：缩进宽度（空格数，2-8） */
  indent: number;
}

export interface HlPreset {
  id: string;
  label: string;
  palette: EditorPalette;
}

export const HL_PRESETS: HlPreset[] = [
  {
    id: "light",
    label: "浅色（默认）",
    palette: {
      bg: "",
      fg: "",
      tag: "#0B5FA5",
      attr: "#953800",
      str: "#1A7F37",
      comm: "#6E7781",
      decl: "#8250DF",
    },
  },
  {
    id: "dark",
    label: "深色（GitHub Dark）",
    palette: {
      bg: "#0D1117",
      fg: "#C9D1D9",
      tag: "#79C0FF",
      attr: "#FFA657",
      str: "#A5D6FF",
      comm: "#8B949E",
      decl: "#D2A8FF",
    },
  },
  {
    id: "solarized",
    label: "Solarized Light",
    palette: {
      bg: "#FDF6E3",
      fg: "#586E75",
      tag: "#268BD2",
      attr: "#B58900",
      str: "#2AA198",
      comm: "#93A1A1",
      decl: "#6C71C4",
    },
  },
  {
    id: "mono",
    label: "单色（护眼）",
    palette: {
      bg: "",
      fg: "",
      tag: "#3A3A3A",
      attr: "#3A3A3A",
      str: "#3A3A3A",
      comm: "#8A8A8A",
      decl: "#5A5A5A",
    },
  },
  {
    id: "contrast",
    label: "高对比",
    palette: {
      bg: "#FFFFFF",
      fg: "#111111",
      tag: "#0033CC",
      attr: "#B30000",
      str: "#006600",
      comm: "#444444",
      decl: "#7A00CC",
    },
  },
];

export const DEFAULT_EDITOR_THEME: EditorTheme = {
  hl: "light",
  cursor: "#24292F",
  selBg: "rgba(4, 64, 159, 0.18)",
  selFg: "transparent",
  curBg: "rgba(11, 95, 165, 0.08)",
  showCur: true,
  fontSize: 13,
  indent: 4,
};

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 16;
export const INDENT_MIN = 2;
export const INDENT_MAX = 8;
export const INDENT_PRESETS = [2, 3, 4, 6, 8];

export function paletteOf(id: string): EditorPalette {
  return (HL_PRESETS.find((p) => p.id === id) || HL_PRESETS[0]).palette;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*(\d|\d\d|2[0-4]\d|25[0-5])\s*,\s*(\d|\d\d|2[0-4]\d|25[0-5])\s*,\s*(\d|\d\d|2[0-4]\d|25[0-5])\s*(?:,\s*(?:0|1|0\.\d+)?\s*)?\)$/i;

/** 颜色合法性：允许 #rgb/#rrggbb、rgb()/rgba()、transparent、空（=用默认） */
export function isColor(v: string): boolean {
  const s = v.trim();
  if (!s) return true;
  if (s.toLowerCase() === "transparent") return true;
  return HEX.test(s) || RGBA.test(s);
}

/** 宽松归一：非法值一律回默认，避免写进 CSS 变量把界面搞花 */
export function normalizeTheme(raw: unknown): EditorTheme {
  const o = (raw ?? {}) as Partial<EditorTheme>;
  const hl = HL_PRESETS.some((p) => p.id === o.hl) ? (o.hl as string) : DEFAULT_EDITOR_THEME.hl;
  const pick = (v: unknown, d: string) => (typeof v === "string" && isColor(v) ? v.trim() : d);
  let fontSize = Number(o.fontSize);
  if (!Number.isFinite(fontSize)) fontSize = DEFAULT_EDITOR_THEME.fontSize;
  fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)));
  let indent = Number(o.indent);
  if (!Number.isFinite(indent)) indent = DEFAULT_EDITOR_THEME.indent;
  indent = Math.min(INDENT_MAX, Math.max(INDENT_MIN, Math.round(indent)));
  return {
    hl,
    cursor: pick(o.cursor, DEFAULT_EDITOR_THEME.cursor),
    selBg: pick(o.selBg, DEFAULT_EDITOR_THEME.selBg),
    selFg: pick(o.selFg, DEFAULT_EDITOR_THEME.selFg),
    curBg: pick(o.curBg, DEFAULT_EDITOR_THEME.curBg),
    showCur: typeof o.showCur === "boolean" ? o.showCur : DEFAULT_EDITOR_THEME.showCur,
    fontSize,
    indent,
  };
}

export function parseTheme(json: string | null): EditorTheme {
  if (!json) return DEFAULT_EDITOR_THEME;
  try {
    return normalizeTheme(JSON.parse(json));
  } catch {
    return DEFAULT_EDITOR_THEME;
  }
}

/** 主题 → CSS 变量表（空串表示不覆盖，让主题色继续生效） */
export function themeVars(t: EditorTheme): Record<string, string> {
  const p = paletteOf(t.hl);
  const vars: Record<string, string> = {
    "--axv-code-cursor": t.cursor || DEFAULT_EDITOR_THEME.cursor,
    "--axv-code-sel-bg": t.selBg || DEFAULT_EDITOR_THEME.selBg,
    "--axv-code-sel-fg": t.selFg || "transparent",
    // M37b：关掉时写 transparent，CSS 不用再判开关
    "--axv-code-cur-bg": t.showCur ? t.curBg || DEFAULT_EDITOR_THEME.curBg : "transparent",
    "--axv-code-font-size": `${normalizeTheme(t).fontSize}px`,
    "--axv-x-tag": p.tag,
    "--axv-x-attr": p.attr,
    "--axv-x-str": p.str,
    "--axv-x-comm": p.comm,
    "--axv-x-decl": p.decl,
  };
  if (p.bg) vars["--axv-code-bg"] = p.bg;
  if (p.fg) vars["--axv-code-fg"] = p.fg;
  return vars;
}

/** 应用到 DOM（documentElement），空值变量会被移除回到默认 */
export function applyEditorTheme(t: EditorTheme, root?: HTMLElement | null): void {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  // 先把可能残留的覆盖清掉，再写新值（比如从深色切回浅色要撤销 bg/fg）
  for (const k of ["--axv-code-bg", "--axv-code-fg"]) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(themeVars(t))) el.style.setProperty(k, v);
}
