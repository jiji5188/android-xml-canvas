// lib/xml/paths.ts — 渲染模型树里的「路径」工具（M7c 从 XmlEditor 抽出来的纯函数）
// 路径格式统一是 `#0/1/2`：`#` + 各级子项下标，根节点是 `#0`。
// 这里只做纯树操作，不碰 DOM、不碰 React，方便单测。

import type { ResolvedNode } from "./types";

/** 按 path 在渲染模型里找节点（深度优先，找不到返回 null） */
export function findResolvedNode(root: ResolvedNode | null | undefined, path: string): ResolvedNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    const hit = findResolvedNode(c, path);
    if (hit) return hit;
  }
  return null;
}

/** 把 `#0/1/2` 拆成父级路径 `#0/1` 和下标 2
 *  M7c 修正：旧实现直接 `"#" + segs.join("/")`，而 segs[0] 本身就带 `#`
 *  → 会得到 `##0/1`（findNode 找不到父节点，删节点静默失效） */
export function splitPath(path: string): { parentPath: string; index: number } {
  const segs = path.split("/").filter(Boolean).map((s) => s.replace(/^#/, ""));
  const last = segs[segs.length - 1] ?? "0";
  const index = Number(last);
  const parentPath = "#" + segs.slice(0, -1).join("/");
  return { parentPath, index: Number.isNaN(index) ? 0 : index };
}

/** 去掉 XML 片段里的 xmlns 声明（根节点已声明过，重复写会导致 aapt 报错） */
export const stripNs = (frag: string): string => frag.replace(/\s+xmlns:android="[^"]*"/g, "");

/** 收集全文档出现过的 id（生成不重复 id 用）；结构只需有 attrs.id / children */
export function collectIds(
  node: { attrs: Record<string, string>; children: unknown[] } | null | undefined,
  out: string[] = [],
): string[] {
  if (!node) return out;
  if (node.attrs?.id) out.push(node.attrs.id);
  for (const c of node.children as { attrs: Record<string, string>; children: unknown[] }[]) collectIds(c, out);
  return out;
}

/** 路径深度：`#0/1/2` → 2（根为 0） */
export function pathDepth(path: string): number {
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

/** 判断 child 是否是 ancestor 本身或其后代（拖拽防环用） */
export function isSelfOrDescendant(ancestorPath: string, childPath: string): boolean {
  return childPath === ancestorPath || childPath.startsWith(ancestorPath + "/");
}
