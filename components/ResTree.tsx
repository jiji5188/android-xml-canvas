// components/ResTree.tsx — 左侧「资源」选项卡：树形展示 res/ 目录结构
// 点击 layout/*.xml 文件 → 调 onOpenLayout(name, content) 把内容画到预览。

"use client";

import { useState } from "react";
import type { ResTreeDir, ResTreeFile, ResourceExtras } from "../lib/xml/resdir";
import { resOpenAction, type ResOpenAction } from "../lib/xml/resource-open";
import { vectorToDataUrl } from "../lib/xml/vector-svg";

interface Props {
  tree: ResTreeDir;
  /** 点击布局文件（res/layout/*.xml）→ 打开并画到预览 */
  onOpenLayout: (fileName: string, content: string) => void;
  /** 可选：已上传的布局全文（res/layout 子树里文件可点开预览） */
  layouts?: Record<string, string> | null;
  /** 可选：上传的 res 解析结果（drawable 名 → dataURL 等） */
  extras?: ResourceExtras | null;
  /** drawable/*.xml（shape/ripple/selector…）→ 用形状编辑器打开 */
  onOpenDrawable?: (rel: string, name: string, xml: string) => void;
  /** 图片 / vector xml → 弹图片预览 */
  onPreviewImage?: (rel: string, name: string, url: string) => void;
  /** 可选：本工具生成的资源（图标 vector / 自定义 shape）——显示为树底部的虚拟目录 */
  generated?: Record<string, string>;
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
  extras,
  onOpenLayout,
  onOpenDrawable,
  onPreviewImage,
  expanded,
  onToggle,
}: {
  name: string;
  node: ResTreeDir | ResTreeFile;
  depth: number;
  layouts?: Record<string, string> | null;
  extras?: ResourceExtras | null;
  onOpenLayout: (fileName: string, content: string) => void;
  onOpenDrawable?: (rel: string, name: string, xml: string) => void;
  onPreviewImage?: (rel: string, name: string, url: string) => void;
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
            extras={extras}
            onOpenLayout={onOpenLayout}
            onOpenDrawable={onOpenDrawable}
            onPreviewImage={onPreviewImage}
            expanded={expanded}
            onToggle={onToggle}
          />
        )) : null}
      </div>
    );
  }

  // 文件
  const file = node as ResTreeFile;
  const baseName = file.rel.split("/").pop() || "";
  const canOpenLayout = file.kind === "layout" && layouts && layouts[baseName] !== undefined;
  /** M4u：drawable/mipmap 里的文件按类型分流：xml → 绘制编辑器，图片 → 预览框 */
  const action: ResOpenAction = file.kind === "drawable" || file.kind === "mipmap"
    ? resOpenAction(file.rel, file.text, extras ?? null)
    : { kind: "none" };
  const drawableHit = action.kind === "drawable" && !!onOpenDrawable;
  const imageHit = (action.kind === "image" || action.kind === "vector") && !!onPreviewImage;
  const canClick = canOpenLayout || drawableHit || imageHit;
  const title = canOpenLayout
    ? "点击在预览中打开此布局"
    : drawableHit
      ? "点击用绘制编辑器打开" + file.rel
      : imageHit
        ? "点击预览图片" + file.rel
        : file.rel;
  return (
    <button
      className={"axv-treenode" + (canClick ? " axv-tree-clickable" : "")}
      style={{ ...indent, cursor: canClick ? "pointer" : "default" }}
      onClick={() => {
        if (canOpenLayout) {
          const content = layouts![baseName];
          if (content) onOpenLayout(file.rel, content);
          return;
        }
        if (drawableHit && action.kind === "drawable") {
          onOpenDrawable!(file.rel, action.name, action.xml);
          return;
        }
        if (imageHit && (action.kind === "image" || action.kind === "vector")) {
          onPreviewImage!(file.rel, action.name, action.url);
        }
      }}
      title={title}
    >
      <span className="axv-tree-caret" style={{ visibility: "hidden" }}>▸</span>
      <span className="axv-tree-ico">{KIND_ICON[file.kind] || "•"}</span>
      <span className="axv-tree-name">{file.rel.split("/").pop()}</span>
    </button>
  );
}

export function ResTree({ tree, onOpenLayout, layouts, extras, onOpenDrawable, onPreviewImage, generated }: Props) {
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
            extras={extras}
            onOpenLayout={onOpenLayout}
            onOpenDrawable={onOpenDrawable}
            onPreviewImage={onPreviewImage}
            expanded={expanded}
            onToggle={toggle}
          />
        ))
      )}
      {/* M4v+：本工具生成的资源（图标 vector / 自定义 shape）——单独分组显示，
          让「生成器生成的图标没写进文件」这个疑问可视：它们确实存在（localStorage），
          导出 res.zip 时会进 drawable/；这里只是把它们画进树里方便点开 */}
      {generated && Object.keys(generated).length > 0 ? (
        <div>
          <button
            className="axv-treenode axv-treenode-open"
            style={{ paddingLeft: 12 }}
            title="本工具生成的资源（随 res.zip 导出到 drawable/）"
          >
            <span className="axv-tree-caret">▾</span>
            <span className="axv-tree-name">（生成资源）/</span>
            <span className="axv-tree-count">{Object.keys(generated).length}</span>
          </button>
          {Object.entries(generated)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, xml]) => {
              const rel = `drawable/${name}.xml`;
              const isShape = /^(ripple|shape|selector|layer-list|inset|animated-rotate|animation-list|level-list|clip|scale|transition|crossfade|bitmap)/.test(xml.trim());
              const canClick = isShape ? !!onOpenDrawable : !!onPreviewImage;
              return (
                <button
                  key={name}
                  className={"axv-treenode" + (canClick ? " axv-tree-clickable" : "")}
                  style={{ paddingLeft: 28, cursor: canClick ? "pointer" : "default" }}
                  title={isShape ? "点击用绘制编辑器打开（生成的形状）" + rel : "点击预览图标" + rel}
                  onClick={() => {
                    if (isShape && onOpenDrawable) onOpenDrawable(rel, name, xml);
                    else if (!isShape && onPreviewImage) {
                      try {
                        onPreviewImage(rel, name, vectorToDataUrl(xml) || "");
                      } catch {
                        /* 非 vector 就跳过预览 */
                      }
                    }
                  }}
                >
                  <span className="axv-tree-caret" style={{ visibility: "hidden" }}>▸</span>
                  <span className="axv-tree-ico">{isShape ? "⬛" : "🖼"}</span>
                  <span className="axv-tree-name">{name}.xml</span>
                </button>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}
