// components/XmlCanvas.tsx — M1a React 渲染层
// 把 RenderModel 递归渲染成 div，支持选中（data-path + 高亮）与拖放落位高亮。
// M2c：ConstraintLayout 子项被选中时，四边出现约束手柄，拖到目标控件上即可建立约束。

"use client";

import { useRef, useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import { DRAG_WIDGET_MIME } from "./widget-catalog";
import { isContainerTag } from "@/lib/xml/insert";

export type ConstraintSide = "start" | "end" | "top" | "bottom";

interface XmlCanvasProps {
  node: ResolvedNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** 拖组件到画布上：path = 落点节点，key = 组件 key */
  onDropWidget?: (path: string, key: string, isContainer: boolean) => void;
  /** M2c：画约束线。childPath = 被约束的子控件，targetPath = 目标（"CL" 表示父容器） */
  onConstraintDraw?: (
    childPath: string,
    side: ConstraintSide,
    targetPath: string,
    targetSide: ConstraintSide,
  ) => void;
  /** 递归用：父节点 path / tag / 是否 ConstraintLayout */
  _parentPath?: string;
  _parentTag?: string;
}

/** 短类名 */
function shortTag(tag: string): string {
  return tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
}

interface DragState {
  side: ConstraintSide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function XmlCanvas({ node, selectedPath, onSelect, onDropWidget, onConstraintDraw, _parentPath, _parentTag }: XmlCanvasProps) {
  const [dropHit, setDropHit] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const selfRef = useRef<HTMLDivElement | null>(null);

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

  // 是否显示约束手柄：自己选中 + 父是 ConstraintLayout + 自己不是 Guideline/Barrier
  const inCL = _parentTag !== undefined && shortTag(_parentTag) === "ConstraintLayout";
  const st = shortTag(node.tag);
  const showHandles = !!onConstraintDraw && isSel && inCL && st !== "Guideline" && st !== "Barrier";

  const beginDrag = (side: ConstraintSide) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = selfRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = side === "start" ? rect.left : side === "end" ? rect.right : rect.left + rect.width / 2;
    const cy = side === "top" ? rect.top : side === "bottom" ? rect.bottom : rect.top + rect.height / 2;
    setDrag({ side, x1: cx, y1: cy, x2: cx, y2: cy });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, x2: e.clientX, y2: e.clientY });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const side = drag.side;
    setDrag(null);
    const x = e.clientX;
    const y = e.clientY;
    // 命中测试：找光标下的节点（优先非自身）
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    let targetEl: HTMLElement | null = null;
    let hitSelf = false;
    for (const el of els) {
      const p = el.dataset?.path;
      if (!p) continue;
      if (p === node.path) { hitSelf = true; continue; }
      targetEl = el;
      break;
    }
    // 落到父容器空白处 → 约束到 parent
    const isParentHit = !targetEl || targetEl.dataset.path === _parentPath;

    if (isParentHit) {
      // parent 侧：同边对接
      onConstraintDraw?.(node.path, side, "CL", side);
      return;
    }
    if (!targetEl) return;

    // 依目标控件的中心判断接哪条边
    const tr = targetEl.getBoundingClientRect();
    const horizontal = side === "start" || side === "end";
    const beforeCenter = horizontal ? x < tr.left + tr.width / 2 : y < tr.top + tr.height / 2;
    const targetSide: ConstraintSide = horizontal
      ? beforeCenter ? "start" : "end"
      : beforeCenter ? "top" : "bottom";
    onConstraintDraw?.(node.path, side, targetEl.dataset.path!, targetSide);
  };

  return (
    <div
      ref={selfRef}
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
          onConstraintDraw={onConstraintDraw}
          _parentPath={node.path}
          _parentTag={node.tag}
        />
      ))}

      {showHandles ? (
        <>
          {(["start", "end", "top", "bottom"] as ConstraintSide[]).map((side) => (
            <span
              key={side}
              className={"axv-handle axv-handle-" + side}
              data-side={side}
              onPointerDown={beginDrag(side)}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onClick={(e) => e.stopPropagation()}
              title={"拖到目标控件上建立 " + side + " 约束"}
            />
          ))}
          {drag ? (
            <svg className="axv-constraint-drag" aria-hidden="true">
              <line x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2} />
              <circle cx={drag.x2} cy={drag.y2} r={4} />
            </svg>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
