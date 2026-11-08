// components/InspectorTab.tsx — M186：右侧面板「检查器」tab
// 层级树（可展开、点击反查画布）/ 选中节点实测尺寸 / 溢出警告（点击跳代码行）
// 纯展示组件：数据由 XmlEditor 算好传进来（lib/xml/inspector.ts 的纯函数 + DOM 采样）。

"use client";

import { useEffect, useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { InspectorWarning, MeasuredNode, InspectableNode } from "@/lib/xml/inspector";
import { flattenTree, fmtDp } from "@/lib/xml/inspector";

export interface InspectorTabProps {
  tree: InspectableNode | null;
  measured: MeasuredNode[];
  selectedPath: string | null;
  warnings: InspectorWarning[];
  onSelectPath: (path: string) => void;
  /** 警告里的行号跳代码（可选，没有就不跳） */
  onGotoLine?: (line: number) => void;
}

export function InspectorTab({
  tree,
  measured,
  selectedPath,
  warnings,
  onSelectPath,
  onGotoLine,
}: InspectorTabProps) {
  /** 展开的行集合（默认展开前两层） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 首次有树时默认展开根 + 第一层 */
  useEffect(() => {
    if (!tree) return;
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      const s = new Set<string>([tree.path]);
      for (const c of tree.children) s.add(c.path);
      return s;
    });
  }, [tree]);

  const rows = useMemo(
    () => (tree ? flattenTree(tree, expanded) : []),
    [tree, expanded],
  );

  const short = (tag: string) => {
    const i = tag.indexOf(".");
    return i >= 0 ? tag.slice(i + 1) : tag;
  };

  const sel: MeasuredNode | null = measured.find((m) => m.path === selectedPath) ?? null;
  /** 选中节点在树里的实体（确认存在用） */
  const selNode: InspectableNode | null = useMemo(() => {
    if (!tree || !selectedPath) return null;
    let out: InspectableNode | null = null;
    const walk = (n: InspectableNode) => {
      if (n.path === selectedPath) { out = n; return; }
      for (const c of n.children) walk(c);
    };
    walk(tree);
    return out;
  }, [tree, selectedPath]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(path)) s.delete(path);
      else s.add(path);
      return s;
    });
  };

  if (!tree) {
    return (
      <div className="axv-inp-empty">{tt("没有可检查的布局（当前不是有效的 XML）")}</div>
    );
  }

  return (
    <div className="axv-inp">
      {/* 选中节点实测尺寸 */}
      {selNode && sel ? (
        <section className="axv-inp-sec">
          <h4 className="axv-inp-h">{tt("实测尺寸")} · {short(sel.tag)}</h4>
          <div className="axv-inp-metrics">
            <span className="axv-inp-m" title={tt("宽度")}>
              W {fmtDp(sel.w)}dp
            </span>
            <span className="axv-inp-m" title={tt("高度")}>
              H {fmtDp(sel.h)}dp
            </span>
            <span className="axv-inp-m" title={tt("相对画布左上角的位置")}>
              X {fmtDp(sel.x)} / Y {fmtDp(sel.y)}
            </span>
          </div>
          <p className="axv-inp-note">{tt("画布 1dp = 2px，数字为换算后的 dp 值（与设备真实像素无关）")}</p>
        </section>
      ) : null}

      {/* 溢出 / 零尺寸警告 */}
      {warnings.length > 0 ? (
        <section className="axv-inp-sec">
          <h4 className="axv-inp-h axv-inp-h-warn">{tt("警告")} · {warnings.length}</h4>
          <ul className="axv-inp-warns">
            {warnings.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="axv-inp-warn"
                  title={tt("点击选中该控件")}
                  onClick={() => onSelectPath(w.path)}
                >
                  <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                    {w.kind === "overflow" ? "warning" : "crop"}
                  </span>
                  {w.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 层级树 */}
      <section className="axv-inp-sec">
        <h4 className="axv-inp-h">{tt("层级")}</h4>
        {rows.length === 0 ? (
          <div className="axv-inp-empty">{tt("树为空")}</div>
        ) : (
          <div className="axv-inp-tree" role="tree">
            {rows.map((r) => (
              <div
                key={r.path}
                className={
                  "axv-inp-row" +
                  (selectedPath === r.path ? " is-sel" : "") +
                  (r.expanded ? " is-open" : "")
                }
                style={{ paddingLeft: 8 + r.depth * 14 }}
                role="treeitem"
                aria-selected={selectedPath === r.path}
              >
                <button
                  type="button"
                  className="axv-inp-tw"
                  title={r.expanded ? tt("收起") : tt("展开")}
                  onClick={() => toggle(r.path)}
                  aria-expanded={r.expanded}
                >
                  <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                    {r.expanded ? "expand_more" : "chevron_right"}
                  </span>
                </button>
                <button
                  type="button"
                  className="axv-inp-node"
                  title={r.id ? `${r.id} · ${tt("点击选中")}` : tt("点击选中")}
                  onClick={() => onSelectPath(r.path)}
                >
                  {short(r.tag)}
                  {r.id ? <span className="axv-inp-id">{r.id}</span> : null}
                </button>
                {sel?.path === r.path ? (
                  <span className="axv-inp-size">
                    {fmtDp(sel.w)}×{fmtDp(sel.h)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
