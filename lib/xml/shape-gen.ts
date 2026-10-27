// lib/xml/shape-gen.ts — 自定义形状（res/drawable/*.xml 的 <shape>/<ripple>）生成与反解析
// 与图标矢量同思路：UI 调参数 → 直接产出可编译的 Android XML，不引 CSS 私有写法。

import { parseLayoutXml } from "./parser";
import { androidAngleToCss } from "./shape";

export type ShapeKind = "rectangle" | "oval" | "line";
export type GradientType = "linear" | "radial" | "sweep";

export interface ShapeSpec {
  kind: ShapeKind;
  /** 纯色填充（#RRGGBB / #AARRGGBB）；与 gradient 二选一 */
  solid?: string;
  /** 渐变（高级里开） */
  gradient?: {
    type: GradientType;
    start: string;
    center?: string;
    end: string;
    /** 仅 linear 有意义；Android 0°=左→右，90°=下→上 */
    angle?: number;
  };
  /** 统一圆角（dp）；corners 存在时逐角生效 */
  radius?: number;
  /** 四角独立（dp），任一存在则优先 */
  corners?: { tl: number; tr: number; br: number; bl: number };
  /** 描边 */
  stroke?: { width: number; color: string; dashWidth?: number; dashGap?: number };
  /** 固定尺寸（dp，可选） */
  size?: { w?: number; h?: number };
  /** 点按水波纹（外层 <ripple>） */
  ripple?: { color: string };
}

const NS = "http://schemas.android.com/apk/res/android";

/** spec → Android drawable XML（缩进稳定、标签顺序固定，便于 diff） */
export function buildShapeXml(spec: ShapeSpec): string {
  const lines: string[] = [];
  const inner: string[] = [];

  if (spec.gradient) {
    const g = spec.gradient;
    const parts = [`android:type="${g.type}"`];
    if (g.type === "linear") parts.push(`android:angle="${Math.round(g.angle ?? 0)}"`);
    parts.push(`android:startColor="${g.start}"`);
    if (g.center) parts.push(`android:centerColor="${g.center}"`);
    parts.push(`android:endColor="${g.end}"`);
    inner.push(`    <gradient ${parts.join(" ")}/>`);
  } else if (spec.solid) {
    inner.push(`    <solid android:color="${spec.solid}"/>`);
  }

  if (spec.corners) {
    const c = spec.corners;
    const same = c.tl === c.tr && c.tr === c.br && c.br === c.bl;
    if (same) {
      inner.push(`    <corners android:radius="${dp(c.tl)}"/>`);
    } else {
      inner.push(
        `    <corners\n` +
          `        android:topLeftRadius="${dp(c.tl)}"\n` +
          `        android:topRightRadius="${dp(c.tr)}"\n` +
          `        android:bottomRightRadius="${dp(c.br)}"\n` +
          `        android:bottomLeftRadius="${dp(c.bl)}"/>`,
      );
    }
  } else if (spec.radius !== undefined && spec.radius > 0 && spec.kind === "rectangle") {
    inner.push(`    <corners android:radius="${dp(spec.radius)}"/>`);
  }

  if (spec.stroke && spec.stroke.width > 0) {
    const s = spec.stroke;
    const parts = [`android:width="${dp(s.width)}"`, `android:color="${s.color}"`];
    if (s.dashWidth && s.dashWidth > 0) {
      parts.push(`android:dashWidth="${dp(s.dashWidth)}"`);
      parts.push(`android:dashGap="${dp(s.dashGap ?? 2)}"`);
    }
    inner.push(`    <stroke ${parts.join(" ")}/>`);
  }

  if (spec.size && (spec.size.w || spec.size.h)) {
    const parts: string[] = [];
    if (spec.size.w) parts.push(`android:width="${dp(spec.size.w)}"`);
    if (spec.size.h) parts.push(`android:height="${dp(spec.size.h)}"`);
    inner.push(`    <size ${parts.join(" ")}/>`);
  }

  const body = inner.join("\n");
  if (spec.ripple) {
    lines.push(`<ripple xmlns:android="${NS}"`);
    lines.push(`    android:color="${spec.ripple.color}">`);
    lines.push(`    <item>`);
    lines.push(`        <shape android:shape="${spec.kind}">`);
    if (body) lines.push(body.replace(/^ {4}/gm, "            "));
    lines.push(`        </shape>`);
    lines.push(`    </item>`);
    lines.push(`</ripple>`);
  } else {
    lines.push(`<shape xmlns:android="${NS}" android:shape="${spec.kind}">`);
    if (body) lines.push(body);
    lines.push(`</shape>`);
  }
  return lines.join("\n") + "\n";
}

function dp(n: number): string {
  return `${Math.round(n * 100) / 100}dp`;
}

/** 解析已有 drawable XML → spec（支持裸 <shape> 和 <ripple><item><shape>；selector 取第一个 item） */
export function parseShapeSpec(xml: string): ShapeSpec | null {
  const { root } = parseLayoutXml(xml);
  if (!root) return null;

  let rippleColor: string | undefined;
  let target = root;

  if (root.tag === "ripple") {
    rippleColor = root.attrs["color"] || "#33FFFFFF";
    const item = root.children.find((c) => c.tag === "item");
    const inline = item?.children.find((c) => c.tag === "shape");
    if (!inline) return null;
    target = inline;
  } else if (root.tag === "selector") {
    const item = root.children.find((c) => c.tag === "item");
    const inline = item?.children.find((c) => c.tag === "shape");
    if (!inline) return null;
    target = inline;
  }

  if (target.tag !== "shape") return null;

  const kindRaw = (target.attrs["shape"] || "rectangle").toLowerCase();
  const kind: ShapeKind = kindRaw === "oval" || kindRaw === "line" ? (kindRaw as ShapeKind) : "rectangle";
  const spec: ShapeSpec = { kind };

  for (const child of target.children) {
    const a = child.attrs;
    if (child.tag === "solid") {
      if (a["color"]) spec.solid = a["color"];
    } else if (child.tag === "gradient") {
      const type = (a["type"] || "linear").toLowerCase() as GradientType;
      const start = a["startColor"];
      const end = a["endColor"];
      if (start && end) {
        spec.gradient = {
          type: type === "radial" || type === "sweep" ? type : "linear",
          start,
          center: a["centerColor"] || undefined,
          end,
          angle: a["angle"] !== undefined ? Number(a["angle"]) : 0,
        };
        delete spec.solid;
      }
    } else if (child.tag === "corners") {
      const all = num(a["radius"]);
      const tl = num(a["topLeftRadius"]);
      const tr = num(a["topRightRadius"]);
      const br = num(a["bottomRightRadius"]);
      const bl = num(a["bottomLeftRadius"]);
      if (all !== undefined) spec.radius = all;
      if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
        const base = all ?? 0;
        spec.corners = { tl: tl ?? base, tr: tr ?? base, br: br ?? base, bl: bl ?? base };
      }
    } else if (child.tag === "stroke") {
      const w = num(a["width"]);
      if (w !== undefined && w > 0) {
        spec.stroke = {
          width: w,
          color: a["color"] || "#000000",
          dashWidth: num(a["dashWidth"]),
          dashGap: num(a["dashGap"]),
        };
      }
    } else if (child.tag === "size") {
      const w = num(a["width"]);
      const h = num(a["height"]);
      if (w !== undefined || h !== undefined) spec.size = { w, h };
    }
  }

  if (rippleColor) spec.ripple = { color: rippleColor };
  return spec;
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(dp|dip|px|sp)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** 资源名：bg_rect_r16 / bg_oval / bg_line_dash …，与已有名字冲突时加 _2/_3 */
export function shapeResourceName(spec: ShapeSpec, existing: string[] = []): string {
  const kindPart = spec.kind === "rectangle" ? "rect" : spec.kind;
  const bits: string[] = [kindPart];
  const r = spec.corners ? Math.max(spec.corners.tl, spec.corners.tr, spec.corners.br, spec.corners.bl) : spec.radius;
  if (r && r > 0) bits.push(`r${Math.round(r)}`);
  if (spec.ripple) bits.push("ripple");
  const base = `bg_${bits.join("_")}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 26);
  let name = base;
  let i = 2;
  while (existing.includes(name)) name = `${base}_${i++}`;
  return name;
}

/** spec → 预览用 CSS（和画布 shape.ts 同一套语义，保证「预览 = 画布」） */
export function specToCss(
  spec: ShapeSpec,
  resolveColor: (raw: string) => string = (x) => x,
): {
  background?: string;
  borderRadius?: string;
  border?: string;
  aspectRatio?: string;
} {
  const css: { background?: string; borderRadius?: string; border?: string; aspectRatio?: string } = {};

  if (spec.gradient) {
    const g = spec.gradient;
    const stops = [g.start, g.center, g.end].filter(Boolean).map((c) => resolveColor(c as string));
    if (stops.length >= 2) {
      if (g.type === "radial") css.background = `radial-gradient(circle, ${stops.join(", ")})`;
      else if (g.type === "sweep") css.background = `conic-gradient(${stops.join(", ")})`;
      else css.background = `linear-gradient(${androidAngleToCss(g.angle ?? 0)}deg, ${stops.join(", ")})`;
    }
  } else if (spec.solid) {
    css.background = resolveColor(spec.solid);
  }

  if (spec.kind === "oval") {
    css.borderRadius = "50%";
  } else if (spec.corners) {
    const c = spec.corners;
    css.borderRadius = `${c.tl}px ${c.tr}px ${c.br}px ${c.bl}px`;
  } else if (spec.radius) {
    css.borderRadius = `${spec.radius}px`;
  }

  if (spec.stroke && spec.stroke.width > 0) {
    const s = spec.stroke;
    css.border = s.dashWidth && s.dashWidth > 0
      ? `${s.width}px dashed ${resolveColor(s.color)}`
      : `${s.width}px solid ${resolveColor(s.color)}`;
  }

  if (spec.kind === "line") {
    css.background = undefined;
    css.aspectRatio = "auto";
  }

  return css;
}
