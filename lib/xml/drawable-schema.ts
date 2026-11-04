// lib/xml/drawable-schema.ts — drawable 节点类型定义（M120）
//
// 目的：让「加子节点 / 改属性」由数据驱动，而不是每加一种标签就改一次 UI。
// 这里只描述「每种节点允许什么子节点、允许什么属性、什么时候非法」，
// 不解析、不渲染、不碰 React —— 纯数据 + 纯函数，可单测。
//
// 三层角色（和 drawable-node.ts 的树一一对应）：
//   container  多个子 drawable（layer / selector / ripple 的 content+mask）
//   wrapper    恰好一个子 drawable（inset；以后 clip/scale/rotate 同形）
//   leaf       自己就会画，不需要往下拆（shape / color / ref）
//
// 关于 <item>：模型里不建 item 节点。item 是「父容器提供的插槽」，
// 它的属性（states / offsets / alpha / mask）存在子节点旁边的 slot 字段里，
// build 时由 drawable-build 自动补出 <item> 包装。

import type { DrawableNode } from "./drawable-node";

export type NodeKind = DrawableNode["t"] | "level-list" | "clip" | "scale" | "rotate" | "unsupported";

export type NodeRole = "container" | "wrapper" | "leaf";

/** 属性值类型——决定 UI 用哪种控件、build 时怎么写 */
export type AttrType =
  | "color" // #AARRGGBB / @color/x
  | "dimension" // 4dp / @dimen/x
  | "fraction" // 0~1 的小数
  | "percent" // "50%" / 50%
  | "boolean" // true / false
  | "enum" // 固定取值
  | "reference" // @drawable/x / @color/x
  | "number" // 纯数字
  | "string"; // 其它原样文本

export interface AttrDef {
  /** XML 里的 localName（不带 android: 前缀） */
  name: string;
  type: AttrType;
  label: string;
  /** type=enum 时的合法值 */
  values?: string[];
  /** 该属性需要的最低 API；低于此版本 Android 会忽略 */
  api?: number;
  default?: string;
  note?: string;
}

/** 可以加的子节点：给 UI 的「＋」菜单用 */
export interface ChildDef {
  kind: NodeKind;
  label: string;
  /** 新节点的默认内容（深拷贝后使用） */
  make: () => DrawableNode;
}

export interface NodeDef {
  kind: NodeKind;
  /** 对应的 XML 标签 */
  tag: string;
  label: string;
  role: NodeRole;
  api?: number;
  /** 属性表（顺序 = UI 里的显示顺序） */
  attrs: AttrDef[];
  /** 子节点约束；leaf 没有 */
  children?: {
    min: number;
    max: number; // Infinity 表示不限
    of: ChildDef[];
    /** 子节点上允许出现的 slot 字段（states / offsets / alpha / mask） */
    slot: SlotField[];
    /** 每个子节点在 UI 上怎么称呼（避免出现 "item" 这个词） */
    childLabel: (index: number) => string;
  };
  /** false = 只读保留（能看能删，不展开编辑） */
  editable: boolean;
  /** UI 上的补充说明 */
  note?: string;
}

export type SlotField = "states" | "offsets" | "alpha" | "gravity" | "mask";

/* ── 节点工厂：新加节点时的默认内容 ── */

const newShape = (): DrawableNode => ({ t: "shape", spec: { kind: "rectangle", solid: "#FFEEEEEE", radius: 8 } });
const newColor = (): DrawableNode => ({ t: "color", color: "#FFEEEEEE" });
const newRipple = (): DrawableNode => ({
  t: "ripple",
  color: "#33FFFFFF",
  content: newShape(),
});
const newLayer = (): DrawableNode => ({ t: "layer", items: [{ key: "0.0", node: newShape() }] });
const newSelector = (): DrawableNode => ({
  t: "selector",
  items: [{ key: "0.0", states: {}, node: newShape() }],
});
const newRef = (): DrawableNode => ({ t: "ref", name: "" });
const opaque = (tag: string): DrawableNode => ({ t: "unsupported", tag });

/** 容器可以加的「叶子/容器」清单（不含 ref：ref 走 item 的引用模式，单独入口） */
const DRAWABLE_CHOICES: ChildDef[] = [
  { kind: "shape", label: "形状", make: newShape },
  { kind: "color", label: "纯色", make: newColor },
  { kind: "layer", label: "图层叠加", make: newLayer },
  { kind: "selector", label: "状态选择", make: newSelector },
  { kind: "ripple", label: "水波纹", make: newRipple },
  { kind: "ref", label: "引用已有资源", make: newRef },
];

const STATE_ATTRS: string[] = [
  "state_pressed",
  "state_focused",
  "state_hovered",
  "state_enabled",
  "state_checked",
  "state_selected",
  "state_activated",
  "state_window_focused",
  "state_accelerated",
  "state_drag_can_accept",
  "state_drag_hovered",
  "state_above_anchor",
];

export const STATE_ATTR_DEFS: AttrDef[] = STATE_ATTRS.map((name) => ({
  name,
  type: "boolean" as const,
  label: name.replace(/^state_/, "").replace(/_/g, " "),
}));

const OFFSET_ATTRS: AttrDef[] = [
  { name: "left", type: "dimension", label: "左偏移", note: "负值往外" },
  { name: "top", type: "dimension", label: "上偏移" },
  { name: "right", type: "dimension", label: "右偏移" },
  { name: "bottom", type: "dimension", label: "下偏移" },
  { name: "width", type: "dimension", label: "宽", api: 23, note: "item 固定宽，API 23+" },
  { name: "height", type: "dimension", label: "高", api: 23 },
  {
    name: "gravity",
    type: "enum",
    label: "对齐",
    values: ["center", "center_vertical", "center_horizontal", "top", "bottom", "left", "right", "fill"],
  },
  { name: "alpha", type: "fraction", label: "不透明度" },
];

export const NODE_DEFS: Record<string, NodeDef> = {
  layer: {
    kind: "layer",
    tag: "layer-list",
    label: "图层叠加",
    role: "container",
    attrs: [],
    children: {
      min: 1,
      max: Infinity,
      of: DRAWABLE_CHOICES,
      slot: ["offsets", "alpha", "gravity"],
      childLabel: (i) => `第 ${i + 1} 层`,
    },
    editable: true,
    note: "从下往上叠，数组第 0 个在最底层",
  },
  selector: {
    kind: "selector",
    tag: "selector",
    label: "状态选择",
    role: "container",
    attrs: [],
    children: {
      min: 1,
      max: Infinity,
      of: DRAWABLE_CHOICES,
      slot: ["states"],
      childLabel: (i) => `第 ${i + 1} 个状态`,
    },
    editable: true,
    note: "按顺序取第一个全部 state_* 都匹配的项；无 state_* 的当兜底，应放最后",
  },
  ripple: {
    kind: "ripple",
    tag: "ripple",
    label: "水波纹",
    role: "container",
    api: 21,
    attrs: [
      { name: "color", type: "color", label: "波纹色", default: "#33FFFFFF" },
      { name: "radius", type: "dimension", label: "波纹半径", api: 23, note: "不写 = 跟随形状裁剪" },
    ],
    children: {
      min: 1,
      max: 2,
      of: DRAWABLE_CHOICES,
      slot: ["mask"],
      childLabel: (i) => (i === 0 ? "内容" : "遮罩"),
    },
    editable: true,
    note: "一个内容 + 可选一个遮罩（遮罩只决定波纹画在哪里，本身不画）",
  },
  shape: {
    kind: "shape",
    tag: "shape",
    label: "形状",
    role: "leaf",
    attrs: [
      {
        name: "shape",
        type: "enum",
        label: "形状类型",
        values: ["rectangle", "oval", "line", "ring"],
        default: "rectangle",
      },
      { name: "innerRadiusRatio", type: "number", label: "内径比例", note: "仅 ring，内径/宽度" },
      { name: "thicknessRatio", type: "number", label: "环宽比例", note: "仅 ring，环宽/宽度" },
      { name: "useLevel", type: "boolean", label: "跟随 level", default: "false" },
    ],
    editable: true,
    note: "solid / gradient / corners / stroke / padding / size 是形状自己的参数，走形状面板，不算子节点",
  },
  color: {
    kind: "color",
    tag: "color",
    label: "纯色",
    role: "leaf",
    attrs: [{ name: "color", type: "color", label: "颜色" }],
    editable: true,
  },
  ref: {
    kind: "ref",
    tag: "item",
    label: "引用资源",
    role: "leaf",
    attrs: [{ name: "drawable", type: "reference", label: "资源" }],
    editable: true,
    note: "写出来是 <item android:drawable=\"@drawable/x\"/>，没有内嵌内容",
  },
  unsupported: {
    kind: "unsupported",
    tag: "?",
    label: "未支持的内容",
    role: "leaf",
    attrs: [],
    editable: false,
    note: "原样保留，不展开编辑",
  },

  // ── 认识的标签，但暂不做编辑（保留原文，能看见、能删） ──
  "level-list": {
    kind: "level-list",
    tag: "level-list",
    label: "等级列表",
    role: "container",
    attrs: [],
    editable: false,
    note: "按 level 数值切图，暂只读",
  },
};

/** 按树节点取定义；unsupported 走通用定义 */
export function defOf(node: DrawableNode): NodeDef {
  return NODE_DEFS[node.t] ?? NODE_DEFS.unsupported;
}

/* ── 校验 ── */

export interface Problem {
  /** 面包屑路径，和 flattenDrawable 的 path 同一套写法 */
  path: string;
  level: "error" | "warn";
  message: string;
}

const COLOR_RE = /^#([0-9a-fA-F]{3,8})$/;
const REF_RE = /^@(\+)?(color|drawable|mipmap|android:color|android:drawable)\/[A-Za-z0-9_.]+$/;

function stateIsDefault(states: Record<string, string>): boolean {
  return Object.keys(states).length === 0;
}

/**
 * 结构校验：只报「写完 Android 会画出意外结果 / aapt 会报错」的问题。
 * 不追求穷尽，重点是给 UI 一个可显示的红/黄提示。
 */
export function validateDrawable(node: DrawableNode): Problem[] {
  const out: Problem[] = [];
  visit(node, "", out);
  return out;
}

function visit(node: DrawableNode, path: string, out: Problem[]): void {
  const here = path || defOf(node).label;

  switch (node.t) {
    case "layer": {
      if (node.items.length === 0) {
        out.push({ path: here, level: "error", message: "图层叠加至少要有一层" });
      }
      node.items.forEach((it, i) => {
        if (it.alpha !== undefined && (it.alpha < 0 || it.alpha > 1)) {
          out.push({ path: `${here} › 第 ${i + 1} 层`, level: "error", message: "不透明度只能在 0~1" });
        }
        visit(it.node, `${here} › 第 ${i + 1} 层`, out);
      });
      return;
    }
    case "selector": {
      if (node.items.length === 0) {
        out.push({ path: here, level: "error", message: "状态选择至少要有一个状态项" });
      }
      const hasDefault = node.items.some((it) => stateIsDefault(it.states));
      if (!hasDefault) {
        out.push({ path: here, level: "warn", message: "没有兜底项：所有 state_* 都不匹配时什么都不会画" });
      } else {
        const idx = node.items.findIndex((it) => stateIsDefault(it.states));
        if (idx !== node.items.length - 1) {
          out.push({
            path: here,
            level: "warn",
            message: "兜底项（不带 state_*）不在最后，它后面的状态永远不会命中",
          });
        }
      }
      node.items.forEach((it, i) => {
        visit(it.node, `${here} › ${describeStates(it.states) || `第 ${i + 1} 项`}`, out);
      });
      return;
    }
    case "ripple": {
      if (!node.content) {
        out.push({ path: here, level: "error", message: "水波纹缺少内容项，按下时不会显示任何东西" });
      }
      if (node.content) visit(node.content, `${here} › 内容`, out);
      if (node.mask) visit(node.mask, `${here} › 遮罩`, out);
      return;
    }
    case "shape": {
      const s = node.spec;
      if (s.kind === "ring" && s.stroke) {
        out.push({ path: here, level: "warn", message: "ring 本身就有环宽，再写 stroke 会画出双环" });
      }
      if (s.kind === "ring" && s.corners) {
        out.push({ path: here, level: "warn", message: "ring 没有圆角概念，corners 会被忽略" });
      }
      if (s.kind === "line" && !s.stroke) {
        out.push({ path: here, level: "warn", message: "线条没有 stroke 就是空的" });
      }
      if (s.gradient && s.solid) {
        out.push({ path: here, level: "error", message: "渐变和纯色同时存在，Android 只会用渐变" });
      }
      return;
    }
    case "color": {
      if (!COLOR_RE.test(node.color) && !REF_RE.test(node.color)) {
        out.push({ path: here, level: "warn", message: `颜色值不合法：${node.color}` });
      }
      return;
    }
    case "ref": {
      if (!node.name.trim()) {
        out.push({ path: here, level: "error", message: "引用没有填资源名" });
      }
      return;
    }
    default:
      return;
  }
}

function describeStates(states: Record<string, string>): string {
  const parts = Object.entries(states).map(([k, v]) =>
    v === "true" ? k.replace(/^state_/, "") : `非${k.replace(/^state_/, "")}`,
  );
  return parts.join("·");
}

/** 这个节点能不能加子节点、加什么 */
export function childChoices(node: DrawableNode): ChildDef[] {
  const def = defOf(node);
  if (!def.children || !def.editable) return [];
  const cur = currentChildCount(node);
  if (cur >= def.children.max) return [];
  return def.children.of;
}

export function currentChildCount(node: DrawableNode): number {
  switch (node.t) {
    case "layer":
      return node.items.length;
    case "selector":
      return node.items.length;
    case "ripple":
      return (node.content ? 1 : 0) + (node.mask ? 1 : 0);
    default:
      return 0;
  }
}
