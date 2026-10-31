// components/LayerTree.tsx — 左侧滑面板「图层」页
// 当前屏幕的节点树，支持：展开/折叠、选中、上下移、删除、锁定（M20m）。
//
// M3d：拖拽排序（对标 Android Studio 的 Component Tree）
//  - 拖到某行的**上 1/4**  → 成为该节点的上一个兄弟（移到兄弟层）
//  - 拖到某行的**下 1/4**  → 成为该节点的下一个兄弟（移到兄弟层）
//  - 拖到某行的**中间 1/2** 且目标是容器 → 成为它的最后一个子项（移到子组件层）
//  三种落点分别显示蓝线 / 蓝线 / 高亮框，一眼能看出会掉到哪一层。
//
// M31j：拖拽从 HTML5 drag&drop 改成 pointer 事件。
//   原实现桌面能拖、**APK（WebView 触摸）完全拖不动**——WebView 不派发 dragstart。
//   现在鼠标直接拖、手指长按 220ms 后拖，两者共用同一套落点判定。

"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { XmlNode } from "../lib/xml/types";
import { isContainerTag } from "../lib/xml/insert";
import { filterLayerTree } from "../lib/xml/layer-filter";
import { autoScrollDelta, canDropOn, shouldStartDrag, zoneAt, type DropZone } from "../lib/xml/layer-drag";

/** 拖拽落点位置 */
export type { DropZone };

export interface DropTarget {
  path: string;
  zone: DropZone;
}

interface Props {
  root: XmlNode | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** 把 targetPath 挪到 toIndex（父级兄弟位置） */
  /** M34：上移/下移按钮改成拖拽手柄后不再使用，保留以免破坏调用方 */
  onMove?: (targetPath: string, toIndex: number) => void;
  /** 删除节点 */
  onRemove: (path: string) => void;
  /** 把 fromPath 拖到目标位置（M3d）；不传则禁用拖拽 */
  onDragMove?: (fromPath: string, target: DropTarget) => void;
  /** M20m：被锁定的节点路径（锁定后不能拖动/上下移/画布选中） */
  lockedPaths?: Set<string>;
  /** M20m：切换某个节点的锁定状态 */
  onToggleLock?: (path: string) => void;
}

export function LayerTree({ root, selectedPath, onSelect, onMove, onRemove, onDragMove, lockedPaths, onToggleLock }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragPath, setDragPath] = useState<string | null>(null);
  /** M34：正按着手柄但还没达到拖拽阈值（长按前 220ms 的视觉反馈） */
  const [pressPath, setPressPath] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  /** M29：搜索过滤（命中 + 祖先 + 后代） */
  const [q, setQ] = useState("");
  const filter = useMemo(() => filterLayerTree(root, q), [root, q]);
  /** M29：画布点选时把图层行滚进可视区 */
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (!selectedPath) return;
    const el = rowRefs.current.get(selectedPath);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedPath, q]);

  if (!root) return <div className="axv-lt-empty">没有节点</div>;

  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const label = (n: XmlNode): string => {
    const id = n.attrs["id"];
    const text = n.attrs["text"];
    if (text && text.length <= 12) return `"${text}"`;
    if (id) return id.replace(/^@\+?id\//, "");
    return n.tag;
  };

  /* ===== M31j：pointer 拖拽（鼠标 + 触摸通用） ===== */
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragFromRef = useRef<string | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const endDrag = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dragFromRef.current = null;
    dropRef.current = null;
    setPressPath(null);
    setDragPath(null);
    setDrop(null);
    document.body.classList.remove("axv-lt-dragging");
  };

  /** 在手势开始时绑窗口监听（不依赖行的 pointermove，手指移出行也能继续拖）
   *  M34：只从**拖拽手柄**启动（fromHandle=true）；在行上按不触发拖拽，避免和滚动/点选打架 */
  const beginPress = (path: string, e: React.PointerEvent<HTMLElement>, fromHandle = false) => {
    if (!onDragMove) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (!fromHandle && (e.target as HTMLElement).closest("button, input, select, a")) return;
    // 手柄是真正的拖拽起点：阻止默认行为（文字选中/长按菜单），并让手指移动不滚列表
    if (fromHandle) {
      try {
        e.preventDefault();
      } catch {
        /* ignore */
      }
      setPressPath(path);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const t0 = Date.now();
    const pointerType = e.pointerType || "mouse";
    const pointerId = e.pointerId;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragFromRef.current) {
        if (!shouldStartDrag({ pointerType, dx: ev.clientX - startX, dy: ev.clientY - startY, elapsedMs: Date.now() - t0 })) return;
        dragFromRef.current = path;
        setPressPath(null);
        setDragPath(path);
        document.body.classList.add("axv-lt-dragging");
      }
      ev.preventDefault();
      // 命中测试：取指针下最上层的图层行
      const els = document.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[];
      const rowEl = els.find((el) => el?.classList?.contains("axv-lt-row"));
      if (!rowEl) {
        if (dropRef.current) {
          dropRef.current = null;
          setDrop(null);
        }
      } else {
        const targetPath = rowEl.dataset.path || "";
        const r = rowEl.getBoundingClientRect();
        const isContainer = rowEl.dataset.container === "1";
        const z = canDropOn(path, targetPath) ? zoneAt(ev.clientY, r.top, r.height, isContainer) : null;
        if (z) {
          const next = { path: targetPath, zone: z };
          if (!dropRef.current || dropRef.current.path !== next.path || dropRef.current.zone !== next.zone) {
            dropRef.current = next;
            setDrop(next);
          }
        } else if (dropRef.current) {
          dropRef.current = null;
          setDrop(null);
        }
      }
      // 列表上下边缘自动滚动
      const list = listRef.current;
      if (list) {
        const lr = list.getBoundingClientRect();
        const d = autoScrollDelta(ev.clientY, lr.top, lr.bottom);
        if (d) list.scrollTop += d;
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const from = dragFromRef.current;
      const target = dropRef.current;
      if (from && target && onDragMove) onDragMove(from, target);
      endDrag();
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (dragFromRef.current) ev.preventDefault();
    };

    const onCancel = () => endDrag();

    cleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      setPressPath(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  };

  const isDescendant = (child: string, ancestor: string): boolean => {
    const a = ancestor.split("/");
    const c = child.split("/");
    if (c.length <= a.length) return false;
    return a.every((seg, i) => seg === c[i]);
  };

  /** 旧接口保留：供行高亮模板与外部复用（新拖拽走 lib/xml/layer-drag.ts） */
  const allowDrop = (targetPath: string): boolean => {
    if (!dragPath) return false;
    return canDropOn(dragPath, targetPath);
  };

  const renderItem = (n: XmlNode, depth: number, siblingCount: number) => {
    const kids = filter.active ? n.children.filter((c) => filter.keep.has(c.path)) : n.children;
    const open = (!collapsed.has(n.path) || filter.active) && kids.length > 0;
    const myIndex = Number(n.path.split("/").pop());
    const isRoot = n.path === "#0";
    const locked = lockedPaths?.has(n.path) ?? false;
    const isContainer = isContainerTag(n.tag);
    const zone = drop?.path === n.path ? drop.zone : null;
    const dragging = dragPath === n.path;

    const onDragOver = (_e: React.DragEvent<HTMLDivElement>) => {
      /* M31j：HTML5 拖拽已废弃（WebView 触摸不触发），改成 pointer；这里只吞掉原生拖拽事件 */
    };

    const onDropHere = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
    };

    return (
      <div key={n.path}>
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(n.path, el);
            else rowRefs.current.delete(n.path);
          }}
          className={
            "axv-lt-row" +
            (selectedPath === n.path ? " sel" : "") +
            (dragging ? " dragging" : "") +
            (zone === "inside" ? " drop-inside" : "") +
            (zone === "before" ? " drop-before" : "") +
            (zone === "after" ? " drop-after" : "") +
            (locked ? " locked" : "") +
            (filter.active && filter.hits.has(n.path) ? " hit" : "")
          }
          data-path={n.path}
          data-container={isContainer ? "1" : "0"}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(n.path)}
          onDragOver={onDragOver}
          onDrop={onDropHere}
        >
          {kids.length > 0 ? (
            <button
              className="axv-lt-toggle"
              aria-label={open ? "折叠" : "展开"}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.path);
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                {open ? "expand_more" : "chevron_right"}
              </span>
            </button>
          ) : (
            <span className="axv-lt-toggle" aria-hidden="true" />
          )}
          <span className="axv-lt-tag">{n.tag.split(".").pop()}</span>
          <span className="axv-lt-label">{label(n)}</span>
          <span className="axv-lt-actions">
            {onToggleLock ? (
              <button
                className={"axv-lt-lock" + (locked ? " on" : "")}
                title={locked ? "解除锁定" : "锁定组件（锁定后画布点不中、不能拖动）"}
                aria-label={locked ? "解锁" : "锁定"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(n.path);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                  {locked ? "lock" : "lock_open"}
                </span>
              </button>
            ) : null}
            <button title="删除" aria-label="删除" className="danger" disabled={isRoot} onClick={(e) => { e.stopPropagation(); onRemove(n.path); }}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>delete</span>
            </button>
          </span>
          {/* M35b：拖拽手柄放在最右，且**只在选中行显示**（未选中时占用位置但不可见/不可点），
              避免“点行→选中→展开的删除按钮就在手指下→抬手误删” */}
          {n.path !== "#0" ? (
            <button
              className={
                "axv-lt-handle" +
                (selectedPath === n.path ? " shown" : "") +
                (dragging ? " on" : "") +
                (pressPath === n.path ? " arming" : "") +
                (locked ? " off" : "")
              }
              title={locked ? "已锁定，不能拖动" : "按住拖动：调顺序 / 放进容器"}
              aria-label="拖动调整层级"
              disabled={locked}
              onPointerDown={(e) => {
                if (locked || selectedPath !== n.path) return;
                e.stopPropagation();
                beginPress(n.path, e, true);
              }}
              onClick={(e) => {
                // 手柄只负责拖拽，不触发选中
                e.stopPropagation();
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>
                drag_indicator
              </span>
            </button>
          ) : null}
        </div>
        {open && kids.map((c) => renderItem(c, depth + 1, kids.length))}
      </div>
    );
  };

  return (
    <div className="axv-lt" ref={listRef}>
      <div className="axv-lt-search">
        <input
          className="axv-lt-search-input"
          placeholder={`搜索 ${root.children.length} 个节点…`}
          aria-label="搜索图层"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q ? (
          <button
            type="button"
            className="axv-lt-search-clear"
            title="清空搜索"
            onClick={() => setQ("")}
          >
            ✕
          </button>
        ) : null}
      </div>
      {filter.active && filter.keep.size === 0 ? (
        <div className="axv-lt-empty">没有匹配「{q}」的节点</div>
      ) : (
        renderItem(root, 0, 1)
      )}
      {onDragMove ? (
        <div className="axv-lt-hint">
          {dragPath
            ? "松手完成移动：行上方/下方 = 换兄弟位置，容器中间 = 放进容器"
            : "选中一行后，按住行尾的 ⣿ 手柄拖动（手机长按 0.2 秒）：靠上/靠下 = 换兄弟位置，中间 = 放进容器"}
        </div>
      ) : null}
    </div>
  );
}
