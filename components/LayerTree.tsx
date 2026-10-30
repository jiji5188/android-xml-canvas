// components/LayerTree.tsx — 左侧滑面板「图层」页
// 当前屏幕的节点树，支持：展开/折叠、选中、上下移、删除、锁定（M20m）。
//
// M3d：拖拽排序（对标 Android Studio 的 Component Tree）
//  - 拖到某行的**上 1/4**  → 成为该节点的上一个兄弟（移到兄弟层）
//  - 拖到某行的**下 1/4**  → 成为该节点的下一个兄弟（移到兄弟层）
//  - 拖到某行的**中间 1/2** 且目标是容器 → 成为它的最后一个子项（移到子组件层）
//  三种落点分别显示蓝线 / 蓝线 / 高亮框，一眼能看出会掉到哪一层。

"use client";

import { useState } from "react";
import type { XmlNode } from "../lib/xml/types";
import { isContainerTag } from "../lib/xml/insert";

/** 拖拽落点位置 */
export type DropZone = "before" | "inside" | "after";

export interface DropTarget {
  path: string;
  zone: DropZone;
}

interface Props {
  root: XmlNode | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** 把 targetPath 挪到 toIndex（父级兄弟位置） */
  onMove: (targetPath: string, toIndex: number) => void;
  /** 删除节点 */
  onRemove: (path: string) => void;
  /** 把 fromPath 拖到目标位置（M3d）；不传则禁用拖拽 */
  onDragMove?: (fromPath: string, target: DropTarget) => void;
  /** M20m：被锁定的节点路径（锁定后不能拖动/上下移/画布选中） */
  lockedPaths?: Set<string>;
  /** M20m：切换某个节点的锁定状态 */
  onToggleLock?: (path: string) => void;
}

const DRAG_MIME = "application/x-axv-layer";

export function LayerTree({ root, selectedPath, onSelect, onMove, onRemove, onDragMove, lockedPaths, onToggleLock }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

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

  /** 光标在行内的相对位置 → 落点 */
  const zoneOf = (e: React.DragEvent<HTMLDivElement>, isContainer: boolean): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (!isContainer) return y < 0.5 ? "before" : "after";
    if (y < 0.25) return "before";
    if (y > 0.75) return "after";
    return "inside";
  };

  const isDescendant = (child: string, ancestor: string): boolean => {
    const a = ancestor.split("/");
    const c = child.split("/");
    if (c.length <= a.length) return false;
    return a.every((seg, i) => seg === c[i]);
  };

  const allowDrop = (targetPath: string): boolean => {
    if (!dragPath) return false;
    if (dragPath === targetPath) return false;
    // 不能拖进自己内部
    if (isDescendant(targetPath, dragPath)) return false;
    return true;
  };

  const renderItem = (n: XmlNode, depth: number, siblingCount: number) => {
    const kids = n.children;
    const open = !collapsed.has(n.path) && kids.length > 0;
    const myIndex = Number(n.path.split("/").pop());
    const isRoot = n.path === "#0";
    const locked = lockedPaths?.has(n.path) ?? false;
    const isContainer = isContainerTag(n.tag);
    const zone = drop?.path === n.path ? drop.zone : null;
    const dragging = dragPath === n.path;

    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      if (!onDragMove || !allowDrop(n.path)) return;
      e.preventDefault();
      e.stopPropagation();
      const z = zoneOf(e, isContainer && !isRoot);
      e.dataTransfer.dropEffect = "move";
      if (!drop || drop.path !== n.path || drop.zone !== z) setDrop({ path: n.path, zone: z });
    };

    const onDropHere = (e: React.DragEvent<HTMLDivElement>) => {
      if (!onDragMove) return;
      e.preventDefault();
      e.stopPropagation();
      const from = e.dataTransfer.getData(DRAG_MIME) || dragPath;
      const z = zone ?? "after";
      setDrop(null);
      setDragPath(null);
      if (!from || from === n.path) return;
      onDragMove(from, { path: n.path, zone: z });
    };

    return (
      <div key={n.path}>
        <div
          className={
            "axv-lt-row" +
            (selectedPath === n.path ? " sel" : "") +
            (dragging ? " dragging" : "") +
            (zone === "inside" ? " drop-inside" : "") +
            (zone === "before" ? " drop-before" : "") +
            (zone === "after" ? " drop-after" : "") +
            (locked ? " locked" : "")
          }
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(n.path)}
          draggable={!!onDragMove && !isRoot && !locked}
          onDragStart={(e) => {
            if (!onDragMove || isRoot || locked) return;
            e.stopPropagation();
            e.dataTransfer.setData(DRAG_MIME, n.path);
            e.dataTransfer.effectAllowed = "move";
            setDragPath(n.path);
          }}
          onDragEnd={() => {
            setDragPath(null);
            setDrop(null);
          }}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            if (drop?.path === n.path) setDrop(null);
          }}
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
            <button title="上移一层" aria-label="上移" disabled={isRoot || locked || myIndex <= 0} onClick={(e) => { e.stopPropagation(); onMove(n.path, myIndex - 1); }}>↑</button>
            <button title="下移一层" aria-label="下移" disabled={isRoot || locked || myIndex >= siblingCount - 1} onClick={(e) => { e.stopPropagation(); onMove(n.path, myIndex + 1); }}>↓</button>
            <button title="删除" aria-label="删除" className="danger" disabled={isRoot} onClick={(e) => { e.stopPropagation(); onRemove(n.path); }}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>delete</span>
            </button>
          </span>
        </div>
        {open && kids.map((c) => renderItem(c, depth + 1, kids.length))}
      </div>
    );
  };

  return (
    <div className="axv-lt">
      {onDragMove ? (
        <div className="axv-lt-hint">拖动可调整层级：靠上/靠下 = 换兄弟位置，中间 = 放进容器</div>
      ) : null}
      {renderItem(root, 0, 1)}
    </div>
  );
}
