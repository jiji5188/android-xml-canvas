// components/AddAttrModal.tsx — “添加属性”弹窗：搜索 + 分组选择
// 选中后回调 onPick(name)，由父组件把属性（带默认值）写进 XML。

"use client";

import { useMemo, useState } from "react";
import { ATTR_CATALOG, type AttrSpec } from "./attr-catalog";

const GROUP_ORDER: AttrSpec["group"][] = ["布局", "约束", "文本", "外观", "控件", "其他"];

interface Props {
  open: boolean;
  /** 节点已存在的属性名（弹窗里标记，避免重复添加） */
  existing: string[];
  /** 当前节点标签（简名），用于把该标签专属属性排前面 */
  tag?: string;
  onClose: () => void;
  onPick: (name: string) => void;
}

export function AddAttrModal({ open, existing, tag, onClose, onPick }: Props) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const exist = new Set(existing);
    const kw = q.trim().toLowerCase();
    // 排序：组序 → 未添加优先 → 本标签专属优先 → 搜索匹配度
    const list = ATTR_CATALOG.filter((s) => {
      if (kw) return s.name.toLowerCase().includes(kw) || (s.desc ?? "").toLowerCase().includes(kw);
      return true;
    }).sort((a, b) => {
      const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
      if (g !== 0) return g;
      const missA = exist.has(a.name) ? 1 : 0;
      const missB = exist.has(b.name) ? 1 : 0;
      if (missA !== missB) return missA - missB;
      const tagA = a.tags?.includes(tag ?? "") ? 0 : 1;
      const tagB = b.tags?.includes(tag ?? "") ? 0 : 1;
      if (tagA !== tagB) return tagA - tagB;
      if (kw) {
        const ia = a.name.toLowerCase().indexOf(kw);
        const ib = b.name.toLowerCase().indexOf(kw);
        if (ia !== ib) return ia - ib;
      }
      return a.name.localeCompare(b.name);
    });
    const map = new Map<AttrSpec["group"], AttrSpec[]>();
    for (const s of list) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return map;
  }, [q, existing, tag]);

  if (!open) return null;

  return (
    <div
      className="axv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-modal" role="dialog" aria-label="添加属性">
        <div className="axv-modal-head">
          <span>添加属性</span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <input
          className="axv-modal-search"
          placeholder="搜索属性名，如 margin / gravity / text…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="axv-modal-list">
          {[...groups.entries()].map(([g, list]) => (
            <div key={g}>
              <div className="axv-modal-group">{g}</div>
              {list.map((s) => {
                const added = existing.includes(s.name);
                return (
                  <button
                    key={s.name}
                    className={"axv-modal-item" + (added ? " axv-modal-item-added" : "")}
                    disabled={added}
                    title={s.desc}
                    onClick={() => {
                      onPick(s.name);
                      onClose();
                    }}
                  >
                    <span className="axv-modal-item-name">{s.name}</span>
                    {added ? (
                      <span className="axv-modal-item-tag">已存在</span>
                    ) : (
                      s.desc ? <span className="axv-modal-item-desc">{s.desc}</span> : null
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.size === 0 && <div className="axv-modal-empty">没有匹配的属性</div>}
        </div>
      </div>
    </div>
  );
}
