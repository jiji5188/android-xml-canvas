// lib/xml/layer-filter.ts — 图层树搜索（M29）
//
// 30+ 节点后靠肉眼找控件很痛苦，所以按名字过滤：
//  - 命中：tag / id / text / 显示标签 任一包含关键字（不区分大小写）
//  - 命中节点的**祖先**要保留（不然看不到自己在哪一层）
//  - 命中节点的**后代**也保留（命中容器时能看到里面有什么）
// 纯函数，返回要保留的 path 集合。

import type { XmlNode } from "./types";

/** 图层行显示的名字：文本优先，其次 id，最后 tag（与 LayerTree.label 保持一致） */
export function layerLabel(n: XmlNode): string {
  const id = n.attrs["id"];
  const text = n.attrs["text"];
  if (text && text.length <= 12) return `"${text}"`;
  if (id) return id.replace(/^@\+?id\//, "");
  return n.tag;
}

/** 单个节点是否命中关键字 */
export function layerMatches(n: XmlNode, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [n.tag, n.attrs["id"] ?? "", n.attrs["text"] ?? "", layerLabel(n), n.attrs["android:id"] ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export interface LayerFilterResult {
  /** 需要渲染的 path */
  keep: Set<string>;
  /** 命中的 path（用于高亮） */
  hits: Set<string>;
  /** 是否处于过滤状态 */
  active: boolean;
}

/** 过滤整棵树：命中 + 祖先 + 后代 */
export function filterLayerTree(root: XmlNode | null, q: string): LayerFilterResult {
  const keep = new Set<string>();
  const hits = new Set<string>();
  const needle = q.trim();
  if (!root) return { keep, hits, active: false };
  if (!needle) {
    // 不过滤：全保留（由组件决定折叠状态）
    const walk = (n: XmlNode) => {
      keep.add(n.path);
      for (const c of n.children) walk(c);
    };
    walk(root);
    return { keep, hits, active: false };
  }

  const markSubtree = (n: XmlNode) => {
    keep.add(n.path);
    for (const c of n.children) markSubtree(c);
  };

  // 返回：子树里是否有命中（有 → 当前节点作为祖先保留）
  const walk = (n: XmlNode): boolean => {
    const self = layerMatches(n, needle);
    if (self) {
      hits.add(n.path);
      markSubtree(n);
      return true;
    }
    let childHit = false;
    for (const c of n.children) {
      if (walk(c)) childHit = true;
    }
    if (childHit) keep.add(n.path);
    return childHit;
  };
  walk(root);
  return { keep, hits, active: true };
}
