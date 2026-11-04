// lib/xml/drawable-node.ts — drawable 图层树（M118）
//
// 为什么要有这个模块：
//   以前 shape-gen.ts 把 drawable 当成「一个 shape + 几个布尔开关(ripple/states/shadow/inset)」，
//   隐含了固定的嵌套顺序，也表达不了真实工程里的写法。实际 Android 里：
//     <layer-list>  = z 轴叠加，N 层全部绘制，index 0 在最底
//     <selector>    = 状态互斥，只有 1 层被绘制（第一个全部 state_* 匹配的 item）
//     <ripple>      = 1 层 content + 可选 mask + 波纹动效
//     <inset>       = 1 层 content + 四边内缩
//     <shape>/<color>/<vector>/<bitmap> = 叶子
//   且任意节点都可能是 @drawable/xxx 引用。
//   本模块负责：XML ⇄ 树、以及「按当前视图状态展开成有序渲染层」。
//   预览（画布/编辑器/缩略图）都只消费 flattenDrawable()，避免多套实现漂移。

import { parseLayoutXml } from "./parser";
import type { XmlNode } from "./types";
import type { ShapeSpec } from "./shape-gen";

/** 视图状态（对应 selector 的 android:state_*） */
export interface ViewState {
  pressed?: boolean;
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean;
  activated?: boolean;
  hovered?: boolean;
  [k: string]: boolean | undefined;
}

export type DrawableNode =
  | ShapeLeaf
  | ColorLeaf
  | RefLeaf
  | LayerNode
  | SelectorNode
  | RippleNode
  | InsetNode
  | UnsupportedNode;

/** <shape> 叶子 */
export interface ShapeLeaf {
  t: "shape";
  spec: ShapeSpec;
}

/** <color> 叶子（纯色 drawable） */
export interface ColorLeaf {
  t: "color";
  /** 原始色值，如 #FF112233 / @color/x */
  color: string;
}

/** android:drawable="@drawable/x" 或 <item android:drawable="@drawable/x"/> */
export interface RefLeaf {
  t: "ref";
  name: string;
}

/** layer-list 的一层 */
export interface LayerItem {
  /** 稳定 key（按层级路径生成，供 React 列表用） */
  key: string;
  /** android:left / top / right / bottom（dp，可为负） */
  offset?: { l?: number; t?: number; r?: number; b?: number };
  /** android:width / height（dp） */
  size?: { w?: number; h?: number };
  gravity?: string;
  /** android:alpha（0~1） */
  alpha?: number;
  node: DrawableNode;
}

export interface LayerNode {
  t: "layer";
  items: LayerItem[];
}

/** selector 的一个状态项 */
export interface StateItem {
  key: string;
  /** 原始 state_* 属性（值保持字符串 "true"/"false"） */
  states: Record<string, string>;
  node: DrawableNode;
}

export interface SelectorNode {
  t: "selector";
  items: StateItem[];
}

export interface RippleNode {
  t: "ripple";
  /** 波纹色（android:color） */
  color?: string;
  /** android:radius */
  radius?: string;
  /** 常态内容（无 id 的 item） */
  content?: DrawableNode;
  /** android:id="@android:id/mask" 的 item */
  mask?: DrawableNode;
}

export interface InsetNode {
  t: "inset";
  left: number;
  top: number;
  right: number;
  bottom: number;
  node: DrawableNode;
}

/** 暂不支持的标签（animated-vector / level-list / clip / scale …），保留占位不崩 */
export interface UnsupportedNode {
  t: "unsupported";
  tag: string;
}

const ELEMENT = (n: XmlNode) => n.tag !== "#text" && n.tag !== "#comment";

function kids(node: XmlNode): XmlNode[] {
  return node.children.filter(ELEMENT);
}

function dp(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(dp|dip|px|sp)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return (m[2] || "dp").toLowerCase() === "px" ? n * 0.5 : n;
}

/** "@drawable/bg_card" → "bg_card"；非引用返回 null */
export function refName(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^@(?:drawable|mipmap|color)\/([A-Za-z0-9_.]+)$/);
  return m ? m[1] : null;
}

/** 解析 drawable XML → 图层树；根不是 drawable 返回 null */
export function parseDrawable(xml: string): DrawableNode | null {
  const { root } = parseLayoutXml(xml);
  if (!root) return null;
  const node = parseNode(root, "0");
  // <color>#ff0000</color> 的色值在文本节点里，parser 不保留文本 → 从原文兜底
  if (node.t === "color" && node.color === "#00000000") {
    const m = xml.match(/<color\b[^>]*>\s*(@?[#A-Za-z0-9_/.:]+)\s*<\/color>/i);
    if (m) node.color = m[1];
  }
  return node;
}

function parseNode(node: XmlNode, path: string): DrawableNode {
  switch (node.tag) {
    case "shape":
      return { t: "shape", spec: parseShapeLeaf(node) };
    case "color":
      // <color android:color="#f00"/> 或 <color>#f00</color>（文本节点解析器不保留，下面是兜底）
      return { t: "color", color: node.attrs["color"] ?? "#00000000" };
    case "layer-list":
      return { t: "layer", items: parseLayerItems(node, path) };
    case "selector":
      return { t: "selector", items: parseStateItems(node, path) };
    case "ripple":
      return parseRipple(node, path);
    case "inset":
      return parseInset(node, path);
    default:
      return { t: "unsupported", tag: node.tag };
  }
}

function parseLayerItems(node: XmlNode, path: string): LayerItem[] {
  const out: LayerItem[] = [];
  const items = kids(node).filter((c) => c.tag === "item");
  items.forEach((it, i) => {
    const key = `${path}.${i}`;
    const inner = it.attrs["drawable"] ? null : kids(it).find(ELEMENT);
    const child: DrawableNode = inner
      ? parseNode(inner, key)
      : it.attrs["drawable"]
        ? toRefOrColor(it.attrs["drawable"])
        : { t: "unsupported", tag: "item" };
    const offset = {
      l: dp(it.attrs["left"]),
      t: dp(it.attrs["top"]),
      r: dp(it.attrs["right"]),
      b: dp(it.attrs["bottom"]),
    };
    const size = { w: dp(it.attrs["width"]), h: dp(it.attrs["height"]) };
    const alphaRaw = it.attrs["alpha"];
    const hasOffset = Object.values(offset).some((v) => v !== undefined && v !== 0);
    const hasSize = size.w !== undefined || size.h !== undefined;
    out.push({
      key,
      ...(hasOffset ? { offset } : {}),
      ...(hasSize ? { size } : {}),
      ...(it.attrs["gravity"] ? { gravity: it.attrs["gravity"] } : {}),
      ...(alphaRaw ? { alpha: clamp01(parseFloat(alphaRaw)) } : {}),
      node: child,
    });
  });
  return out;
}

function parseStateItems(node: XmlNode, path: string): StateItem[] {
  const out: StateItem[] = [];
  kids(node)
    .filter((c) => c.tag === "item")
    .forEach((it, i) => {
      const key = `${path}.${i}`;
      const states: Record<string, string> = {};
      for (const [k, v] of Object.entries(it.attrs)) {
        if (/^state_/.test(k)) states[k] = v;
      }
      const inner = kids(it).find(ELEMENT);
      const child: DrawableNode = inner
        ? parseNode(inner, key)
        : it.attrs["drawable"]
          ? toRefOrColor(it.attrs["drawable"])
          : { t: "unsupported", tag: "item" };
      out.push({ key, states, node: child });
    });
  return out;
}

function parseRipple(node: XmlNode, path: string): DrawableNode {
  let content: DrawableNode | undefined;
  let mask: DrawableNode | undefined;
  kids(node)
    .filter((c) => c.tag === "item")
    .forEach((it, i) => {
      const key = `${path}.${i}`;
      const inner = kids(it).find(ELEMENT);
      const child: DrawableNode = inner
        ? parseNode(inner, key)
        : it.attrs["drawable"]
          ? toRefOrColor(it.attrs["drawable"])
          : { t: "unsupported", tag: "item" };
      if (it.attrs["id"] === "@android:id/mask") mask = child;
      else content = child;
    });
  return {
    t: "ripple",
    color: node.attrs["color"],
    radius: node.attrs["radius"],
    content,
    mask,
  };
}

function parseInset(node: XmlNode, path: string): DrawableNode {
  const inner = kids(node).find(ELEMENT);
  return {
    t: "inset",
    left: dp(node.attrs["insetLeft"] ?? node.attrs["insetL"]) ?? 0,
    top: dp(node.attrs["insetTop"] ?? node.attrs["insetT"]) ?? 0,
    right: dp(node.attrs["insetRight"] ?? node.attrs["insetR"]) ?? 0,
    bottom: dp(node.attrs["insetBottom"] ?? node.attrs["insetB"]) ?? 0,
    node: inner ? parseNode(inner, `${path}.0`) : { t: "unsupported", tag: "inset" },
  };
}

function toRefOrColor(raw: string): DrawableNode {
  const name = refName(raw);
  if (name) return { t: "ref", name };
  return { t: "color", color: raw };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** shape 叶子：复用 shape-gen 的解析口径（含 ring / 渐变 / 描边 / size） */
function parseShapeLeaf(node: XmlNode): ShapeSpec {
  // parseShapeSpec 接受整份 XML，这里把节点重新序列化太浪费；直接走内部逻辑太耦合，
  // 因此用一个小的形状转换（与 parseShapeNode 保持一致的最小集）。
  const kindRaw = node.attrs["shape"];
  const kind: ShapeSpec["kind"] =
    kindRaw === "oval" || kindRaw === "line" || kindRaw === "ring"
      ? (kindRaw as ShapeSpec["kind"])
      : "rectangle";
  const spec: ShapeSpec = { kind };

  if (kind === "ring") {
    const irr = numOf(node.attrs["innerRadiusRatio"]);
    const tr = numOf(node.attrs["thicknessRatio"]);
    spec.ringHole = irr && tr && irr + tr > 0 ? Math.max(0, Math.min(1, tr / (irr + tr))) : 0.4;
  }
  if (node.attrs["useLevel"] !== undefined) {
    // 仅记录存在，不改形状
  }

  for (const child of kids(node)) {
    const a = child.attrs;
    switch (child.tag) {
      case "solid":
        if (a["color"]) spec.solid = a["color"];
        break;
      case "gradient": {
        const typeRaw = a["type"] || "linear";
        const type: "linear" | "radial" | "sweep" =
          typeRaw === "radial" || typeRaw === "sweep" ? typeRaw : "linear";
        const start = a["startColor"] || a["centerColor"] || a["endColor"] || "#00000000";
        spec.gradient = {
          type,
          start,
          ...(a["centerColor"] ? { center: a["centerColor"] } : {}),
          end: a["endColor"] || start,
          ...(a["angle"] !== undefined ? { angle: numOf(a["angle"]) } : {}),
        };
        break;
      }
      case "corners": {
        spec.radius = numOf(a["radius"]) ?? 0;
        const tl = numOf(a["topLeftRadius"]);
        const tr = numOf(a["topRightRadius"]);
        const br = numOf(a["bottomRightRadius"]);
        const bl = numOf(a["bottomLeftRadius"]);
        if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
          spec.corners = { tl: tl ?? spec.radius, tr: tr ?? spec.radius, br: br ?? spec.radius, bl: bl ?? spec.radius };
        }
        break;
      }
      case "stroke": {
        const w = numOf(a["width"]) ?? 0;
        if (w > 0) {
          spec.stroke = {
            width: w,
            color: a["color"] || "#00000000",
            ...(a["dashWidth"] ? { dashWidth: numOf(a["dashWidth"]) } : {}),
            ...(a["dashGap"] ? { dashGap: numOf(a["dashGap"]) } : {}),
          };
        }
        break;
      }
      case "size": {
        const w = numOf(a["width"]);
        const h = numOf(a["height"]);
        if (w !== undefined || h !== undefined) spec.size = { w, h };
        break;
      }
      default:
        break;
    }
  }
  return spec;
}

function numOf(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------- 展开成渲染层 ----------------

/** 渲染层（预览/画布消费的最小单位） */
export interface RenderLayer {
  key: string;
  /** 面包屑，如 "layer-list#2 › shape" */
  path: string;
  /** 层类型：shape 走 specToCss，color 直接用色值，ripple 是波纹高亮层 */
  kind: "shape" | "color" | "ripple" | "vector" | "bitmap" | "unsupported";
  spec?: ShapeSpec;
  color?: string;
  /** 四边内缩/偏移（dp，累加后的绝对值） */
  inset: { l: number; t: number; r: number; b: number };
  /** 固定尺寸（dp） */
  size?: { w?: number; h?: number };
  alpha: number;
  gravity?: string;
}

export interface FlattenOptions {
  state?: ViewState;
  /** @drawable/x → 该资源的 XML 文本；返回 null 表示读不到 */
  resolveRef?: (name: string) => string | null;
  /** 递归保护 */
  maxDepth?: number;
}

/**
 * 按当前视图状态展开成「自底向上」的有序渲染层。
 * - layer-list：全部展开
 * - selector：只展开第一个匹配项
 * - ripple：展开 content，pressed 时在末尾追加波纹层
 * - inset：内缩累加到子层
 * - ref：读文件后递归
 */
export function flattenDrawable(node: DrawableNode, opts: FlattenOptions = {}): RenderLayer[] {
  const out: RenderLayer[] = [];
  const state = opts.state ?? {};
  walk(node, {
    out,
    state,
    resolveRef: opts.resolveRef,
    maxDepth: opts.maxDepth ?? 8,
    depth: 0,
    path: [],
    inset: { l: 0, t: 0, r: 0, b: 0 },
    alpha: 1,
    keyPrefix: "r",
  });
  return out;
}

interface WalkCtx {
  out: RenderLayer[];
  state: ViewState;
  resolveRef?: (name: string) => string | null;
  maxDepth: number;
  depth: number;
  path: string[];
  inset: { l: number; t: number; r: number; b: number };
  alpha: number;
  keyPrefix: string;
}

function walk(node: DrawableNode, ctx: WalkCtx): void {
  if (ctx.depth > ctx.maxDepth) return;

  const label = (s: string) => [...ctx.path, s].join(" › ");

  switch (node.t) {
    case "shape": {
      ctx.out.push({
        key: ctx.keyPrefix,
        path: label("shape"),
        kind: "shape",
        spec: node.spec,
        inset: { ...ctx.inset },
        alpha: ctx.alpha,
      });
      return;
    }
    case "color": {
      ctx.out.push({
        key: ctx.keyPrefix,
        path: label("color"),
        kind: "color",
        color: node.color,
        inset: { ...ctx.inset },
        alpha: ctx.alpha,
      });
      return;
    }
    case "layer": {
      node.items.forEach((item, i) => {
        const off = item.offset ?? {};
        walk(item.node, {
          ...ctx,
          depth: ctx.depth + 1,
          path: [...ctx.path, `item#${i}`],
          inset: addInset(ctx.inset, off),
          alpha: ctx.alpha * (item.alpha ?? 1),
          keyPrefix: `${ctx.keyPrefix}.${i}`,
        });
      });
      return;
    }
    case "selector": {
      const hit = pickStateItem(node.items, ctx.state);
      if (!hit) return;
      walk(hit.node, {
        ...ctx,
        depth: ctx.depth + 1,
        path: [...ctx.path, `state(${describeStates(hit.states)})`],
        keyPrefix: `${ctx.keyPrefix}.s`,
      });
      return;
    }
    case "ripple": {
      if (node.content) {
        walk(node.content, { ...ctx, depth: ctx.depth + 1, path: [...ctx.path, "content"], keyPrefix: `${ctx.keyPrefix}.c` });
      }
      if (ctx.state.pressed) {
        ctx.out.push({
          key: `${ctx.keyPrefix}.ripple`,
          path: label("ripple"),
          kind: "ripple",
          color: node.color ?? "#33FFFFFF",
          inset: { ...ctx.inset },
          alpha: ctx.alpha,
        });
      }
      return;
    }
    case "inset": {
      walk(node.node, {
        ...ctx,
        depth: ctx.depth + 1,
        path: [...ctx.path, "inset"],
        inset: addInset(ctx.inset, {
          l: node.left,
          t: node.top,
          r: node.right,
          b: node.bottom,
        }),
        keyPrefix: `${ctx.keyPrefix}.i`,
      });
      return;
    }
    case "ref": {
      const xml = ctx.resolveRef?.(node.name);
      const parsed = xml ? parseDrawable(xml) : null;
      if (!parsed) {
        ctx.out.push({
          key: `${ctx.keyPrefix}.ref`,
          path: label(`@drawable/${node.name}`),
          kind: "unsupported",
          inset: { ...ctx.inset },
          alpha: ctx.alpha,
        });
        return;
      }
      walk(parsed, {
        ...ctx,
        depth: ctx.depth + 1,
        path: [...ctx.path, `@drawable/${node.name}`],
        keyPrefix: `${ctx.keyPrefix}.r`,
      });
      return;
    }
    default: {
      ctx.out.push({
        key: `${ctx.keyPrefix}.x`,
        path: label((node as UnsupportedNode).tag),
        kind: "unsupported",
        inset: { ...ctx.inset },
        alpha: ctx.alpha,
      });
    }
  }
}

function addInset(
  base: { l: number; t: number; r: number; b: number },
  d: { l?: number; t?: number; r?: number; b?: number },
): { l: number; t: number; r: number; b: number } {
  return {
    l: base.l + (d.l ?? 0),
    t: base.t + (d.t ?? 0),
    r: base.r + (d.r ?? 0),
    b: base.b + (d.b ?? 0),
  };
}

/** 按 Android 规则挑状态项：第一个「所有 state_* 都相等」的赢；无 state_* 的兜底 */
export function pickStateItem(items: StateItem[], state: ViewState): StateItem | null {
  for (const it of items) {
    if (matchesState(it.states, state)) return it;
  }
  return null;
}

export function matchesState(states: Record<string, string>, state: ViewState): boolean {
  for (const [k, v] of Object.entries(states)) {
    const key = k.replace(/^state_/, "");
    const expected = v === "true";
    // View 的默认态：enabled / window_focused / accelerated 默认 true，其余默认 false
    const fallback = key === "enabled" || key === "window_focused" || key === "accelerated";
    const actual = key in state ? !!state[key] : fallback;
    if (expected !== actual) return false;
  }
  return true;
}

function describeStates(states: Record<string, string>): string {
  const on = Object.entries(states)
    .filter(([, v]) => v === "true")
    .map(([k]) => k.replace(/^state_/, ""));
  const off = Object.entries(states)
    .filter(([, v]) => v !== "true")
    .map(([k]) => `!${k.replace(/^state_/, "")}`);
  const all = [...on, ...off];
  return all.length ? all.join(",") : "default";
}

/** 树的节点计数（给 UI 显示复杂度 / 测试用） */
export function countNodes(node: DrawableNode): number {
  switch (node.t) {
    case "layer":
      return 1 + node.items.reduce((s, i) => s + countNodes(i.node), 0);
    case "selector":
      return 1 + node.items.reduce((s, i) => s + countNodes(i.node), 0);
    case "ripple":
      return 1 + (node.content ? countNodes(node.content) : 0) + (node.mask ? countNodes(node.mask) : 0);
    case "inset":
      return 1 + countNodes(node.node);
    default:
      return 1;
  }
}

/** 顶层是不是"纯一个形状"（决定 UI 显示简版还是图层面板） */
export function isPlainShape(node: DrawableNode): boolean {
  return node.t === "shape";
}
