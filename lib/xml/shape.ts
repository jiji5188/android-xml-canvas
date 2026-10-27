// lib/xml/shape.ts — 把 res/drawable/*.xml 里的 <shape> 解析成可预览的样式
// 覆盖高频写法：shape=rectangle/oval/line、solid、gradient（linear/radial/sweep）、corners、stroke
// 不追求像素级还原（Android 的 <shape> 还有 inset/scale/padding 等，此处忽略）。

import { parseLayoutXml } from "./parser";

export interface ShapeCorners {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

export interface ShapeStyle {
  /** 纯色背景（#RRGGBB 之类，已解析） */
  solid?: string;
  /** 可直接用于 CSS background 的渐变函数 */
  gradient?: string;
  /** 统一圆角（dp）；oval 时为 undefined，改由 oval 标记 */
  radiusDp?: number;
  /** 四角独立圆角（dp），任一存在时优先于 radiusDp */
  cornersDp?: ShapeCorners;
  strokeDp?: number;
  strokeColor?: string;
  /** oval → CSS 50% 圆角 */
  oval?: boolean;
  /** line → 只画一条线（stroke 生效，背景透明） */
  line?: boolean;
  /** layer-list 阴影层（M3h-2）：底层偏移实心块 */
  shadow?: { dx: number; dy: number; blur: number; color: string };
}

/** Android 渐变角度 → CSS 角度：Android 0°=左→右，90°=下→上；CSS 0deg=下→上，90deg=左→右 */
export function androidAngleToCss(angle: number): number {
  const css = 90 - angle;
  return ((css % 360) + 360) % 360;
}

const shapeCache = new Map<string, ReturnType<typeof parseLayoutXml>>();

function parseCached(text: string) {
  const hit = shapeCache.get(text);
  if (hit !== undefined) return hit;
  const r = parseLayoutXml(text);
  shapeCache.set(text, r);
  return r;
}

/** dp 字面量："8dp" / "8" / "@dimen/x"(由调用方预处理) → 数值 */
function dp(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(dp|dip|px|sp)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] || "dp").toLowerCase();
  return unit === "px" ? n * 0.5 : n; // 近似 160dpi
}

/**
 * 解析 shape drawable 文本。
 * @param resolveColor 颜色解析器（把 @color/x / #AARRGGBB / 命名色 转成 CSS 颜色）
 * @returns 非 shape（如 selector/vector）返回 null
 */
export function parseShapeDrawable(
  xmlText: string,
  resolveColor: (raw: string) => string,
): ShapeStyle | null {
  const parsed = parseCached(xmlText);
  const root = parsed?.root;
  if (!root) return null;

  // selector（M3h-2）：取「常态」item（没有 state_* 的那个），拿不到才退第一个
  // ripple / inset：外壳只提供点按色 / 内缩，形状在内层
  // layer-list：Android 自下而上绘制，取最后一个（顶层）当可见形状
  let target = root;
  let shadow: ShapeStyle["shadow"];
  for (let guard = 0; guard < 6; guard++) {
    if (target.tag === "selector") {
      const items = target.children.filter((c) => c.tag === "item");
      if (items.length === 0) return null;
      const normal = items.find((it) => !Object.keys(it.attrs).some((k) => /^state_/.test(k))) ?? items[0];
      const inline = normal.children.find((c) => c.tag === "shape" || c.tag === "ripple" || c.tag === "layer-list" || c.tag === "inset");
      if (!inline) return null; // android:drawable="@drawable/other" 需要递归读文件，这里不支持
      target = inline;
      continue;
    }
    if (target.tag === "ripple" || target.tag === "inset") {
      const item = target.children.find((c) => c.tag === "item");
      const inner = item
        ? item.children.find((c) => c.tag !== "#text" && c.tag !== "#comment")
        : target.children.find((c) => c.tag !== "#text" && c.tag !== "#comment");
      if (!inner) return null;
      target = inner;
      continue;
    }
    if (target.tag === "layer-list") {
      const items = target.children.filter((c) => c.tag === "item");
      // 第一个 = 阴影层（约定：实心块 + 偏移），记录为 box-shadow 近似
      if (items.length >= 2) {
        const first = items[0];
        const fshape = first.children.find((c) => c.tag === "shape");
        const solid = fshape?.children.find((c) => c.tag === "solid")?.attrs["color"];
        if (solid) {
          const left = dp(first.attrs["left"]) ?? 0;
          const top = dp(first.attrs["top"]) ?? 0;
          shadow = { dx: left !== 0 ? -left : 0, dy: top, blur: 0, color: resolveColor(solid) };
        }
      }
      const last = items[items.length - 1];
      const inner = last?.children.find((c) => c.tag !== "#text" && c.tag !== "#comment");
      if (!inner) return null;
      target = inner;
      continue;
    }
    break;
  }
  if (target.tag !== "shape") return null;

  const shapeKind = (target.attrs["shape"] || "rectangle").toLowerCase();
  const out: ShapeStyle = {};
  if (shapeKind === "oval") out.oval = true;
  if (shapeKind === "line") out.line = true;

  for (const child of target.children) {
    const a = child.attrs;
    if (child.tag === "solid") {
      const c = a["color"];
      if (c) out.solid = resolveColor(c);
    } else if (child.tag === "gradient") {
      const type = (a["type"] || "linear").toLowerCase();
      const start = a["startColor"] ? resolveColor(a["startColor"]) : undefined;
      const center = a["centerColor"] ? resolveColor(a["centerColor"]) : undefined;
      const end = a["endColor"] ? resolveColor(a["endColor"]) : undefined;
      const stops = [start, center, end].filter((x): x is string => !!x);
      if (stops.length >= 2) {
        if (type === "radial") {
          out.gradient = `radial-gradient(circle, ${stops.join(", ")})`;
        } else if (type === "sweep") {
          out.gradient = `conic-gradient(${stops.join(", ")})`;
        } else {
          const angle = androidAngleToCss(parseFloat(a["angle"] ?? "0") || 0);
          out.gradient = `linear-gradient(${angle}deg, ${stops.join(", ")})`;
        }
      }
    } else if (child.tag === "corners") {
      const all = dp(a["radius"]);
      const tl = dp(a["topLeftRadius"]);
      const tr = dp(a["topRightRadius"]);
      const br = dp(a["bottomRightRadius"]);
      const bl = dp(a["bottomLeftRadius"]);
      if (all !== undefined) out.radiusDp = all;
      if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
        const base = all ?? 0;
        out.cornersDp = { tl: tl ?? base, tr: tr ?? base, br: br ?? base, bl: bl ?? base };
      }
    } else if (child.tag === "stroke") {
      const w = dp(a["width"]);
      const c = a["color"];
      if (w !== undefined && w > 0) {
        out.strokeDp = w;
        out.strokeColor = c ? resolveColor(c) : "#000000";
      }
    }
  }
  return shadow ? { ...out, shadow } : out;
}
