// lib/xml/drawable-edit.ts — drawable 树的编辑操作（M121）
//
// 只做不可变更新：输入旧树，返回新树 + 新选中路径。
// UI 只管"点了加一层/上移/删除/改属性"，所有结构语义都落在这里，方便单测也方便以后复用。
//
// 路径 Path = 从根往下的子节点索引序列（[] = 根本身）。
// 子节点索引的语义由容器决定：
//   layer-list → items[i]
//   selector   → items[i]
//   ripple     → 0 = content，1 = mask
//   inset      → 0 = 唯一的内容

import type { DrawableNode, LayerItem, StateItem } from "./drawable-node";

export type Path = number[];

let keySeq = 0;
const nextKey = (path: Path, i: number) => `${path.join(".") || "0"}:${i}:${++keySeq}`;

/** 这个容器有几个子节点 */
export function childCount(node: DrawableNode): number {
  switch (node.t) {
    case "layer":
    case "selector":
      return node.items.length;
    case "ripple":
      return (node.content ? 1 : 0) + (node.mask ? 1 : 0);
    default:
      return 0;
  }
}

/** 取第 i 个子节点 */
export function childAt(node: DrawableNode, i: number): DrawableNode | null {
  switch (node.t) {
    case "layer":
    case "selector":
      return node.items[i]?.node ?? null;
    case "ripple":
      if (i === 0) return node.content ?? null;
      if (i === 1) return node.mask ?? null;
      return null;
    default:
      return null;
  }
}

/** 取路径对应的节点 */
export function nodeAt(root: DrawableNode, path: Path): DrawableNode | null {
  if (path.length === 0) return root;
  const [i, ...rest] = path;
  const child = childAt(root, i);
  if (!child) return null;
  return rest.length ? nodeAt(child, rest) : child;
}

/** 父节点（根返回 null） */
export function parentOf(root: DrawableNode, path: Path): DrawableNode | null {
  if (path.length === 0) return null;
  return nodeAt(root, path.slice(0, -1));
}

/** 把第 i 个子节点换成 next，其它结构不动 */
export function withChild(node: DrawableNode, i: number, next: DrawableNode): DrawableNode {
  switch (node.t) {
    case "layer": {
      const items = node.items.slice();
      if (!items[i]) return node;
      items[i] = { ...items[i], node: next };
      return { ...node, items };
    }
    case "selector": {
      const items = node.items.slice();
      if (!items[i]) return node;
      items[i] = { ...items[i], node: next };
      return { ...node, items };
    }
    case "ripple":
      if (i === 0) return { ...node, content: next };
      if (i === 1) return { ...node, mask: next };
      return node;
    default:
      return node;
  }
}

/** 用 next 替换路径上的节点（不可变） */
export function replaceAt(root: DrawableNode, path: Path, next: DrawableNode): DrawableNode {
  if (path.length === 0) return next;
  const [i, ...rest] = path;
  const cur = childAt(root, i);
  if (!cur) return root;
  const updated = rest.length ? replaceAt(cur, rest, next) : next;
  return withChild(root, i, updated);
}

/**
 * 给容器加一个子节点。满了或叶子节点返回 null。
 * 返回新树和新节点的路径（调用方通常要立刻选中它）。
 */
export function addChild(root: DrawableNode, path: Path, child: DrawableNode): { root: DrawableNode; path: Path } | null {
  const target = nodeAt(root, path);
  if (!target) return null;

  switch (target.t) {
    case "layer": {
      const item: LayerItem = { key: nextKey(path, target.items.length), node: child };
      const next: DrawableNode = { ...target, items: [...target.items, item] };
      return { root: replaceAt(root, path, next), path: [...path, target.items.length] };
    }
    case "selector": {
      const item: StateItem = { key: nextKey(path, target.items.length), states: {}, node: child };
      const next: DrawableNode = { ...target, items: [...target.items, item] };
      return { root: replaceAt(root, path, next), path: [...path, target.items.length] };
    }
    case "ripple": {
      if (!target.content) {
        return { root: replaceAt(root, path, { ...target, content: child }), path: [...path, 0] };
      }
      if (!target.mask) {
        return { root: replaceAt(root, path, { ...target, mask: child }), path: [...path, 1] };
      }
      return null;
    }
    default:
      return null;
  }
}

/** 删掉第 i 个子节点；删空后容器保持空（由校验去报错） */
export function removeChild(root: DrawableNode, path: Path, i: number): DrawableNode {
  const target = nodeAt(root, path);
  if (!target) return root;
  switch (target.t) {
    case "layer":
      return replaceAt(root, path, { ...target, items: target.items.filter((_, k) => k !== i) });
    case "selector":
      return replaceAt(root, path, { ...target, items: target.items.filter((_, k) => k !== i) });
    case "ripple":
      if (i === 0) return replaceAt(root, path, { ...target, content: undefined });
      if (i === 1) return replaceAt(root, path, { ...target, mask: undefined });
      return root;
    default:
      return root;
  }
}

/** 交换第 i 与 i+dir 个子节点（dir = -1 上移 / +1 下移） */
export function moveChild(root: DrawableNode, path: Path, i: number, dir: -1 | 1): DrawableNode {
  const target = nodeAt(root, path);
  if (!target) return root;
  const j = i + dir;
  const n = childCount(target);
  if (j < 0 || j >= n) return root;

  if (target.t === "layer" || target.t === "selector") {
    const items = target.items.slice();
    const t = items[i];
    items[i] = items[j];
    items[j] = t;
    return replaceAt(root, path, { ...target, items } as DrawableNode);
  }
  if (target.t === "ripple") {
    // ripple 的 content/mask 位置有意义，不允许互换
    return root;
  }
  return root;
}

/* ── 插槽属性（<item> 上的东西） ── */

export interface SlotValue {
  /** selector 子节点：状态位（"state_pressed": "true"；值给 undefined 表示删除） */
  states?: Record<string, string | undefined>;
  /** layer-list 子节点：四边偏移 */
  offset?: { l?: number; t?: number; r?: number; b?: number };
  /** layer-list 子节点：固定尺寸 */
  size?: { w?: number; h?: number };
  gravity?: string;
  alpha?: number;
  /** ripple 的第二个子节点 = 遮罩 */
  mask?: boolean;
}

/** 读路径位置的插槽属性 */
export function slotOf(root: DrawableNode, path: Path): SlotValue {
  const parent = parentOf(root, path);
  if (!parent) return {};
  const i = path[path.length - 1];
  switch (parent.t) {
    case "layer": {
      const it = parent.items[i];
      if (!it) return {};
      return {
        ...(it.offset ? { offset: { ...it.offset } } : {}),
        ...(it.size ? { size: { ...it.size } } : {}),
        ...(it.gravity ? { gravity: it.gravity } : {}),
        ...(it.alpha !== undefined ? { alpha: it.alpha } : {}),
      };
    }
    case "selector":
      return { states: { ...(parent.items[i]?.states ?? {}) } };
    case "ripple":
      return { mask: i === 1 };
    default:
      return {};
  }
}

/** 写路径位置的插槽属性（patch 里 undefined 表示清除该属性） */
export function setSlot(root: DrawableNode, path: Path, patch: Partial<SlotValue>): DrawableNode {
  const parent = parentOf(root, path);
  if (!parent) return root;
  const i = path[path.length - 1];

  switch (parent.t) {
    case "layer": {
      const items = parent.items.slice();
      const it = items[i];
      if (!it) return root;
      const next: LayerItem = { ...it };
      if ("offset" in patch) {
        const off = patch.offset;
        const clean = off
          ? Object.fromEntries(Object.entries(off).filter(([, v]) => v !== undefined && v !== 0))
          : {};
        if (Object.keys(clean).length) next.offset = clean as LayerItem["offset"];
        else delete next.offset;
      }
      if ("size" in patch) {
        const s = patch.size;
        if (s && (s.w !== undefined || s.h !== undefined)) next.size = s;
        else delete next.size;
      }
      if ("gravity" in patch) {
        if (patch.gravity) next.gravity = patch.gravity;
        else delete next.gravity;
      }
      if ("alpha" in patch) {
        if (patch.alpha !== undefined && patch.alpha !== 1) next.alpha = patch.alpha;
        else delete next.alpha;
      }
      items[i] = next;
      return replaceAt(root, path.slice(0, -1), { ...parent, items });
    }
    case "selector": {
      const items = parent.items.slice();
      const it = items[i];
      if (!it) return root;
      const merged: Record<string, string | undefined> = { ...it.states, ...(patch.states ?? {}) };
      const states: Record<string, string> = {};
      // undefined / "" 都表示删掉这个状态位
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== "") states[k] = v;
      }
      items[i] = { ...it, states };
      return replaceAt(root, path.slice(0, -1), { ...parent, items });
    }
    default:
      return root;
  }
}

/** 面包屑：从根到当前节点的可读标签 */
export function breadcrumb(root: DrawableNode, path: Path): { label: string; path: Path }[] {
  const out: { label: string; path: Path }[] = [{ label: rootLabel(root), path: [] }];
  let cur: DrawableNode | null = root;
  const acc: number[] = [];
  for (const i of path) {
    if (!cur) break;
    acc.push(i);
    const child = childAt(cur, i);
    if (!child) break;
    out.push({ label: childLabel(cur, i, child), path: acc.slice() });
    cur = child;
  }
  return out;
}

function rootLabel(node: DrawableNode): string {
  switch (node.t) {
    case "layer":
      return "图层叠加";
    case "selector":
      return "状态选择";
    case "ripple":
      return "水波纹";
    case "shape":
      return "形状";
    case "color":
      return "纯色";
    case "ref":
      return "引用";
    default:
      return (node as { tag?: string }).tag ?? "未知";
  }
}

/** 子节点在 UI 上的叫法（父容器决定语义，不出现 item 这个词） */
export function childLabelOf(parent: DrawableNode, i: number): string {
  const child = childAt(parent, i);
  return child ? childLabel(parent, i, child) : `第 ${i + 1} 项`;
}

/** 只要「插槽名」——按下 / 第 1 层 / 内容，不带类型（结构树里类型由后面的节点名给） */
export function slotLabelOf(parent: DrawableNode, i: number): string {
  if (parent.t === "layer") return `第 ${i + 1} 层`;
  if (parent.t === "selector") {
    const st = parent.items[i]?.states ?? {};
    const desc = Object.entries(st)
      .map(([k, v]) => stateLabel(k, v))
      .join("·");
    return desc || "兜底";
  }
  if (parent.t === "ripple") return i === 1 ? "遮罩" : "内容";
  return "内容";
}

function childLabel(parent: DrawableNode, i: number, child: DrawableNode): string {
  const kind = child.t === "shape" ? shapeLabel(child) : rootLabel(child);
  if (parent.t === "layer") return `第 ${i + 1} 层 · ${kind}`;
  if (parent.t === "selector") {
    const st = parent.items[i]?.states ?? {};
    const desc = Object.entries(st).map(([k, v]) => stateLabel(k, v)).join("·");
    return desc ? `${desc} · ${kind}` : `兜底 · ${kind}`;
  }
  if (parent.t === "ripple") return i === 1 ? "遮罩" : "内容";
  return kind;
}

/** 状态位的可读叫法：常见的翻成人话，其余回落到 名字 / 非名字 */
export function stateLabel(key: string, value: string): string {
  const on = value === "true";
  const name = key.replace(/^state_/, "");
  const zh: Record<string, [string, string]> = {
    pressed: ["按下", "非按下"],
    enabled: ["启用", "禁用"],
    focused: ["聚焦", "非聚焦"],
    hovered: ["悬停", "非悬停"],
    checked: ["勾选", "未勾选"],
    selected: ["选中", "非选中"],
    activated: ["激活", "非激活"],
    window_focused: ["窗口聚焦", "窗口失焦"],
    drag_can_accept: ["可拖入", "不可拖入"],
    drag_hovered: ["拖拽悬停", "非拖拽悬停"],
    above_anchor: ["在锚点上方", "不在锚点上方"],
    accelerated: ["硬件加速", "非硬件加速"],
  };
  const pair = zh[name];
  return pair ? (on ? pair[0] : pair[1]) : on ? name : `非${name}`;
}

function shapeLabel(node: Extract<DrawableNode, { t: "shape" }>): string {
  const k = node.spec.kind;
  const name = k === "rectangle" ? "矩形" : k === "oval" ? "椭圆" : k === "ring" ? "环形" : "线条";
  return name;
}
