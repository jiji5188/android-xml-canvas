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
import { parseShapeElement, type ShapeSpec } from "./shape-gen";

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

/** M127：几何变换（inset / clip / scale / rotate）——只包一个子节点、只改几何，所以不当节点 */
export type TransformKind = "inset" | "clip" | "scale" | "rotate" | "animated-rotate";

export interface Transform {
  kind: TransformKind;
  /** 原始属性（去掉 android: 前缀），值为字符串原样保留（如 "50%" / "4dp"） */
  params: Record<string, string>;
}

export type DrawableNode =
  | ShapeLeaf
  | ColorLeaf
  | RefLeaf
  | LayerNode
  | SelectorNode
  | RippleNode
  | UnsupportedNode;

/** 任何节点都可能带着一条变换链（外→内） */
export interface WithTransform {
  transform?: Transform[];
}

/** <shape> 叶子 */
export interface ShapeLeaf extends WithTransform {
  t: "shape";
  spec: ShapeSpec;
}

/** <color> 叶子（纯色 drawable） */
export interface ColorLeaf extends WithTransform {
  t: "color";
  /** 原始色值，如 #FF112233 / @color/x */
  color: string;
  /** 源文件是 <color>#fff</color> 文本写法（build 时原样写回文本，不改写成属性） */
  asText?: boolean;
}

/** android:drawable="@drawable/x" 或 <item android:drawable="@drawable/x"/> */
export interface RefLeaf extends WithTransform {
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

export interface LayerNode extends WithTransform {
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

export interface SelectorNode extends WithTransform {
  t: "selector";
  items: StateItem[];
}

export interface RippleNode extends WithTransform {
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

/** 暂不支持的标签（animated-vector / level-list / bitmap …），保留占位不崩 */
export interface UnsupportedNode extends WithTransform {
  t: "unsupported";
  tag: string;
  /** M120：原始子树序列化文本——「看不懂但不要弄丢」，build 时原样写回 */
  raw?: string;
}

const ELEMENT = (n: XmlNode) => n.tag !== "#text" && n.tag !== "#comment";

/** M127：包装类标签 —— 只包一个子节点、只改几何，解析时压成变换链，不当节点 */
export const WRAPPER_TAGS: TransformKind[] = ["inset", "clip", "scale", "rotate", "animated-rotate"];

export const isWrapperTag = (tag: string): tag is TransformKind =>
  (WRAPPER_TAGS as string[]).includes(tag);

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
  const { root, text } = parseLayoutXml(xml);
  if (!root) return null;
  const node = parseNode(root, "0", text);
  // <color>#ff0000</color> 的色值在文本节点里，parser 不保留文本 → 从原文兜底
  if (node.t === "color" && node.color === "#00000000") {
    const m = xml.match(/<color\b[^>]*>\s*(@?[#A-Za-z0-9_/.:]+)\s*<\/color>/i);
    if (m) {
      node.color = m[1];
      node.asText = true;
    }
  }
  // M126：保留原始 XML 声明，保存时原样放回去（以前会被丢掉）
  const decl = xml.match(/^\s*(<\?xml[\s\S]*?\?>)/i);
  if (decl) (node as { decl?: string }).decl = decl[1];
  return node;
}

function parseNode(node: XmlNode, path: string, src?: string): DrawableNode {
  switch (node.tag) {
    case "shape":
      return { t: "shape", spec: parseShapeLeaf(node) };
    case "color":
      // <color android:color="#f00"/> 或 <color>#f00</color>（文本节点解析器不保留，下面是兜底）
      return { t: "color", color: node.attrs["color"] ?? "#00000000" };
    case "layer-list":
      return { t: "layer", items: parseLayerItems(node, path, src) };
    case "selector":
      return { t: "selector", items: parseStateItems(node, path, src) };
    case "ripple":
      return parseRipple(node, path, src);
    case "inset":
    case "clip":
    case "scale":
    case "rotate":
    case "animated-rotate":
      return parseWrapper(node, path, src);
    default:
      return { t: "unsupported", tag: node.tag, raw: rawSlice(node, src) ?? serializeXmlNode(node) };
  }
}

/** M126：不认识的子树优先取**原始字节**（注释/换行/缩进全保留），拿不到才退回序列化 */
function rawSlice(node: XmlNode, src?: string): string | null {
  if (!src) return null;
  const { srcStart, srcEnd } = node;
  if (typeof srcStart !== "number" || typeof srcEnd !== "number") return null;
  if (srcEnd <= srcStart) return null;
  // 回退到行首，把原始缩进一并带走；回写时才能正确整体平移（否则首行无缩进、后续行缩进被算歪）
  let start = srcStart;
  while (start > 0 && src[start - 1] !== "\n") start--;
  return src.slice(start, srcEnd);
}

/** XmlNode → XML 文本（M120：给不支持的子树保留原文用；属性顺序保持解析顺序） */
export function serializeXmlNode(n: XmlNode, level = 0): string {
  const pad = "    ".repeat(level);
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => `android:${k}="${v}"`)
    .join(" ");
  const kids = n.children.filter((c) => c.tag !== "#text" && c.tag !== "#comment");
  if (kids.length === 0) return `${pad}<${n.tag}${attrs ? " " + attrs : ""}/>`;
  const inner = kids.map((c) => serializeXmlNode(c, level + 1)).join("\n");
  return `${pad}<${n.tag}${attrs ? " " + attrs : ""}>\n${inner}\n${pad}</${n.tag}>`;
}

function parseLayerItems(node: XmlNode, path: string, src?: string): LayerItem[] {
  const out: LayerItem[] = [];
  const items = kids(node).filter((c) => c.tag === "item");
  items.forEach((it, i) => {
    const key = `${path}.${i}`;
    const inner = it.attrs["drawable"] ? null : kids(it).find(ELEMENT);
    const child: DrawableNode = inner
      ? parseNode(inner, key, src)
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

function parseStateItems(node: XmlNode, path: string, src?: string): StateItem[] {
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
        ? parseNode(inner, key, src)
        : it.attrs["drawable"]
          ? toRefOrColor(it.attrs["drawable"])
          : { t: "unsupported", tag: "item" };
      out.push({ key, states, node: child });
    });
  return out;
}

function parseRipple(node: XmlNode, path: string, src?: string): DrawableNode {
  let content: DrawableNode | undefined;
  let mask: DrawableNode | undefined;
  kids(node)
    .filter((c) => c.tag === "item")
    .forEach((it, i) => {
      const key = `${path}.${i}`;
      const inner = kids(it).find(ELEMENT);
      const child: DrawableNode = inner
        ? parseNode(inner, key, src)
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


/**
 * M127：包装类标签（inset / clip / scale / rotate / animated-rotate）
 * 只包一个子节点、只改几何 → 不建节点，压成子节点上的变换链（外层在前）。
 * 这样树上不会多出一行「内缩」，用户看到的就是真实绘制的东西。
 */
function parseWrapper(node: XmlNode, path: string, src?: string): DrawableNode {
  const inner = kids(node).find(ELEMENT);
  const child: DrawableNode = inner
    ? parseNode(inner, `${path}.0`, src)
    : node.attrs["drawable"]
      ? toRefOrColor(node.attrs["drawable"])
      : { t: "unsupported", tag: node.tag };
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attrs)) params[k] = v;
  // 老写法 android:insetL / insetT 归一成 insetLeft / insetTop
  if (node.tag === "inset") {
    for (const [short, full] of [
      ["insetL", "insetLeft"],
      ["insetT", "insetTop"],
      ["insetR", "insetRight"],
      ["insetB", "insetBottom"],
    ] as const) {
      if (params[short] !== undefined && params[full] === undefined) {
        params[full] = params[short];
        delete params[short];
      }
    }
  }
  return withTransform(child, { kind: node.tag as TransformKind, params });
}

/** 把一条变换加到链首（外层在前），不修改入参 */
export function withTransform(node: DrawableNode, t: Transform): DrawableNode {
  return { ...node, transform: [t, ...(node.transform ?? [])] } as DrawableNode;
}

function toRefOrColor(raw: string): DrawableNode {
  const name = refName(raw);
  if (name) return { t: "ref", name };
  return { t: "color", color: raw };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** shape 叶子：直接复用 shape-gen 的解析（M120 起不再各写一套，避免漂移） */
function parseShapeLeaf(node: XmlNode): ShapeSpec {
  return parseShapeElement(node);
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
  /** M127：剩下的非内缩变换（旋转/缩放/裁剪），按外→内顺序，预览按顺序应用 */
  transform?: Transform[];
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
  /** M127：从祖先/自身累积的非内缩变换 */
  transform?: Transform[];
  /** 当前 item 显式指定的宽高（<item android:width/height>），优先于 shape 的 <size> */
  layerSize?: { w?: number; h?: number };
  /** 当前 item 的重力（默认 fill） */
  layerGravity?: string;
}

function walk(node: DrawableNode, ctxIn: WalkCtx): void {
  // M127：先消化变换链——内缩累加到几何，其余（旋转/缩放/裁剪）随层带走
  let ctx = ctxIn;
  if (node.transform?.length) {
    let inset = ctx.inset;
    const rest: Transform[] = [...(ctx.transform ?? [])];
    for (const t of node.transform) {
      if (t.kind === "inset") {
        inset = addInset(inset, {
          l: dp(t.params["insetLeft"]) ?? 0,
          t: dp(t.params["insetTop"]) ?? 0,
          r: dp(t.params["insetRight"]) ?? 0,
          b: dp(t.params["insetBottom"]) ?? 0,
        });
      } else if (t.kind !== "animated-rotate") {
        rest.push(t);
      }
    }
    ctx = { ...ctx, inset, transform: rest };
  }
  if (ctx.depth > ctx.maxDepth) return;

  const label = (s: string) => [...ctx.path, s].join(" › ");

  switch (node.t) {
    case "shape": {
      const size = ctx.layerSize ?? node.spec.size;
      const out: RenderLayer = {
        key: ctx.keyPrefix,
        path: label("shape"),
        kind: "shape",
        spec: node.spec,
        inset: { ...ctx.inset },
        alpha: ctx.alpha,
        ...(ctx.transform?.length ? { transform: [...ctx.transform] } : {}),
      };
      if (size?.w !== undefined || size?.h !== undefined) out.size = size;
      if (ctx.layerGravity) out.gravity = ctx.layerGravity;
      ctx.out.push(out);
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
        ...(ctx.transform?.length ? { transform: [...ctx.transform] } : {}),
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
          layerSize: item.size ?? ctx.layerSize,
          layerGravity: item.gravity ?? ctx.layerGravity,
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
          ...(ctx.transform?.length ? { transform: [...ctx.transform] } : {}),
        });
      }
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
          ...(ctx.transform?.length ? { transform: [...ctx.transform] } : {}),
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
        ...(ctx.transform?.length ? { transform: [...ctx.transform] } : {}),
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
    default:
      return 1;
  }
}

/** 顶层是不是"纯一个形状"（决定 UI 显示简版还是图层面板） */
export function isPlainShape(node: DrawableNode): boolean {
  return node.t === "shape";
}
