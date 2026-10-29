// components/WidgetPalette.tsx — 左侧滑面板「组件」页
// M14：两层分类——第一层按「库」（Android 平台 / AndroidX / Material），第二层按用途（布局/文本/输入/控件/进度/图片）
// 这样一眼能看出「这个控件要不要加依赖」，也不会把 Material 控件和平台控件混在一起。
"use client";

import { useMemo, useState } from "react";
import {
  WIDGETS,
  WIDGET_GROUPS,
  WIDGET_LIBS,
  GROUP_ICON,
  DRAG_WIDGET_MIME,
  type WidgetDef,
  type WidgetCat,
  type LibKind,
} from "./widget-catalog";

interface Props {
  /** 点击磁贴：把组件插到当前选中位置（没有选中就插根节点末尾） */
  onInsert: (w: WidgetDef) => void;
  /** 是否有已选中的画布节点（决定插入位置提示） */
  hasSelection: boolean;
}

interface CatNode {
  cat: WidgetCat;
  list: WidgetDef[];
}
interface LibNode {
  lib: LibKind;
  label: string;
  hint: string;
  icon: string;
  total: number;
  cats: CatNode[];
}

export function WidgetPalette({ onInsert, hasSelection }: Props) {
  const [q, setQ] = useState("");
  const [collapsedLib, setCollapsedLib] = useState<Record<string, boolean>>({});
  const [collapsedCat, setCollapsedCat] = useState<Record<string, boolean>>({});

  const kw = q.trim().toLowerCase();
  /** 搜索时强制展开，避免「搜到了却藏在折叠里」 */
  const searching = kw.length > 0;

  const tree = useMemo<LibNode[]>(() => {
    const match = (w: WidgetDef) =>
      !kw ||
      w.label.toLowerCase().includes(kw) ||
      w.tag.toLowerCase().includes(kw) ||
      w.key.toLowerCase().includes(kw);
    const byLib = new Map<LibKind, Map<WidgetCat, WidgetDef[]>>();
    for (const w of WIDGETS.filter(match)) {
      const cats = byLib.get(w.lib) ?? new Map<WidgetCat, WidgetDef[]>();
      const arr = cats.get(w.group) ?? [];
      arr.push(w);
      cats.set(w.group, arr);
      byLib.set(w.lib, cats);
    }
    return WIDGET_LIBS.filter((l) => byLib.has(l.lib)).map((l) => {
      const cats = byLib.get(l.lib)!;
      const list = WIDGET_GROUPS.filter((g) => cats.has(g)).map((g) => ({ cat: g, list: cats.get(g)! }));
      return { ...l, total: list.reduce((n, c) => n + c.list.length, 0), cats: list };
    });
  }, [kw]);

  const toggleLib = (k: string) => setCollapsedLib((c) => ({ ...c, [k]: !c[k] }));
  const toggleCat = (k: string) => setCollapsedCat((c) => ({ ...c, [k]: !c[k] }));

  return (
    <div className="axv-pp">
      <div className="axv-pp-search">
        <input
          placeholder="搜索控件名 / 类名"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索组件"
        />
      </div>
      <div className="axv-pp-scroll">
        {tree.length === 0 && <div className="axv-pp-empty">没有匹配的组件</div>}
        {tree.map((node) => {
          const libCollapsed = !searching && !!collapsedLib[node.lib];
          return (
            <div key={node.lib} className="axv-pp-lib">
              <button
                className="axv-pp-lib-head"
                aria-expanded={!libCollapsed}
                title={node.hint}
                onClick={() => toggleLib(node.lib)}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>
                  {node.icon}
                </span>
                <span className="axv-pp-lib-name">{node.label}</span>
                <span className="axv-pp-lib-count">{node.total}</span>
                <span className="msr axv-pp-caret" aria-hidden="true">
                  {libCollapsed ? "expand_more" : "expand_less"}
                </span>
              </button>
              {!libCollapsed &&
                node.cats.map(({ cat, list }) => {
                  const catKey = `${node.lib}/${cat}`;
                  const catCollapsed = !searching && !!collapsedCat[catKey];
                  return (
                    <div key={catKey} className="axv-pp-group">
                      <button
                        className="axv-pp-group-head"
                        aria-expanded={!catCollapsed}
                        onClick={() => toggleCat(catKey)}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
                          {GROUP_ICON[cat]}
                        </span>
                        <span>{cat}</span>
                        <span className="axv-pp-cat-count">{list.length}</span>
                        <span className="msr axv-pp-caret" aria-hidden="true">
                          {catCollapsed ? "expand_more" : "expand_less"}
                        </span>
                      </button>
                      {!catCollapsed && (
                        <div className="axv-pp-grid">
                          {list.map((w) => (
                            <button
                              key={w.key}
                              type="button"
                              className="axv-pp-tile"
                              title={`${w.label}（${w.tag}）· 点击插入 / 拖到画布`}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(DRAG_WIDGET_MIME, w.key);
                                e.dataTransfer.effectAllowed = "copy";
                              }}
                              onClick={() => onInsert(w)}
                            >
                              <span
                                className="msr"
                                aria-hidden="true"
                                style={{ fontSize: 26, color: "var(--axv-primary)" }}
                              >
                                {w.icon}
                              </span>
                              <span className="axv-pp-tile-label">{w.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
