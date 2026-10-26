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
export type GeomMode = "move" | "left" | "right" | "top" | "bottom";

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
  /** 起点：布局 px（未受父级 transform 缩放影响） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 视觉缩放比（外层 transform: scale(fitRatio)），屏幕位移 ÷ 它 = 布局位移 */
  vs: number;
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
  const [geomLive, setGeomLive] = useState<{
    mode: GeomMode;
    /** 下面四个都是「布局 px」的绝对值（与写回 XML 的结果一一对应） */
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
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
  // 拖动时视觉跟随（松手才写回 XML）。
  // ⚠ 预览直接改 margin/width 的绝对值（不用 translate），这样松手后写回 XML 渲染出来的
  //   位置与拖拽时完全一致 → 不会出现「松手先弹回再跳到新位置」的双跳。
  if (isSel && geomLive) {
    const g = geomLive;
    if (g.mode === "move" || g.mode === "left") style.marginLeft = `${g.x}px`;
    if (g.mode === "move" || g.mode === "top") style.marginTop = `${g.y}px`;
    if (g.mode === "left" || g.mode === "right") style.width = `${g.w}px`;
    if (g.mode === "top" || g.mode === "bottom") style.height = `${g.h}px`;
    style.zIndex = 50;
  }

  // 是否显示约束手柄：自己选中 + 父是 ConstraintLayout + 自己不是 Guideline/Barrier
  const inCL = _parentTag !== undefined && shortTag(_parentTag) === "ConstraintLayout";
  const st = shortTag(node.tag);
  const showHandles = !!onConstraintDraw && isSel && inCL && st !== "Guideline" && st !== "Barrier";
  // 自由几何手柄：选中 + 非 CL 父 + 不是辅助节点
  const showGeom = !!onGeometryChange && isSel && !inCL && st !== "Guideline" && st !== "Barrier";
  // 根布局不能「移动」：它在窗口里总是填满内容区，写 layout_marginStart/Top 只会
  // 让根四边出现不对称间隙（预览已忽略根 margin，这里也不再给拖动手柄）
  const isRootNode = node.path === "#0";
  const showMoveHandle = showGeom && !isRootNode;

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

  // ===== M2d：自由拖动 / 四边拉伸 =====
  // ⚠ 关键：画布外层有 transform: scale(fitRatio) 缩放。getBoundingClientRect() 拿到的是
  // 【视觉尺寸】，直接 /scale 转 dp 会在松手时按 fitRatio 缩小一次（拖大反而变小）。
  // 所以统一换算成【布局 px】：尺寸用 offsetWidth/offsetHeight，位移用屏幕位移 ÷ vs，
  // 起点坐标直接读 computedStyle 的 margin（就是 layout_marginStart/Top 的实际值）。
  const beginGeom = (mode: GeomMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = selfRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const layoutW = el.offsetWidth || rect.width;
    const layoutH = el.offsetHeight || rect.height;
    // 视觉缩放比：视觉宽 ÷ 布局宽（无 transform 时为 1）
    const vs = layoutW > 0 && rect.width > 0 ? rect.width / layoutW : 1;
    geomRef.current = {
      mode,
      px: e.clientX,
      py: e.clientY,
      x: parseFloat(cs.marginLeft) || 0,
      y: parseFloat(cs.marginTop) || 0,
      w: layoutW,
      h: layoutH,
      vs,
    };
    setGeomLive({ mode, x: parseFloat(cs.marginLeft) || 0, y: parseFloat(cs.marginTop) || 0, w: layoutW, h: layoutH });

    /** 统一的几何推导：屏幕位移 → 绝对布局 px（预览与写回共用，保证两者完全一致） */
    const derive = (g: GeomDrag, ev: PointerEvent) => {
      // 屏幕位移 → 布局位移（除掉外层 transform 缩放）
      const dx = (ev.clientX - g.px) / g.vs;
      const dy = (ev.clientY - g.py) / g.vs;
      let x = g.x;
      let y = g.y;
      let w = g.w;
      let h = g.h;
      if (g.mode === "move") {
        x += dx;
        y += dy;
      } else if (g.mode === "left") {
        // 左边手柄：右缘固定 → x 跟着走，宽反向变
        x += dx;
        w -= dx;
      } else if (g.mode === "right") {
        w += dx;
      } else if (g.mode === "top") {
        // 上边手柄：下缘固定 → y 跟着走，高反向变
        y += dy;
        h -= dy;
      } else if (g.mode === "bottom") {
        h += dy;
      }
      w = Math.max(8, w);
      h = Math.max(8, h);
      return { x, y, w, h };
    };

    const move = (ev: PointerEvent) => {
      const g = geomRef.current;
      if (!g) return;
      const n = derive(g, ev);
      setGeomLive({ mode: g.mode, ...n });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const g = geomRef.current;
      geomRef.current = null;
      if (!g) {
        setGeomLive(null);
        return;
      }
      const n = derive(g, ev);
      // 布局 px → dp（除以 dp 比例，与 css.ts 的 DP() 互逆）
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const px2dp = (v: number) => r1(v / scale);
      // 关键：先写出新 XML（新节点样式）再清预览，避免「先弹回原位再跳到新位置」的双跳
      if (g.mode === "move") {
        onGeometryChange?.(node.path, { x: px2dp(n.x), y: px2dp(n.y) });
      } else if (g.mode === "left") {
        onGeometryChange?.(node.path, { x: px2dp(n.x), w: px2dp(n.w) });
      } else if (g.mode === "right") {
        onGeometryChange?.(node.path, { w: px2dp(n.w) });
      } else if (g.mode === "top") {
        onGeometryChange?.(node.path, { y: px2dp(n.y), h: px2dp(n.h) });
      } else if (g.mode === "bottom") {
        onGeometryChange?.(node.path, { h: px2dp(n.h) });
      }
      setGeomLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
          {showMoveHandle ? (
            <span
              className="axv-geom-move"
              title="拖动我移动控件（写回 layout_marginStart / layout_marginTop）"
              onPointerDown={beginGeom("move")}
              onClick={(e) => e.stopPropagation()}
            >
              ✥
            </span>
          ) : null}
          {(["left", "right", "top", "bottom"] as GeomMode[]).map((m) => (
            <span
              key={m}
              className={"axv-geom-resize axv-geom-" + m}
              title={
                m === "left"
                  ? "拖动改宽度（左边）"
                  : m === "right"
                    ? "拖动改宽度（右边）"
                    : m === "top"
                      ? "拖动改高度（上边）"
                      : "拖动改高度（下边）"
              }
              onPointerDown={beginGeom(m)}
              onClick={(e) => e.stopPropagation()}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
