// components/LayerTree.tsx — 左侧滑面板「图层」页
// 当前屏幕的节点树，支持：展开/折叠、选中、上移/下移兄弟（层次调整）、删除。

"use client";

import { useState } from "react";
import type { XmlNode } from "../lib/xml/types";

interface Props {
  root: XmlNode | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** 把 targetPath 挪到 toIndex（父级兄弟位置） */
  onMove: (targetPath: string, toIndex: number) => void;
  /** 删除节点 */
  onRemove: (path: string) => void;
}

export function LayerTree({ root, selectedPath, onSelect, onMove, onRemove }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  const renderItem = (n: XmlNode, depth: number, siblingCount: number) => {
    const kids = n.children;
    const open = !collapsed.has(n.path) && kids.length > 0;
    /** 同一父级下的兄弟中我排第几（从 path 末段取） */
    const myIndex = Number(n.path.split("/").pop());
    return (
      <div key={n.path}>
        <div
          className={`axv-lt-row${selectedPath === n.path ? " sel" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(n.path)}
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
          <span className="axv-lt-tag">{n.tag}</span>
          <span className="axv-lt-label">{label(n)}</span>
          <span className="axv-lt-actions">
            <button title="上移一层" aria-label="上移" disabled={myIndex <= 0} onClick={(e) => { e.stopPropagation(); onMove(n.path, myIndex - 1); }}>↑</button>
            <button title="下移一层" aria-label="下移" disabled={myIndex >= siblingCount - 1} onClick={(e) => { e.stopPropagation(); onMove(n.path, myIndex + 1); }}>↓</button>
            <button title="置顶（画在最上层）" aria-label="置顶" disabled={myIndex <= 0} onClick={(e) => { e.stopPropagation(); onMove(n.path, 0); }}>⤒</button>
            <button title="置底（画在最下层）" aria-label="置底" disabled={myIndex >= siblingCount - 1} onClick={(e) => { e.stopPropagation(); onMove(n.path, siblingCount); }}>⤓</button>
            <button title="删除" aria-label="删除" className="danger" onClick={(e) => { e.stopPropagation(); onRemove(n.path); }}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>delete</span>
            </button>
          </span>
        </div>
        {open && kids.map((c) => renderItem(c, depth + 1, kids.length))}
      </div>
    );
  };

  return <div className="axv-lt">{renderItem(root, 0, 1)}</div>;
}
