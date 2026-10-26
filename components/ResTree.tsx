// components/ResTree.tsx — 左侧「资源」选项卡：树形展示 res/ 目录结构
// 点击 layout/*.xml 文件 → 调 onOpenLayout(name, content) 把内容画到预览。

"use client";

import { useState } from "react";
import type { ResTreeDir, ResTreeFile } from "@/lib/xml/resdir";

interface Props {
  tree: ResTreeDir;
  /** 点击布局文件（res/layout/*.xml）→ 打开并画到预览 */
  onOpenLayout: (fileName: string, content: string) => void;
  /** 可选：已上传的布局全文（res/layout 子树里文件可点开预览） */
  layouts?: Record<string, string> | null;
}

function isDir(v: ResTreeDir | ResTreeFile): v is ResTreeDir {
  return "children" in v;
}

const KIND_ICON: Record<ResTreeFile["kind"], string> = {
  layout: "📄",
  values: "📋",
  drawable: "🖼",
  mipmap: "🖼",
  menu: "☰",
  xml: "⚙",
  other: "•",
};

function sortChildren(children: Record<string, ResTreeDir | ResTreeFile>) {
  return Object.entries(children).sort(([a], [b]) => {
    // 目录优先
    const ad = isDir(a ? ({} as any) : null) ? 0 : 1;
    const bd = 1;
    // 简单按名称排序（目录在前）
    const aIsDir = "children" in (children[a] as any);
    const bIsDir = "children" in (children[b] as any);
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });
}

function TreeNode({
  name,
  node,
  depth,
  layouts,
  onOpenLayout,
  expanded,
  onToggle,
}: {
  name: string;
  node: ResTreeDir | ResTreeFile;
  depth: number;
  layouts?: Record<string, string> | null;
  onOpenLayout: (fileName: string, content: string) => void;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const indent = { paddingLeft: 12 + depth * 16 };

  if (isDir(node)) {
    const key = "d:" + name;
    const isExp = expanded.has(key);
    const entries = sortChildren(node.children);
    return (
      <div>
        <button
          className={"axv-treenode" + (isExp ? " axv-treenode-open" : "")}
          style={indent}
          onClick={() => onToggle(key)}
          title={name + "/"}
        >
          <span className="axv-tree-caret">{isExp ? "▾" : "▸"}</span>
          <span className="axv-tree-name">{name}/</span>
          <span className="axv-tree-count">{entries.length}</span>
        </button>
        {isExp ? entries.map(([cn, cv]) => (
          <TreeNode
            key={cn}
            name={cn}
            node={cv}
            depth={depth + 1}
            layouts={layouts}
            onOpenLayout={onOpenLayout}
            expanded={expanded}
            onToggle={onToggle}
          />
        )) : null}
      </div>
    );
  }

  // 文件
  const file = node as ResTreeFile;
  const canPreview = file.kind === "layout" && layouts && layouts[file.rel.split("/").pop() || ""] !== undefined;
  return (
    <button
      className={"axv-treenode" + (canPreview ? " axv-tree-clickable" : "")}
      style={{ ...indent, cursor: canPreview ? "pointer" : "default" }}
      onClick={() => {
        if (!canPreview) return;
        const content = layouts![file.rel.split("/").pop() || ""];
        if (content) onOpenLayout(file.rel, content);
      }}
      title={canPreview ? "点击在预览中打开此布局" : file.rel}
    >
      <span className="axv-tree-caret" style={{ visibility: "hidden" }}>▸</span>
      <span className="axv-tree-ico">{KIND_ICON[file.kind] || "•"}</span>
      <span className="axv-tree-name">{file.rel.split("/").pop()}</span>
    </button>
  );
}

export function ResTree({ tree, onOpenLayout, layouts }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 默认展开顶层目录
  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 初始化：把所有第一层目录默认展开
  const initExpanded = (d: ResTreeDir, depth: number, out: Set<string>) => {
    for (const [name, child] of Object.entries(d.children)) {
      if (isDir(child)) {
        const key = "d:" + name;
        if (depth === 0) out.add(key);
        initExpanded(child as ResTreeDir, depth + 1, out);
      }
    }
  };
  if (expanded.size === 0 && tree) {
    const init = new Set<string>();
    initExpanded(tree, 0, init);
    setExpanded(init);
  }

  const entries = sortChildren(tree.children);

  return (
    <div className="axv-restree">
      {entries.length === 0 ? (
        <div style={{ padding: 12, color: "#888", fontSize: 12 }}>
          尚无资源，请用工具栏「选择 res 文件 / res 目录」导入
        </div>
      ) : (
        entries.map(([name, node]) => (
          <TreeNode
            key={name}
            name={name}
            node={node}
            depth={0}
            layouts={layouts}
            onOpenLayout={onOpenLayout}
            expanded={expanded}
            onToggle={toggle}
          />
        ))
      )}
    </div>
  );
}
