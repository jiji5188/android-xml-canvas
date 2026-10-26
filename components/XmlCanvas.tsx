// components/XmlCanvas.tsx — M1a React 渲染层
// 把 RenderModel 递归渲染成 div，支持选中（data-path + 高亮）与拖放落位高亮。
// M2c：ConstraintLayout 子项被选中时，四边出现约束手柄，拖到目标控件上即可建立约束。
// M2d：非 ConstraintLayout 父容器下，选中节点可自由拖动（改 XY）+ 四角拉伸（改宽高）。

"use client";

import { useCallback, useRef, useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import { DRAG_WIDGET_MIME } from "./widget-catalog";
import { isContainerTag } from "@/lib/xml/insert";

export type ConstraintSide = "start" | "end" | "top" | "bottom";
export type GeomMode = "move" | "nw" | "ne" | "sw" | "se";

/** 画布几何变化（单位 dp，相对父容器左上角） */
export interface GeomPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

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
  /** M2d：自由拖动 / 拉伸改 XY 与宽高（dp）
   *  - move 手柄 → 只写 x/y（layout_marginStart/Top）
   *  - 四角 resize → 只写 w/h（layout_width/height） */
  onGeometryChange?: (path: string, patch: GeomPatch) => void;
  /** 1dp = scale px（默认 2，与 css.ts 一致） */
  scale?: number;
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

interface GeomDrag {
  mode: GeomMode;
  px: number;
  py: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parentLeft: number;
  parentTop: number;
}

export function XmlCanvas({
  node,
  selectedPath,
  onSelect,
  onDropWidget,
  onConstraintDraw,
  onGeometryChange,
  scale = 2,
  _parentPath,
  _parentTag,
}: XmlCanvasProps) {
  const [dropHit, setDropHit] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [geomLive, setGeomLive] = useState<{ dx: number; dy: number; dw: number; dh: number } | null>(null);
  const selfRef = useRef<HTMLDivElement | null>(null);
  const geomRef = useRef<GeomDrag | null>(null);

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
  // 拖动时视觉跟随（松手才写回 XML）
  if (isSel && geomLive) {
    const t: string[] = [];
    if (geomLive.dx || geomLive.dy) t.push(`translate(${geomLive.dx}px, ${geomLive.dy}px)`);
    if (style.transform) t.push(String(style.transform));
    style.transform = t.join(" ");
    if (geomLive.dw || geomLive.dh) {
      style.width = `calc(${String(style.width ?? "auto")} + ${geomLive.dw}px)`;
      style.height = `calc(${String(style.height ?? "auto")} + ${geomLive.dh}px)`;
    }
    style.zIndex = 50;
  }

  // 是否显示约束手柄：自己选中 + 父是 ConstraintLayout + 自己不是 Guideline/Barrier
  const inCL = _parentTag !== undefined && shortTag(_parentTag) === "ConstraintLayout";
  const st = shortTag(node.tag);
  const showHandles = !!onConstraintDraw && isSel && inCL && st !== "Guideline" && st !== "Barrier";
  // 自由几何手柄：选中 + 非 CL 父 + 不是辅助节点
  const showGeom = !!onGeometryChange && isSel && !inCL && st !== "Guideline" && st !== "Barrier";

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
    for (const el of els) {
      const p = el.dataset?.path;
      if (!p) continue;
      if (p === node.path) continue;
      targetEl = el;
      break;
    }
    // 落到父容器空白处 → 约束到 parent
    const isParentHit = !targetEl || targetEl.dataset.path === _parentPath;

    if (isParentHit) {
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

  // ===== M2d：自由拖动 / 四角拉伸 =====
  const beginGeom = (mode: GeomMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = selfRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const prect = el.parentElement?.getBoundingClientRect();
    geomRef.current = {
      mode,
      px: e.clientX,
      py: e.clientY,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      parentLeft: prect?.left ?? 0,
      parentTop: prect?.top ?? 0,
    };
    setGeomLive({ dx: 0, dy: 0, dw: 0, dh: 0 });

    const move = (ev: PointerEvent) => {
      const g = geomRef.current;
      if (!g) return;
      const dx = ev.clientX - g.px;
      const dy = ev.clientY - g.py;
      if (g.mode === "move") setGeomLive({ dx, dy, dw: 0, dh: 0 });
      else {
        const dw = g.mode === "ne" || g.mode === "se" ? dx : g.mode === "nw" || g.mode === "sw" ? -dx : 0;
        const dh = g.mode === "sw" || g.mode === "se" ? dy : g.mode === "nw" || g.mode === "ne" ? -dy : 0;
        setGeomLive({
          dx: g.mode === "nw" || g.mode === "sw" ? dx : 0,
          dy: g.mode === "nw" || g.mode === "ne" ? dy : 0,
          dw,
          dh,
        });
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const g = geomRef.current;
      geomRef.current = null;
      setGeomLive(null);
      if (!g) return;
      const dx = ev.clientX - g.px;
      const dy = ev.clientY - g.py;
      let nx = g.x;
      let ny = g.y;
      let nw = g.w;
      let nh = g.h;
      if (g.mode === "move") {
        nx += dx;
        ny += dy;
      } else {
        if (g.mode === "nw" || g.mode === "sw") { nx += dx; nw -= dx; }
        if (g.mode === "ne" || g.mode === "se") { nw += dx; }
        if (g.mode === "nw" || g.mode === "ne") { ny += dy; nh -= dy; }
        if (g.mode === "sw" || g.mode === "se") { nh += dy; }
      }
      nw = Math.max(8, nw);
      nh = Math.max(8, nh);
      const relX = (nx - g.parentLeft) / scale;
      const relY = (ny - g.parentTop) / scale;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      // move 手柄：只写 x/y（保留原 w/h 语义：match_parent / wrap_content 不被破坏）
      // 四角 resize：只写 w/h（不改 x/y，避免同时改写 margin）
      if (g.mode === "move") {
        onGeometryChange?.(node.path, { x: r1(relX), y: r1(relY) });
      } else {
        onGeometryChange?.(node.path, { w: r1(nw / scale), h: r1(nh / scale) });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
      {(() => {
        const c = node.compound;
        if (!c) return node.text ? <span>{node.text}</span> : null;
        const icon = (src?: string) =>
          src ? (
            src.startsWith("data:") ? (
              <img
                className="axv-cdraw"
                src={src}
                alt=""
                style={{ width: "1em", height: "1em", objectFit: "contain", flex: "0 0 auto", marginRight: c.gap ? undefined : "0.25em" }}
              />
            ) : (
              <span
                className="axv-cdraw-ph"
                style={{
                  width: "1em",
                  height: "1em",
                  display: "inline-block",
                  border: "1px dashed #B0AEB8",
                  borderRadius: 2,
                  marginRight: c.gap ? undefined : "0.25em",
                  fontSize: 10,
                }}
              />
            )
          ) : null;
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: c.gap ? `${c.gap}px` : undefined, flexDirection: c.top || c.bottom ? "column" : "row" }}>
            {c.top ? icon(c.top) : null}
            <span style={{ display: "inline-flex", alignItems: "center", gap: c.start ? `${c.gap}px` : undefined }}>
              {c.start ? icon(c.start) : null}
              {node.text ? <span>{node.text}</span> : null}
              {c.end ? icon(c.end) : null}
            </span>
            {c.bottom ? icon(c.bottom) : null}
          </span>
        );
      })()}
      {node.children.map((c) => (
        <XmlCanvas
          key={c.path}
          node={c}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onDropWidget={onDropWidget}
          onConstraintDraw={onConstraintDraw}
          onGeometryChange={onGeometryChange}
          scale={scale}
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

      {showGeom ? (
        <>
          <span
            className="axv-geom-move"
            title="拖动我移动控件（写回 layout_marginStart / layout_marginTop）"
            onPointerDown={beginGeom("move")}
            onClick={(e) => e.stopPropagation()}
          >
            ✥
          </span>
          {(["nw", "ne", "sw", "se"] as GeomMode[]).map((m) => (
            <span
              key={m}
              className={"axv-geom-resize axv-geom-" + m}
              title="拖动改宽高（写回 layout_width / layout_height）"
              onPointerDown={beginGeom(m)}
              onClick={(e) => e.stopPropagation()}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
