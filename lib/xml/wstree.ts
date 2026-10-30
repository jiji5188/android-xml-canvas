// lib/xml/wstree.ts — 工作目录「相对路径扁平列表」→ 树
//
// M25b 从 components/XmlEditor.tsx 里搬出来的（那边只是渲染，不需要知道树怎么建）。
// ProjectPanel 和 XmlEditor 都用这一份，避免两边逻辑走偏。

import type { WsProject } from "@/lib/xml/workspace";

export interface WsNode {
  name: string;
  rel: string;
  kind: "dir" | "file";
  layoutCount: number;
  item: WsProject;
  children: WsNode[];
}

/** 把「相对路径扁平列表」还原成树（后端按 DFS 顺序返回，rel 带 / 分隔） */
export function buildWsTree(items: WsProject[]): WsNode[] {
  const root: WsNode = {
    name: "",
    rel: "",
    kind: "dir",
    layoutCount: 0,
    item: null as unknown as WsProject,
    children: [],
  };
  const map = new Map<string, WsNode>();
  for (const it of items) {
    const parts = it.rel.split("/").filter(Boolean);
    const parentRel = parts.slice(0, Math.max(0, parts.length - 1)).join("/");
    const parent = parentRel ? map.get(parentRel) ?? root : root;
    const node: WsNode = {
      name: it.name,
      rel: it.rel,
      kind: it.kind,
      layoutCount: it.layoutCount,
      item: it,
      children: [],
    };
    map.set(it.rel, node);
    parent.children.push(node);
  }
  return root.children;
}
