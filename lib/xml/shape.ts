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

  // selector：挑第一个带 drawable/shape 的 item（预览取常态，不区分按压态）
  // ripple（M3h）：外壳只提供点按色，形状在内层 <item><shape>；取内层渲染
  let target = root;
  if (root.tag === "selector" || root.tag === "ripple") {
    const item = root.children.find((c) => c.tag === "item");
    if (!item) return null;
    const inline = item.children.find((c) => c.tag === "shape");
    if (inline) target = inline;
    else return null; // android:drawable="@drawable/other" 需要递归读文件，这里不支持
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
  return out;
}
