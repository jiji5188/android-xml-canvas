// components/XmlCanvas.tsx — M1a React 渲染层
// 把 RenderModel 递归渲染成 div，支持选中（data-path + 高亮）与拖放落位高亮。

"use client";

import { useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import { DRAG_WIDGET_MIME } from "./widget-catalog";
import { isContainerTag } from "@/lib/xml/insert";

interface XmlCanvasProps {
  node: ResolvedNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** 拖组件到画布上：path = 落点节点，key = 组件 key */
  onDropWidget?: (path: string, key: string, isContainer: boolean) => void;
}

export function XmlCanvas({ node, selectedPath, onSelect, onDropWidget }: XmlCanvasProps) {
  const [dropHit, setDropHit] = useState<string | null>(null);

  const isSel = selectedPath === node.path;
  const isContainer = node.children.length > 0 || isContainerTag(node.tag);
  // 注意：不能无条件写 position:relative —— ConstraintLayout 子项由求解器指定 absolute，
  // 覆盖成 relative 后 left/top 会变成「flow 位置 + 偏移」，约束布局预览就会全错位。
  const pos = (node.style.position as React.CSSProperties["position"]) ?? "relative";
  const style: React.CSSProperties = {
    ...(node.style as React.CSSProperties),
    position: pos,
    outline: isSel ? "2px solid #E11D48" : undefined,
    outlineOffset: isSel ? 1 : undefined,
  };

  return (
    <div
      data-path={node.path}
      data-tag={node.tag}
      className={
        "axv-node " +
        node.className +
        (isSel ? " axv-selected" : "") +
        (dropHit === node.path ? " axv-drop-hit" : "") +
        (isContainer ? " axv-container" : "")
      }
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.path);
      }}
      onDragOver={
        onDropWidget
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_WIDGET_MIME)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              setDropHit(node.path);
            }
          : undefined
      }
      onDragLeave={
        onDropWidget
          ? (e) => {
              // 只在真正离开该节点（而不是进入子节点）时清掉高亮
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropHit((p) => (p === node.path ? null : p));
            }
          : undefined
      }
      onDrop={
        onDropWidget
          ? (e) => {
              const key = e.dataTransfer.getData(DRAG_WIDGET_MIME);
              if (!key) return;
              e.preventDefault();
              e.stopPropagation();
              setDropHit(null);
              onDropWidget(node.path, key, isContainer);
            }
          : undefined
      }
      title={node.tag + (node.rawAttrs.id ? " · " + node.rawAttrs.id : "") + (node.text ? " · " + node.text : "")}
    >
      {node.text ? <span>{node.text}</span> : null}
      {node.children.map((c) => (
        <XmlCanvas
          key={c.path}
          node={c}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onDropWidget={onDropWidget}
        />
      ))}
    </div>
  );
}

/** 空状态 */
export function CanvasEmpty({ message }: { message: string }) {
  return (
    <div className="axv-canvas-empty">
      <span>{message}</span>
    </div>
  );
}
