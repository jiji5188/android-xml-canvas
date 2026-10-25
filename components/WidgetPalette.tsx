// components/WidgetPalette.tsx — 左侧滑面板「组件」页（M3E 风格浅色系）
// 搜索框 + 分组折叠 + 磁贴（点击插入 / 拖到画布指定位置）。

"use client";

import { useMemo, useState } from "react";
import { WIDGETS, WIDGET_GROUPS, GROUP_ICON, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";

interface Props {
  /** 点击磁贴：把组件插到当前选中位置（没有选中就插根节点末尾） */
  onInsert: (w: WidgetDef) => void;
  /** 是否有已选中的画布节点（决定插入位置提示） */
  hasSelection: boolean;
}

export function WidgetPalette({ onInsert, hasSelection }: Props) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const match = (w: WidgetDef) =>
      !kw || w.label.toLowerCase().includes(kw) || w.tag.toLowerCase().includes(kw) || w.key.toLowerCase().includes(kw);
    const map = new Map<WidgetDef["group"], WidgetDef[]>();
    for (const w of WIDGETS.filter(match)) {
      const arr = map.get(w.group) ?? [];
      arr.push(w);
      map.set(w.group, arr);
    }
    return WIDGET_GROUPS.filter((g) => map.has(g)).map((g) => ({ group: g, list: map.get(g)! }));
  }, [q]);

  return (
    <div className="axv-pp">
      <div className="axv-pp-search">
        <input
          placeholder="搜索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索组件"
        />
      </div>
      <div className="axv-pp-scroll">
        {groups.length === 0 && <div className="axv-pp-empty">没有匹配的组件</div>}
        {groups.map(({ group, list }) => {
          const isCollapsed = collapsed[group];
          return (
            <div key={group} className="axv-pp-group">
              <button
                className="axv-pp-group-head"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>{GROUP_ICON[group]}</span>
                <span>{group}</span>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18, marginLeft: "auto" }}>
                  {isCollapsed ? "expand_more" : "expand_less"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="axv-pp-grid">
                  {list.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className="axv-pp-tile"
                      title={`${w.label}（点击插入 / 拖到画布）`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_WIDGET_MIME, w.key);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onInsert(w)}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 26, color: "#04409F" }}>{w.icon}</span>
                      <span className="axv-pp-tile-label">{w.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="axv-pp-foot">
        {hasSelection ? "点磁贴插入到选中控件（同级或子级）" : "点磁贴插入到当前屏幕根节点"}
      </div>
    </div>
  );
}
