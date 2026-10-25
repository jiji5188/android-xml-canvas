// components/XmlCanvas.tsx — M1a React 渲染层
// 把 RenderModel 递归渲染成 div，支持选中（data-path + 高亮）。

import type { ResolvedNode } from "@/lib/xml/types";

interface XmlCanvasProps {
  node: ResolvedNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function XmlCanvas({ node, selectedPath, onSelect }: XmlCanvasProps) {
  const isSel = selectedPath === node.path;
  const style: React.CSSProperties = {
    ...(node.style as React.CSSProperties),
    position: "relative",
    outline: isSel ? "2px solid #E11D48" : undefined,
    outlineOffset: isSel ? 1 : undefined,
  };

  return (
    <div
      data-path={node.path}
      data-tag={node.tag}
      className={"axv-node " + node.className + (isSel ? " axv-selected" : "")}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.path);
      }}
      title={node.tag + (node.rawAttrs.id ? " · " + node.rawAttrs.id : "") + (node.text ? " · " + node.text : "")}
    >
      {node.text ? <span>{node.text}</span> : null}
      {node.children.map((c) => (
        <XmlCanvas key={c.path} node={c} selectedPath={selectedPath} onSelect={onSelect} />
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
