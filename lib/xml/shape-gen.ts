// lib/xml/shape-gen.ts — 自定义 drawable（<shape> / <ripple> / <selector> / <layer-list> / <inset>）生成与反解析
// 与图标矢量同思路：UI 调参数 → 直接产出可编译的 Android XML，不引 CSS 私有写法。
// 嵌套顺序（外→内）：ripple > selector > inset > layer-list > shape

import { parseLayoutXml } from "./parser";
import type { XmlNode } from "./types";
import { androidAngleToCss } from "./shape";
import { androidColorToCss } from "./color-argb";

export type ShapeKind = "rectangle" | "oval" | "ring" | "line";
export type GradientType = "linear" | "radial" | "sweep";

/** M119：layer-list 的单个图层项（item 属性） */
export interface ShapeLayerItem {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  alpha?: number;
  gravity?: string;
}

/** M119：一层 = 一个独立 shape + 它在 item 上的偏移 */
export interface ShapeLayer {
  spec: ShapeSpec;
  item?: ShapeLayerItem;
}

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
  /** M120：形状内部留白（<padding>，dp）——以前解析时会丢掉，导致“打开再保存”丢内容 */
  padding?: { l?: number; t?: number; r?: number; b?: number };
  /** 点按水波纹（最外层 <ripple>） */
  ripple?: { color: string };
  /** 按下 / 禁用态颜色（<selector>；常态 = 上面的 solid/gradient） */
  states?: { pressed?: string; disabled?: string };
  /** 阴影层（<layer-list>：底层偏移实心块，做出比 elevation 更自由的效果） */
  shadow?: { dx: number; dy: number; blur: number; color: string };
  /** 内缩（<inset>，dp） */
  inset?: { l?: number; t?: number; r?: number; b?: number };
  /** M117 ring 形状的镂空比例（0~1，越大洞越大；0.5=中间一半） */
  ringHole?: number;
  /**
   * M119：layer-list 图层（索引 0 = 最底，最后一项画在最上）。
   * 非空时输出 <layer-list>；每层是一个独立 shape。
   * 层内不再嵌 layers / states / ripple / shadow——Android 上多层嵌套自己写，不在这里套娃。
   */
  layers?: ShapeLayer[];
}

const NS = "http://schemas.android.com/apk/res/android";
const IND = "    ";

/** spec → Android drawable XML（缩进稳定、标签顺序固定，便于 diff） */
export function buildShapeXml(spec: ShapeSpec): string {
  // 1. 最内层：shape 本体
  let block = shapeBlock(spec, 0);
  /** 是否已被任意包装器包住（没有则根节点要带 xmlns） */
  let wrapped = false;

  // 2. ring：Android 原生 <shape android:shape="ring">，用 innerRadiusRatio / thicknessRatio 表达洞
  // 不包 layer-list——双 oval 叠透明层并不存在“打洞”，透明只是透出下层，结果仍是实心块
  // 2. layer-list：阴影层（若有）+ 自定义图层（若有）+ 内容层
  const layerItems: string[] = [];
  if (spec.shadow) {
    const s = spec.shadow;
    const off = offsetAttrs(s.dx, s.dy, s.blur);
    const shadowShape = shapeBlock(
      { ...spec, shadow: undefined, states: undefined, stroke: undefined, layers: undefined },
      0,
      { solid: s.color },
    );
    layerItems.push(`<item${off}>`, ...indentAll(shadowShape, 1), `</item>`);
  }
  if (spec.layers && spec.layers.length) {
    // 自定义图层：每层一个 item，按数组顺序从底到顶
    for (const L of spec.layers) {
      layerItems.push(`<item${itemAttrs(L.item)}>`, ...indentAll(shapeBlock(plainShape(L.spec), 0), 1), `</item>`);
    }
  } else if (spec.shadow) {
    // 只有阴影时，内容层跟在阴影后面
    layerItems.push(`<item>`, ...indentAll(block, 1), `</item>`);
  }
  if (layerItems.length) {
    block = [`<layer-list>`, ...indentAll(layerItems, 1), `</layer-list>`];
    wrapped = true;
  }

  // 3. inset
  if (spec.inset && hasInset(spec.inset)) {
    const i = spec.inset;
    // M5c 修正：Android 的 inset 属性是 insetLeft/Top/Right/Bottom（以前写成 insetL/T/R/B，aapt 不认）
    const INSET_ATTR: Record<"l" | "t" | "r" | "b", string> = {
      l: "Left",
      t: "Top",
      r: "Right",
      b: "Bottom",
    };
    const parts = (["l", "t", "r", "b"] as const)
      .filter((k) => i[k] !== undefined && i[k] !== 0)
      .map((k) => `android:inset${INSET_ATTR[k]}="${dp(i[k] as number)}"`);
    block = [`<inset${parts.length ? " " + parts.join(" ") : ""}>`, ...indentAll(block, 1), `</inset>`];
    wrapped = true;
  }

  // 2b. ring 不包 layer-list：原生 ring 直接一个 shape

  // 4. selector：按下 / 禁用 / 常态
  if (spec.states && (spec.states.pressed || spec.states.disabled)) {
    const items: string[] = [];
    if (spec.states.pressed) {
      items.push(
        `<item android:state_pressed="true">`,
        ...indentAll(shapeBlock({ ...spec, states: undefined, ripple: undefined }, 0, { solid: spec.states.pressed }), 1),
        `</item>`,
      );
    }
    if (spec.states.disabled) {
      items.push(
        `<item android:state_enabled="false">`,
        ...indentAll(shapeBlock({ ...spec, states: undefined, ripple: undefined }, 0, { solid: spec.states.disabled }), 1),
        `</item>`,
      );
    }
    items.push(`<item>`, ...indentAll(block, 1), `</item>`);
    block = [`<selector>`, ...indentAll(items, 1), `</selector>`];
    wrapped = true;
  }

  // 6. ripple 最外层
  if (spec.ripple) {
    block = [
      `<ripple`,
      `    android:color="${spec.ripple.color}">`,
      `    <item>`,
      ...indentAll(block, 2),
      `    </item>`,
      `</ripple>`,
    ];
    wrapped = true;
  }

  // 根节点统一补 xmlns（内层不要，避免重复声明）
  block[0] = block[0].replace(/^<([a-zA-Z-]+)/, (_m, tag: string) => `<${tag} xmlns:android="${NS}"`);
  void wrapped;

  return block.join("\n") + "\n";
}
/** M120：给 drawable 树内嵌用——返回 <shape> 片段（不带 xmlns，build 时由外层统一声明） */
export function shapeElementLines(spec: ShapeSpec): string[] {
  return shapeBlock(spec, 0);
}

/** M120：把 <shape> 节点解析成 ShapeSpec（供 drawable-node 复用，避免两套解析漂移） */
export function parseShapeElement(node: XmlNode): ShapeSpec {
  return parseShapeNode(node);
}

function shapeBlock(
  spec: ShapeSpec,
  _level: number,
  override?: { solid?: string },
): string[] {
  const inner: string[] = [];

  const useGradient = spec.gradient && !override?.solid;
  if (useGradient && spec.gradient) {
    const g = spec.gradient;
    const parts = [`android:type="${g.type}"`];
    if (g.type === "linear") parts.push(`android:angle="${Math.round(g.angle ?? 0)}"`);
    parts.push(`android:startColor="${g.start}"`);
    if (g.center) parts.push(`android:centerColor="${g.center}"`);
    parts.push(`android:endColor="${g.end}"`);
    inner.push(`${IND}<gradient ${parts.join(" ")}/>`);
  } else if (override?.solid || spec.solid) {
    inner.push(`${IND}<solid android:color="${override?.solid ?? spec.solid}"/>`);
  }

  if (spec.corners) {
    const c = spec.corners;
    const same = c.tl === c.tr && c.tr === c.br && c.br === c.bl;
    if (same) inner.push(`${IND}<corners android:radius="${dp(c.tl)}"/>`);
    else
      inner.push(
        `${IND}<corners` +
          `\n${IND}${IND}android:topLeftRadius="${dp(c.tl)}"` +
          `\n${IND}${IND}android:topRightRadius="${dp(c.tr)}"` +
          `\n${IND}${IND}android:bottomRightRadius="${dp(c.br)}"` +
          `\n${IND}${IND}android:bottomLeftRadius="${dp(c.bl)}"/>`,
      );
  } else if (spec.radius !== undefined && spec.radius > 0 && spec.kind === "rectangle") {
    inner.push(`${IND}<corners android:radius="${dp(spec.radius)}"/>`);
  }

  if (spec.stroke && spec.stroke.width > 0) {
    const s = spec.stroke;
    const parts = [`android:width="${dp(s.width)}"`, `android:color="${s.color}"`];
    if (s.dashWidth && s.dashWidth > 0) {
      parts.push(`android:dashWidth="${dp(s.dashWidth)}"`, `android:dashGap="${dp(s.dashGap ?? 2)}"`);
    }
    inner.push(`${IND}<stroke ${parts.join(" ")}/>`);
  }

  if (spec.size && (spec.size.w || spec.size.h)) {
    const parts: string[] = [];
    if (spec.size.w) parts.push(`android:width="${dp(spec.size.w)}"`);
    if (spec.size.h) parts.push(`android:height="${dp(spec.size.h)}"`);
    inner.push(`${IND}<size ${parts.join(" ")}/>`);
  }

  // M120：<padding>（四边全等时写 android:left…，而不是不存在的简写）
  if (spec.padding) {
    const p = spec.padding;
    const vals = [p.l, p.t, p.r, p.b];
    if (vals.some((v) => v !== undefined && v !== 0)) {
      const parts: string[] = [];
      if (p.l) parts.push(`android:left="${dp(p.l)}"`);
      if (p.t) parts.push(`android:top="${dp(p.t)}"`);
      if (p.r) parts.push(`android:right="${dp(p.r)}"`);
      if (p.b) parts.push(`android:bottom="${dp(p.b)}"`);
      inner.push(`${IND}<padding ${parts.join(" ")}/>` );
    }
  }

  // M117：ring 不用 oval 顶替，原生写法就是 shape="ring"
  const shapeName = spec.kind;
  const rootAttrs = [`android:shape="${shapeName}"`];
  if (spec.kind === "ring") {
    // 洞占比 h（内径/外径）→ innerRadiusRatio = 2/h，thicknessRatio = 2/(1-h)
    const h = Math.max(0.05, Math.min(0.95, spec.ringHole ?? 0.4));
    rootAttrs.push(`android:innerRadiusRatio="${round2(2 / h)}"`);
    rootAttrs.push(`android:thicknessRatio="${round2(2 / (1 - h))}"`);
    rootAttrs.push(`android:useLevel="false"`);
  }
  return [`<shape ${rootAttrs.join(" ")}>`, ...inner, `</shape>`];
}

/** layer-list 的 item 偏移：dx>0 往右（left=-dx），dy>0 往下（top=dy） */
function offsetAttrs(dx: number, dy: number, blur: number): string {
  const parts: string[] = [];
  if (dx) parts.push(dx > 0 ? `android:left="-${dpNum(dx)}"` : `android:right="${dpNum(-dx)}"`);
  if (dy) parts.push(dy > 0 ? `android:top="${dpNum(dy)}"` : `android:bottom="${dpNum(-dy)}"`);
  // blur 用四边外扩近似（Android 没有真模糊）
  if (blur > 0) {
    parts.push(`android:right="-${dpNum(blur)}"`, `android:bottom="-${dpNum(blur)}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function dpNum(n: number): string {
  return `${Math.round(n * 100) / 100}dp`;
}

/** M119：<item> 上的偏移/尺寸/透明度属性 */
function itemAttrs(it: ShapeLayerItem | undefined): string {
  if (!it) return "";
  const parts: string[] = [];
  const dims: [keyof ShapeLayerItem, string][] = [
    ["left", "left"],
    ["top", "top"],
    ["right", "right"],
    ["bottom", "bottom"],
    ["width", "width"],
    ["height", "height"],
  ];
  for (const [k, name] of dims) {
    const v = it[k];
    if (typeof v === "number" && v !== 0) parts.push(`android:${name}="${dp(v)}"`);
  }
  if (it.gravity) parts.push(`android:gravity="${it.gravity}"`);
  if (typeof it.alpha === "number" && it.alpha !== 1) {
    parts.push(`android:alpha="${Math.round(it.alpha * 100) / 100}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/** M119：图层里只允许“纯 shape”，拿掉所有包装器字段，避免套娃 */
function plainShape(spec: ShapeSpec): ShapeSpec {
  const {
    kind,
    solid,
    gradient,
    radius,
    corners,
    stroke,
    size,
    ringHole,
  } = spec;
  return { kind, solid, gradient, radius, corners, stroke, size, ringHole };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function dp(n: number): string {
  return dpNum(n);
}

function indentAll(lines: string[], levels: number): string[] {
  const pad = IND.repeat(levels);
  return lines.map((l) => (l.trim() === "" ? l : pad + l));
}

function hasInset(i: NonNullable<ShapeSpec["inset"]>): boolean {
  return (["l", "t", "r", "b"] as const).some((k) => i[k] !== undefined && i[k] !== 0);
}

/** 解析已有 drawable XML → spec（递归拆 ripple / selector / inset / layer-list） */
export function parseShapeSpec(xml: string): ShapeSpec | null {
  const { root } = parseLayoutXml(xml);
  if (!root) return null;
  return parseWrap(root);
}

function parseWrap(node: XmlNode): ShapeSpec | null {
  if (node.tag === "ripple") {
    const color = node.attrs["color"] || "#33FFFFFF";
    const item = firstItem(node);
    const inner = item ? firstElementChild(item) : null;
    if (!inner) return null;
    const s = parseWrap(inner);
    return s ? { ...s, ripple: { color } } : null;
  }

  if (node.tag === "selector") {
    const items = node.children.filter((c) => c.tag === "item");
    let pressed: string | undefined;
    let disabled: string | undefined;
    let normal: ShapeSpec | null = null;
    for (const it of items) {
      const child = firstElementChild(it);
      if (!child) continue; // android:drawable="@drawable/x" 引外部，不跟
      const spec = parseWrap(child);
      if (!spec) continue;
      const isPressed = it.attrs["state_pressed"] === "true";
      const isDisabled = it.attrs["state_enabled"] === "false";
      const isDefault = !isPressed && !isDisabled &&
        !Object.keys(it.attrs).some((k) => /^state_/.test(k));
      if (isPressed) pressed = spec.solid;
      else if (isDisabled) disabled = spec.solid;
      else if (isDefault && !normal) normal = spec;
    }
    if (!normal) return null;
    if (pressed || disabled) {
      normal.states = {};
      if (pressed) normal.states.pressed = pressed;
      if (disabled) normal.states.disabled = disabled;
    }
    return normal;
  }

  if (node.tag === "inset") {
    const prev = parseWrap(firstElementChild(node) ?? node);
    if (!prev) return null;
    const inset: NonNullable<ShapeSpec["inset"]> = {};
    // M5c：标准名是 insetLeft/Top/Right/Bottom；旧版本生成过 insetL/T/R/B，两种都读
    const LEGACY: Record<"l" | "t" | "r" | "b", [string, string]> = {
      l: ["insetLeft", "insetL"],
      t: ["insetTop", "insetT"],
      r: ["insetRight", "insetR"],
      b: ["insetBottom", "insetB"],
    };
    for (const k of ["l", "t", "r", "b"] as const) {
      const [std, old] = LEGACY[k];
      const v = num(node.attrs[std]) ?? num(node.attrs[old]);
      if (v !== undefined && v !== 0) inset[k] = v;
    }
    if (!hasInset(inset)) return prev;
    return { ...prev, inset };
  }

  if (node.tag === "layer-list") {
    const items = node.children.filter((c) => c.tag === "item");
    if (items.length === 0) return null;
    const parsed = items.map((it) => {
      const child = firstElementChild(it);
      return { spec: child ? parseWrap(child) : null, item: readItemAttrs(it.attrs) };
    });
    const valid = parsed.filter((p): p is { spec: ShapeSpec; item: ShapeLayerItem | undefined } => !!p.spec);
    if (valid.length === 0) return null;

    // 兼容旧“阴影”写法：恰好两层、第一层带左上偏移、两层同 kind → 视为阴影层 + 内容层
    const [a, b] = parsed;
    if (
      parsed.length === 2 &&
      a.spec &&
      b.spec &&
      a.item &&
      (a.item.left !== undefined || a.item.top !== undefined) &&
      a.item.right === undefined &&
      a.item.bottom === undefined &&
      a.spec.kind === b.spec.kind
    ) {
      const left = a.item.left ?? 0;
      const top = a.item.top ?? 0;
      return {
        ...b.spec,
        shadow: { dx: left !== 0 ? -left : 0, dy: top, blur: 0, color: a.spec.solid ?? "#00000000" },
      };
    }

    // M119：真正的图层——每层保留自己的 item 偏移
    const top = valid[valid.length - 1].spec;
    return {
      kind: top.kind,
      solid: top.solid,
      gradient: top.gradient,
      radius: top.radius,
      corners: top.corners,
      layers: valid.map((p) => ({ spec: p.spec, item: p.item })),
    };
  }

  if (node.tag !== "shape") return null;
  return parseShapeNode(node);
}

function firstItem(node: XmlNode): XmlNode | null {
  return node.children.find((c) => c.tag === "item") ?? null;
}

function firstElementChild(node: XmlNode): XmlNode | null {
  const kids = node.children.filter((c) => c.tag !== "#text" && c.tag !== "#comment");
  return kids[0] ?? null;
}

function parseShapeNode(node: XmlNode): ShapeSpec {
  const kindRaw = node.attrs["shape"]; // M117: ring 是 Android 原生 kind，不再被默认成 rectangle
  const kind: ShapeKind =
    kindRaw === "oval" || kindRaw === "line" || kindRaw === "ring"
      ? (kindRaw as ShapeKind)
      : "rectangle";
  const spec: ShapeSpec = { kind };

  if (kind === "ring") {
    // h = innerRadius / (innerRadius + thickness) = tr / (irr + tr)
    const irr = num(node.attrs["innerRadiusRatio"]);
    const tr = num(node.attrs["thicknessRatio"]);
    spec.ringHole = irr && tr && irr + tr > 0 ? Math.max(0, Math.min(1, tr / (irr + tr))) : 0.4;
  }

  for (const child of node.children) {
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
    } else if (child.tag === "padding") {
      const l = num(a["left"]);
      const t = num(a["top"]);
      const r = num(a["right"]);
      const b = num(a["bottom"]);
      if ([l, t, r, b].some((v) => v !== undefined)) {
        spec.padding = { l, t, r, b };
      }
    } else if (child.tag === "size") {
      const w = num(a["width"]);
      const h = num(a["height"]);
      if (w !== undefined || h !== undefined) spec.size = { w, h };
    }
  }
  return spec;
}

/** M119：读 <item> 上的偏移/尺寸/透明度 */
function readItemAttrs(attrs: Record<string, string>): ShapeLayerItem | undefined {
  const out: ShapeLayerItem = {};
  for (const k of ["left", "top", "right", "bottom", "width", "height"] as const) {
    const v = num(attrs[k]);
    if (v !== undefined && v !== 0) out[k] = v;
  }
  const alpha = attrs["alpha"];
  if (alpha !== undefined) {
    const a = Number(alpha);
    if (Number.isFinite(a) && a >= 0 && a <= 1 && a !== 1) out.alpha = a;
  }
  if (attrs["gravity"]) out.gravity = attrs["gravity"];
  return Object.keys(out).length ? out : undefined;
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(dp|dip|px|sp)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** 资源名：bg_rect_r16 / bg_oval / bg_rect_r8_ripple …，与已有名字冲突时加 _2/_3 */
export function shapeResourceName(spec: ShapeSpec, existing: string[] = []): string {
  const kindPart = spec.kind === "rectangle" ? "rect" : spec.kind;
  const bits: string[] = [kindPart];
  if (spec.kind === "ring") {
    const hole = Math.round((spec.ringHole ?? 0.4) * 100);
    bits.push(`h${hole}`);
  }
  const r = spec.kind === "ring" ? undefined : spec.corners ? Math.max(spec.corners.tl, spec.corners.tr, spec.corners.br, spec.corners.bl) : spec.radius;
  if (r && r > 0) bits.push(`r${Math.round(r)}`);
  if (spec.shadow) bits.push("shadow");
  if (spec.ripple) bits.push("ripple");
  const base = `bg_${bits.join("_")}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 26);
  let name = base;
  let i = 2;
  while (existing.includes(name)) name = `${base}_${i++}`;
  return name;
}

/**
 * 单个颜色值 Android → CSS（M53，具体实现在 color-argb，这里 re-export 方便形状/矢量侧使用）
 */
export { androidColorToCss as argbToCssColor } from "./color-argb";

/** 把 spec 里的所有颜色字段过一遍 ARGB→CSS，供预览渲染用 */
export function argbColorsForPreview(spec: ShapeSpec): ShapeSpec {
  const opt = (c?: string) => (c === undefined ? undefined : androidColorToCss(c));
  const g = spec.gradient
    ? {
        ...spec.gradient,
        start: androidColorToCss(spec.gradient.start),
        center: opt(spec.gradient.center),
        end: androidColorToCss(spec.gradient.end),
      }
    : undefined;
  const stroke = spec.stroke ? { ...spec.stroke, color: androidColorToCss(spec.stroke.color) } : undefined;
  const ripple = spec.ripple ? { ...spec.ripple, color: androidColorToCss(spec.ripple.color) } : undefined;
  const states = spec.states
    ? { ...spec.states, pressed: opt(spec.states.pressed), disabled: opt(spec.states.disabled) }
    : undefined;
  const shadow = spec.shadow ? { ...spec.shadow, color: androidColorToCss(spec.shadow.color) } : undefined;
  return { ...spec, solid: opt(spec.solid), gradient: g, stroke, ripple, states, shadow };
}

/** spec → 预览用 CSS（和画布 shape.ts 同一套语义，保证「预览 = 画布」） */
export function specToCss(
  spec: ShapeSpec,
  resolveColor: (raw: string) => string = (x) => x,
): {
  background?: string;
  borderRadius?: string;
  border?: string;
  boxShadow?: string;
  aspectRatio?: string;
  /** M5c：<inset> 内缩——预览用 clip-path 把背景裁到内缩区（不参与画布节点样式） */
  clipPath?: string;
} {
  const css: {
    background?: string;
    borderRadius?: string;
    border?: string;
    boxShadow?: string;
    aspectRatio?: string;
    clipPath?: string;
  } = {};

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

  if (spec.kind === "ring") {
    // M117：ring 预览 = 外圆 + 内圆镂空（透明洞）
    // CSS 没有真镂空，用 background: radial-gradient 模拟
    const h = Math.max(0, Math.min(1, spec.ringHole ?? 0.4));
    // radial-gradient 的百分比相对的是渐变半径，所以洞占比 h 直接对应 h*100%
    const holePct = Math.round(h * 1000) / 10;
    // 洞内透明，洞外实色
    const color = spec.solid ? resolveColor(spec.solid) : "#00000000";
    const transparent = "#00000000";
    // 关键：circle 的半径取 farthest-corner，宽扁盒子上洞会溢出上下边（只剩两个月牙）。
    // 改成 ellipse farthest-side（100% = 盒宽/高的一半），洞就是同心椭圆，任意宽高比都正常。
    css.background = `radial-gradient(ellipse farthest-side at 50% 50%, ${transparent} ${holePct}%, ${transparent} ${holePct + 0.4}%, ${color} ${holePct + 0.4}%, ${color} 100%)`;
    css.borderRadius = "50%";
    // ring 没有 corners
  } else if (spec.kind === "oval") {
    css.borderRadius = "50%";
  } else if (spec.corners) {
    const c = spec.corners;
    css.borderRadius = `${c.tl}px ${c.tr}px ${c.br}px ${c.bl}px`;
  } else if (spec.radius) {
    css.borderRadius = `${spec.radius}px`;
  }

  if (spec.stroke && spec.stroke.width > 0) {
    const s = spec.stroke;
    css.border =
      s.dashWidth && s.dashWidth > 0
        ? `${s.width}px dashed ${resolveColor(s.color)}`
        : `${s.width}px solid ${resolveColor(s.color)}`;
  }

  if (spec.shadow) {
    const s = spec.shadow;
    const inset = s.blur > 0 ? `${s.blur}px` : "0";
    css.boxShadow = `${s.dx}px ${s.dy}px ${inset} 0 ${resolveColor(s.color)}`;
  }

  // M5c：inset 内缩（预览）：把整个绘制区域向内裁掉 l/t/r/b，圆角跟着走
  if (spec.inset) {
    const i = spec.inset;
    const l = i.l ?? 0;
    const t = i.t ?? 0;
    const r = i.r ?? 0;
    const b = i.b ?? 0;
    if (l || t || r || b) {
      const round = css.borderRadius ? ` round ${css.borderRadius}` : "";
      css.clipPath = `inset(${t}px ${r}px ${b}px ${l}px${round})`;
    }
  }

  if (spec.kind === "line") {
    css.background = undefined;
    css.aspectRatio = "auto";
  }

  return css;
}
