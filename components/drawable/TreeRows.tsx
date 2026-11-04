"use client";

// components/drawable/TreeRows.tsx — 面包屑 + 子节点列表 + 添加菜单（M121）
//
// 界面上不出现 "item"：layer-list 的子节点叫「第 N 层」，selector 的叫状态名，
// ripple 的叫「内容 / 遮罩」，inset 的叫「内容」。顺序的方向也带语义：
// layer-list 越靠后越靠上，selector 越靠前优先级越高 —— 这两个提示写在下拉提示里。

import { t as tt } from "@/lib/i18n-src";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import {
  addChild,
  breadcrumb,
  childAt,
  childCount,
  childLabelOf,
  moveChild,
  nodeAt,
  removeChild,
  type Path,
} from "@/lib/xml/drawable-edit";
import { nodeSummary } from "@/lib/xml/drawable-attrs";
import { childChoices } from "@/lib/xml/drawable-schema";

export function TreeRows({
  root,
  path,
  onSelect,
  onChange,
}: {
  root: DrawableNode;
  path: Path;
  onSelect: (p: Path) => void;
  onChange: (next: DrawableNode) => void;
}) {
  const node = nodeAt(root, path);
  if (!node) return null;

  const crumbs = breadcrumb(root, path);
  const n = childCount(node);
  const choices = childChoices(node);
  const children = Array.from({ length: n }, (_, i) => childAt(node, i)).filter(
    (c): c is DrawableNode => !!c,
  );

  const maxed =
    node.t === "ripple" ? n >= 2 : node.t === "inset" ? n >= 1 : false;

  return (
    <div className="axv-tree">
      <div className="axv-tree-crumbs">
        {crumbs.map((c, i) => (
          <span key={c.path.join("/") || "root"} className="axv-tree-crumb-wrap">
            {i > 0 ? <span className="axv-tree-sep">›</span> : null}
            <button
              type="button"
              className={
                "axv-tree-crumb" + (c.path.join("/") === path.join("/") ? " is-on" : "")
              }
              onClick={() => onSelect(c.path)}
            >
              {tt(c.label)}
            </button>
          </span>
        ))}
      </div>

      <div className="axv-layer-list">
        {children.map((child, i) => (
          <div key={`${path.join("/")}-${i}`} className="axv-layer-row">
            <button type="button" className="axv-layer-pick" onClick={() => onSelect([...path, i])}>
              <span className="axv-layer-idx">{i + 1}</span>
              <span className="axv-layer-name">{tt(childLabelOf(node, i))}</span>
              <span className="axv-layer-off">{nodeSummary(child)}</span>
            </button>
            <div className="axv-layer-ops">
              {node.t !== "ripple" && node.t !== "inset" ? (
                <>
                  <button
                    type="button"
                    className="axv-layer-op"
                    title={tt("上移")}
                    disabled={i === 0}
                    onClick={() => onChange(moveChild(root, path, i, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="axv-layer-op"
                    title={tt("下移")}
                    disabled={i === n - 1}
                    onClick={() => onChange(moveChild(root, path, i, 1))}
                  >
                    ↓
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="axv-layer-op is-danger"
                title={tt("删除")}
                onClick={() => onChange(removeChild(root, path, i))}
              >
                ×
              </button>
            </div>
          </div>
        ))}
        {n === 0 ? <div className="axv-shape-hint">{tt("里面还是空的")}</div> : null}
      </div>

      {node.t === "layer" || node.t === "selector" || node.t === "ripple" || node.t === "inset" ? (
        <div className="axv-tree-add">
          {maxed || choices.length === 0 ? (
            <div className="axv-shape-hint">
              {maxed ? tt("这个容器已经放满了") : tt("这个节点不能再加内容")}
            </div>
          ) : (
            <>
              <div className="axv-tree-add-label">
                {node.t === "layer"
                  ? tt("加一层（越靠后越在上）")
                  : node.t === "selector"
                    ? tt("加一个状态（越靠前优先级越高）")
                    : node.t === "ripple"
                      ? n === 0
                        ? tt("加内容")
                        : tt("加遮罩")
                      : tt("加内容")}
              </div>
              <div className="axv-tree-add-list">
                {choices.map((c) => (
                  <button
                    key={c.kind}
                    type="button"
                    className="axv-btn axv-ghost axv-tree-add-btn"
                    onClick={() => {
                      const res = addChild(root, path, c.make());
                      if (!res) return;
                      // 加完停在当前层：列表立刻多一行，看得见。想改新层再点它。
                      // （若自动钻进去，列表会变成“新层的子节点”，看起来像刚加的东西消失了）
                      onChange(res.root);
                    }}
                  >
                    ＋{tt(c.label)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="axv-shape-hint">{tt("叶子节点，不能再往里加内容")}</div>
      )}
    </div>
  );
}
