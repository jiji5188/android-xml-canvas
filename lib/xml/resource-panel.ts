// lib/xml/resource-panel.ts — M183 资源面板的纯逻辑层（可单测，不碰 DOM）
//
// 背景：旧的「资源值」面板把 res/values*/ 下所有文件拉平，同一资源名在
// values/、values-night/、values-zh-rCN/ 里各算一遍 → 八百多条看着像重复。
// 这里的规则：以资源名为主键、限定符为从属，先聚合再展示。
// 项目资源（mipmap/drawable）也归这里管，「草稿」（未写盘）由面板自己接 GenAssets 数据。

import { parseValues, type ValueItem } from "@/lib/xml/values-edit";

export type ResTab = "draft" | "icon" | "text" | "color" | "other";

/** 一条 values 资源（跨限定符聚合后的视图） */
export interface ValueGroup {
  /** 资源名（<string name="x"> 里的 x） */
  name: string;
  /** 类型：string | color | dimen | integer | bool */
  kind: string;
  /** 出现在哪些限定符目录（如 values / values-night / values-zh-rCN） */
  variants: Array<{
    /** 文件相对项目根路径 */
    rel: string;
    /** 限定符目录名（values-night → night） */
    qualifier: string;
    /** 每个文件里的值（同名可能有多行，按出现顺序） */
    items: Array<{ item: ValueItem; line: number }>;
  }>;
}

/** 扫出来的文件 → 按资源名聚合 */
export function groupValuesByResource(
  files: Array<{ rel: string; xml: string }>,
): ValueGroup[] {
  const map = new Map<string, ValueGroup>();
  for (const f of files) {
    const parentDir = f.rel.slice(0, f.rel.lastIndexOf("/")); // "…/res/values-night"
  const dirName = parentDir.includes("/") ? parentDir.slice(parentDir.lastIndexOf("/") + 1) : parentDir;
    const qualifier = valuesQualifier(dirName);
    let doc;
    try {
      doc = parseValues(f.xml);
    } catch {
      continue; // 解析不了的文件跳过，不让一个坏文件毁掉整张表
    }
    for (const item of doc.items) {
      if (!item.name) continue;
      const key = item.kind + "/" + item.name;
      let g = map.get(key);
      if (!g) {
        g = { name: item.name, kind: item.kind, variants: [] };
        map.set(key, g);
      }
      let v = g.variants.find((x) => x.rel === f.rel);
      if (!v) {
        v = { rel: f.rel, qualifier, items: [] };
        g.variants.push(v);
      }
      v.items.push({ item, line: item.line });
    }
  }
  const out = [...map.values()];
  // 按类型 + 名字排，稳定可预测
  out.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind),
  );
  return out;
}

/** values 目录名 → 限定符（values → 空=默认，values-night → night，values-zh-rCN → zh-rCN） */
export function valuesQualifier(dirName: string): string {
  const m = /^values(-(.*))?\/?$/.exec(dirName);
  return m ? m[2] || "" : "";
}

/**
 * M183c：取一个组的「主变体」——默认限定符（values/）优先，
 * 没有默认目录时才退回第一个变体。面板的行显示/就地改值/双击跳转都应走它，
 * 避免用户实际改的是 values-night 而以为是 values（或反过来）。
 */
export function primaryVariant(g: ValueGroup): ValueGroup["variants"][number] | undefined {
  return g.variants.find((v) => v.qualifier === "") ?? g.variants[0];
}

/** 文本 tab 只放 string 系（string/arrays 都算），颜色 tab 放 color，其他 tab 放其余 */
export function splitGroupsByTab(groups: ValueGroup[]): {
  text: ValueGroup[];
  color: ValueGroup[];
  other: ValueGroup[];
} {
  const text: ValueGroup[] = [];
  const color: ValueGroup[] = [];
  const other: ValueGroup[] = [];
  for (const g of groups) {
    if (g.kind === "string" || g.kind === "item") text.push(g);
    else if (g.kind === "color") color.push(g);
    else other.push(g);
  }
  return { text, color, other };
}

/**
 * 给资源选一个「默认编辑目标」：没有限定符的值优先（values/ 是主文件），
 * 其次按 qualifier 的「长度短 = 更通用」排。返回要打开的文件 rel + 行号。
 */
/** 项目图标/drawable 文件的 tab 归属：图片与 vector 归「图标」，xml 形状类归「其他」 */
export function iconFileTab(rel: string, name: string): "icon" | "other" {
  const p = (rel + "/" + name).toLowerCase();
  const parts = p.split("/").filter(Boolean);
  const base = name ? name.toLowerCase() : parts[parts.length - 1] || "";
  // 1) 图片扩展名 → 图标（不管在哪个目录）
  if (/\.(png|webp|jpe?g|gif|bmp)$/.test(base)) return "icon";
  // 2) 路径里任意一段是 mipmap*/drawable* → 图标（含里面的 xml）
  if (parts.some((seg) => /^(mipmap|drawable)/.test(seg))) return "icon";
  return "other";
}

/**
 * Android 颜色字面量 → CSS 颜色。支持 #RGB / #ARGB / #RRGGBB / #AARRGGBB。
 * 注意 Android 的 8 位是 AARRGGBB（透明度在前），CSS 是 RRGGBBAA（在后），必须换算。
 * 认不出返回 null。
 */
export function androidColorToCss(v: string): string | null {
  const s = v.trim();
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (!m) return null;
  let hex = m[1];
  const toRgba = (r: string, g: string, b: string, a?: string) => {
    const ri = parseInt(r, 16);
    const gi = parseInt(g, 16);
    const bi = parseInt(b, 16);
    const ai = a ? parseInt(a, 16) / 255 : 1;
    return ai >= 1
      ? `rgb(${ri}, ${gi}, ${bi})`
      : `rgba(${ri}, ${gi}, ${bi}, ${Math.round(ai * 1000) / 1000})`;
  };
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 4) {
    // #ARGB
    return toRgba(hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3], hex[0] + hex[0]);
  }
  if (hex.length === 6) return "#" + hex.toLowerCase();
  if (hex.length === 8) {
    // #AARRGGBB
    return toRgba(hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(0, 2));
  }
  return null;
}

/**
 * 值 → 真实 CSS 颜色：`@color/xxx` 顺着 map（颜色名 → 原值）解析，最多追 4 层；
 * 字面量直接换算。解析不了返回 null。
 */
export function resolveColorCss(
  value: string,
  map?: Map<string, string> | null,
  depth = 0,
): string | null {
  const v = (value || "").trim();
  // 系统色先查（@android:color/white），再走项目引用
  const sys = /^@android:color\/(\w+)$/.exec(v);
  if (sys) return CSS_NAMED(sys[1]);
  const ref = /^@(?:[\w.]+:)?color\/([\w.]+)$/.exec(v);
  if (ref) {
    if (!map || depth > 4) return null;
    const next = map.get(ref[1]);
    return next === undefined ? null : resolveColorCss(next, map, depth + 1);
  }
  if (/^[a-zA-Z]+$/.test(v)) return CSS_NAMED(v);
  return androidColorToCss(v);
}

const SYS_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  transparent: "rgba(0, 0, 0, 0)",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  darkgray: "#a9a9a9",
  lightgray: "#d3d3d3",
  holo_blue_dark: "#0099cc",
  holo_blue_light: "#33b5e5",
  holo_green_dark: "#669900",
  holo_green_light: "#99cc00",
  holo_red_dark: "#cc0000",
  holo_red_light: "#ff4444",
};

function CSS_NAMED(name: string): string | null {
  return SYS_COLORS[name.toLowerCase()] ?? (typeof CSS !== "undefined" && CSS.supports?.("color", name) ? name : null);
}

/** 一行值显示：颜色带色块，字符串截断 */
export function valuePreview(v: string): { text: string; color?: string } {
  const css = androidColorToCss(v);
  if (css) return { text: v, color: css };
  if (v.length > 24) return { text: v.slice(0, 24) + "…" };
  return { text: v };
}
