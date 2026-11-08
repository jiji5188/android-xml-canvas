// lib/xml/inspector.ts — M186：右侧「检查器」tab 的纯逻辑（实测尺寸 / 溢出警告 / 层级）
// 所有计算都是纯函数（DOM 测量结果以参数传入），便于单测，不碰 React/DOM。

/** 检查器只需要「tag / path / 子节点 / id」，XmlNode 与 ResolvedNode 都满足 */
export interface InspectableNode {
  tag: string;
  path: string;
  children: InspectableNode[];
  /** 原始属性（XmlNode 用 attrs，ResolvedNode 用 rawAttrs） */
  attrs?: Record<string, string>;
  rawAttrs?: Record<string, string>;
}

/** 单个节点的 DOM 实测数据（已由调用方换算成 dp） */
export interface MeasuredNode {
  path: string;
  /** 控件短名（由采集方从 data-tag 或树里补上，DOM 属性缺失时可能是空串） */
  tag: string;
  /** 控件的 android:id（没有就空串），层级树显示用 */
  id?: string;
  /** 相对画布内容区左上角的 x/y（dp） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 直接父节点 path（根节点为 null） */
  parentPath: string | null;
}

export interface InspectorWarning {
  kind: "overflow" | "zero-size";
  path: string;
  message: string;
  line?: number;
}

export function fmtDp(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/** 树中找指定 path 的节点（线性深度优先，画布树不会深到需要优化） */
export function findNodeByPath(
  root: InspectableNode | null,
  path: string | null,
): InspectableNode | null {
  if (!root || !path) return null;
  let out: InspectableNode | null = null;
  const walk = (n: InspectableNode) => {
    if (n.path === path) { out = n; return; }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/**
 * 由 DOM 实测数据 + 树结构生成警告：
 * - overflow：子控件超出父控件边界（各方向 ≥ 1dp 才算，避免取整抖动）
 * - zero-size：宽高为 0 的控件
 * 调用方负责把 px 换算成 dp（除以 SCALE）。
 */
export function inspectorWarningsOf(
  root: InspectableNode | null,
  measured: MeasuredNode[],
  shortTag: (n: InspectableNode) => string = (n) => n.tag.split(".").pop() ?? n.tag,
): InspectorWarning[] {
  if (!root || measured.length === 0) return [];
  const byPath = new Map<string, MeasuredNode>();
  for (const m of measured) byPath.set(m.path, m);
  const out: InspectorWarning[] = [];
  const walk = (n: InspectableNode) => {
    const self = byPath.get(n.path);
    if (self && self.w <= 0.5 && self.h <= 0.5) {
      out.push({
        kind: "zero-size",
        path: n.path,
        message: `${shortTag(n)} 宽高为 0（可能没给到空间）`,
      });
    }
    for (const c of n.children) {
      const p = byPath.get(n.path);
      const c2 = byPath.get(c.path);
      if (p && c2) {
        // 只检查直接子节点是否越出直接父节点（嵌套情况逐层比较）
        const EPS = 1;
        if (
          c2.x < p.x - EPS ||
          c2.y < p.y - EPS ||
          c2.x + c2.w > p.x + p.w + EPS ||
          c2.y + c2.h > p.y + p.h + EPS
        ) {
          const dx = Math.max(p.x - c2.x, c2.x + c2.w - (p.x + p.w), 0);
          const dy = Math.max(p.y - c2.y, c2.y + c2.h - (p.y + p.h), 0);
          const where: string[] = [];
          if (c2.x < p.x - EPS) where.push("左");
          if (c2.y < p.y - EPS) where.push("上");
          if (c2.x + c2.w > p.x + p.w + EPS) where.push("右");
          if (c2.y + c2.h > p.y + p.h + EPS) where.push("下");
          void dx; void dy;
          out.push({
            kind: "overflow",
            path: c.path,
            message: `${shortTag(c)} 越出父容器 ${shortTag(n)}（${where.join("/")}边）`,
          });
        }
      }
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** 从 DOM 元素采集实测数据（px → dp 由调用方传入 scale 系数） */
export function collectMeasurements(
  /** 相对 stage 内容区左上角的坐标参考（stage 自身左上角会随滚动偏移，实测按 stage 内容区算） */
  stage: HTMLElement,
  els: Iterable<HTMLElement>,
  scale: number,
  tagOf: (n: { tag: string }) => string,
): MeasuredNode[] {
  const stageRect = stage.getBoundingClientRect();
  const list: MeasuredNode[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const p = el.dataset.path;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const r = el.getBoundingClientRect();
    const parentEl = el.parentElement;
    const parentPath = parentEl ? parentPathOf(parentEl, p, els) : null;
    void tagOf;
    list.push({
      path: p,
      tag: el.dataset.tag ?? "",
      x: Math.round(((r.left - stageRect.left) / scale) * 100) / 100,
      y: Math.round(((r.top - stageRect.top) / scale) * 100) / 100,
      w: Math.round((r.width / scale) * 100) / 100,
      h: Math.round((r.height / scale) * 100) / 100,
      parentPath,
    });
  }
  return list;
}

/** 从 DOM 元素上取直接父级的 data-path（父元素没有 data-path 就继续往上找一层） */
/** 取直接父控件的 path（调用方传的是 child.parentElement；再往上找一层是给画布外壳包装层留的余地） */
function parentPathOf(parentEl: HTMLElement, _childPath: string, _els: Iterable<HTMLElement>): string | null {
  if (parentEl.dataset && parentEl.dataset.path) return parentEl.dataset.path;
  if (parentEl.parentElement && parentEl.parentElement.dataset && parentEl.parentElement.dataset.path) {
    return parentEl.parentElement.dataset.path;
  }
  return null;
}

export interface InspectorTreeRow {
  path: string;
  tag: string;
  /** 控件的 android:id（没有就空串） */
  id: string;
  depth: number;
  expanded: boolean;
}

export function flattenTree(
  root: InspectableNode,
  expanded: Set<string>,
  limit = 400,
): InspectorTreeRow[] {
  const out: InspectorTreeRow[] = [];
  const walk = (n: InspectableNode, depth: number) => {
    if (out.length >= limit) return;
    out.push({
      path: n.path,
      tag: n.tag,
      id: n.rawAttrs?.id ?? n.attrs?.id ?? "",
      depth,
      expanded: expanded.has(n.path),
    });
    if (expanded.has(n.path)) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}
