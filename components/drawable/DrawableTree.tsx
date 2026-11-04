"use client";

// components/drawable/DrawableTree.tsx — drawable 结构树（M124）
//
// 为什么改成树：原来是「面包屑 + 只显示当前层的子节点」，进深一层就看不到全貌，
// 想在兄弟层之间调顺序得来回跳。现在和左侧「图层」面板用同一套树形展示：
// 缩进 + 折叠 + 选中行操作，一屏看完整个 drawable 的组合关系。
//
// 界面上不出现 <item>：它就是父容器的一个插槽，行标题直接用语义
// （第 1 层 / 按下 / 兜底 / 内容 / 遮罩）+ 这一格放的是什么。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { childChoices } from "@/lib/xml/drawable-schema";
import { nodeSummary } from "@/lib/xml/drawable-attrs";
import {
  addChild,
  childAt,
  childCount,
  insertChild,
  moveChild,
  removeChild,
  slotLabelOf,
  type Path,
} from "@/lib/xml/drawable-edit";

const ICON: Record<string, string> = {
  shape: "square",
  color: "palette",
  ref: "link",
  layer: "layers",
  selector: "rule",
  ripple: "water_drop",
  unsupported: "help",
};

const TRANSFORM_ICON: Record<string, string> = {
  inset: "crop_free",
  clip: "crop",
  scale: "aspect_ratio",
  rotate: "rotate_right",
  "animated-rotate": "rotate_right",
};

const TRANSFORM_LABEL: Record<string, string> = {
  inset: "内缩",
  clip: "裁剪",
  scale: "缩放",
  rotate: "旋转",
  "animated-rotate": "动画旋转",
};

/** 节点自身名字（不是子节点行标题） */
export function nodeTitle(n: DrawableNode): string {
  switch (n.t) {
    case "shape": {
      const k = n.spec.kind;
      return k === "rectangle"
        ? tt("形状 · 矩形")
        : k === "oval"
          ? tt("形状 · 椭圆")
          : k === "ring"
            ? tt("形状 · 环形")
            : tt("形状 · 线条");
    }
    case "color":
      return tt("纯色 {color}", { color: n.color });
    case "ref":
      return tt("引用 {name}", { name: n.name || "…" });
    case "layer":
      return tt("图层叠加");
    case "selector":
      return tt("状态选择");
    case "ripple":
      return tt("水波纹");
    default:
      return n.tag || tt("未支持");
  }
}

function isContainerNode(n: DrawableNode): boolean {
  return n.t === "layer" || n.t === "selector" || n.t === "ripple";
}

function canAddTo(n: DrawableNode): boolean {
  return n.t === "layer" || n.t === "selector" || n.t === "ripple";
}

/** M127：变换链的摘要（树行右侧小字："内缩 + 旋转"） */
function transformSummary(n: DrawableNode): string | null {
  const chain = (n as { transform?: { kind: string }[] }).transform;
  if (!chain?.length) return null;
  return chain.map((t) => TRANSFORM_LABEL[t.kind] ?? t.kind).join(" + ");
}

export function DrawableTree({
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
  /** M125：默认只展开顶层（根），更深的先折叠，避免手机上内容满屏 */
  const [opened, setOpened] = useState<Set<string>>(() => new Set([""]));
  /** 哪一行弹着「加组件」菜单 */
  const [addAt, setAddAt] = useState<string | null>(null);
  /** M133：哪一行弹着「插入同级」菜单（key = 父路径:序号） */
  const [insertAt, setInsertAt] = useState<string | null>(null);
  /** 插入方向：上方 / 下方 */
  const [insertAbove, setInsertAbove] = useState(false);

  const toggle = (key: string) => {
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isCollapsed = (key: string) => !opened.has(key);

  const samePath = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);
  const closeAdd = () => {
    if (addAt) setAddAt(null);
  };

  const addMenu = (node: DrawableNode, here: Path, depth: number) => (
    <div className="axv-dt-add" style={{ marginLeft: 24 + depth * 8 }}>
      <div className="axv-dt-add-title">{tt("往「{name}」里加", { name: nodeTitle(node) })}</div>
      <div className="axv-dt-add-list">
        {childChoices(node).map((c) => (
          <button
            key={c.kind}
            type="button"
            className="axv-dt-add-item"
            aria-label={tt(c.label)}
            title={tt(c.label)}
            onClick={() => {
              const res = addChild(root, here, c.make());
              if (!res) return;
              onChange(res.root);
              setAddAt(null);
              // 加完停在原处：新行就在下面，不自动钻进去（钻进去会像“加的东西没了”）
            }}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
              {ICON[c.kind] ?? "add"}
            </span>
            <span>{tt(c.label)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  /** M133：同级插入菜单（选 A：先选中某行，再往上/下插） */
  const insertMenu = (
    parent: DrawableNode,
    parentPath: Path,
    index: number,
    depth: number,
  ) => {
    const at = insertAbove ? index : index + 1;
    const slot = slotLabelOf(parent, index);
    return (
      <div className="axv-dt-add" style={{ marginLeft: 24 + depth * 8 }}>
        <div className="axv-dt-add-title">
          {insertAbove
            ? tt("插到「{name}」上方", { name: tt(slot) })
            : tt("插到「{name}」下方", { name: tt(slot) })}
        </div>
        <div className="axv-dt-add-dir">
          <button
            type="button"
            className={"axv-dt-dir-btn" + (insertAbove ? " is-on" : "")}
            onClick={() => setInsertAbove(true)}
          >
            {tt("上方")}
          </button>
          <button
            type="button"
            className={"axv-dt-dir-btn" + (insertAbove ? "" : " is-on")}
            onClick={() => setInsertAbove(false)}
          >
            {tt("下方")}
          </button>
        </div>
        <div className="axv-dt-add-list">
          {childChoices(parent).map((c) => (
            <button
              key={c.kind}
              type="button"
              className="axv-dt-add-item"
              aria-label={tt(c.label)}
              title={tt(c.label)}
              onClick={() => {
                const res = insertChild(root, parentPath, at, c.make());
                if (!res) return;
                onChange(res.root);
                onSelect(res.path);
                setInsertAt(null);
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                {ICON[c.kind] ?? "add"}
              </span>
              <span>{tt(c.label)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderNode = (
    node: DrawableNode,
    here: Path,
    depth: number,
    slotLabel?: string,
    sibOps?: React.ReactNode,
    afterRow?: React.ReactNode,
  ): React.ReactNode => {
    const kids = childCount(node);
    const key = here.join("/");
    const isRoot = here.length === 0;
    const selected = samePath(path, here);
    const open = kids > 0 && !isCollapsed(key);
    const tsum = transformSummary(node);

    return (
      <div key={key}>
        <div
          className={"axv-dt-row" + (selected ? " sel" : "")}
          style={{ paddingLeft: 8 + depth * 8 }}
          onClick={() => {
            onSelect(here);
            closeAdd();
            setInsertAt(null);
          }}
          data-path={key}
        >
          {kids > 0 ? (
            <button
              className="axv-dt-chev"
              aria-label={open ? tt("折叠") : tt("展开")}
              onClick={(e) => {
                e.stopPropagation();
                toggle(key);
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                {open ? "expand_more" : "chevron_right"}
              </span>
            </button>
          ) : (
            <span className="axv-dt-chev" aria-hidden="true" />
          )}

          <span className="msr axv-dt-icon" aria-hidden="true" style={{ fontSize: 16 }}>
            {ICON[node.t] ?? "help"}
          </span>

          {slotLabel ? <span className="axv-dt-slot-tag">{slotLabel}</span> : null}
          <span className="axv-dt-name">{nodeTitle(node)}</span>
          <span className="axv-dt-summary">
            {tsum ? <span className="axv-dt-transform">{tsum}</span> : null}
            {nodeSummary(node)}
          </span>

          <span className="axv-dt-ops">
            {isContainerNode(node) && canAddTo(node) ? (
              <button
                className={"axv-dt-op" + (addAt === key ? " is-on" : "")}
                title={tt("加组件")}
                aria-label={tt("加组件")}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(here);
                  setAddAt((v) => (v === key ? null : key));
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>add</span>
              </button>
            ) : null}

            {sibOps}

            {isRoot ? null : (
              <button
                className="axv-dt-op danger"
                title={tt("删除")}
                aria-label={tt("删除")}
                onClick={(e) => {
                  e.stopPropagation();
                  const parent = here.slice(0, -1);
                  onChange(removeChild(root, parent, here[here.length - 1]));
                  onSelect(parent);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>delete</span>
              </button>
            )}
          </span>
        </div>

        {addAt === key ? addMenu(node, here, depth) : null}
        {afterRow}

        {open
          ? Array.from({ length: kids }).map((_, i) => {
              const child = childAt(node, i);
              if (!child) return null;
              const canReorder = node.t === "layer" || node.t === "selector";
              const insKey = `${here.join("/")}#${i}`;
              const sib = canReorder ? (
                <>
                  <button
                    className={"axv-dt-op" + (insertAt === insKey ? " is-on" : "")}
                    title={tt("在这一行上方/下方插入")}
                    aria-label={tt("插入同级")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect([...here, i]);
                      setAddAt(null);
                      setInsertAt((v) => (v === insKey ? null : insKey));
                    }}
                  >
                    <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                      playlist_add
                    </span>
                  </button>
                  <button
                    className="axv-dt-op"
                    disabled={i === 0}
                    title={tt("上移")}
                    aria-label={tt("上移")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(moveChild(root, here, i, -1));
                      onSelect([...here, i - 1]);
                    }}
                  >
                    <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>arrow_upward</span>
                  </button>
                  <button
                    className="axv-dt-op"
                    disabled={i === kids - 1}
                    title={tt("下移")}
                    aria-label={tt("下移")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(moveChild(root, here, i, 1));
                      onSelect([...here, i + 1]);
                    }}
                  >
                    <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>arrow_downward</span>
                  </button>
                </>
              ) : null;
              return renderNode(
                child,
                [...here, i],
                depth + 1,
                slotLabelOf(node, i),
                sib,
                insertAt === insKey ? insertMenu(node, here, i, depth + 1) : null,
              );
            })
          : null}
      </div>
    );
  };

  return <div className="axv-dt">{renderNode(root, [], 0)}</div>;
}
