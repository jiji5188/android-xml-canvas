// components/ConstraintPanel.tsx — ConstraintLayout 子控件的约束编辑器（一期：表单 + 自动约束）
// 不画连线，全部用下拉建立约束：目标（父容器 / 兄弟控件）+ 对齐方式 + 边距。

"use client";

import { useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";

export interface SibOption {
  /** XML 原样引用：@+id/xxx */
  ref: string;
  label: string;
}

interface Props {
  node: ResolvedNode;
  siblings: SibOption[];
  /** 批量提交：[属性名, 值]，值为 null 表示删除 */
  onCommitMany: (changes: [string, string | null][]) => void;
  /** 自动推断约束 */
  onAuto: () => void;
  /** 清空所有约束 */
  onClear: () => void;
  /** 上一次自动约束的说明（可选） */
  autoNotes?: string[];
}

type Side = "Start" | "End" | "Top" | "Bottom";

const SIDES: { side: Side; title: string; marginAttr: string; variants: { mode: string; label: string }[] }[] = [
  { side: "Start", title: "左边（start）", marginAttr: "layout_marginStart", variants: [{ mode: "toStartOf", label: "左对齐" }, { mode: "toEndOf", label: "接在右缘" }] },
  { side: "End", title: "右边（end）", marginAttr: "layout_marginEnd", variants: [{ mode: "toEndOf", label: "右对齐" }, { mode: "toStartOf", label: "接在左缘" }] },
  { side: "Top", title: "顶部（top）", marginAttr: "layout_marginTop", variants: [{ mode: "toTopOf", label: "顶部对齐" }, { mode: "toBottomOf", label: "接在下缘" }] },
  { side: "Bottom", title: "底部（bottom）", marginAttr: "layout_marginBottom", variants: [{ mode: "toBottomOf", label: "底部对齐" }, { mode: "toTopOf", label: "接在上缘" }] },
];

const attrName = (side: Side, mode: string) => `layout_constraint${side}_${mode}`;

/** 读某一侧当前的「对齐方式」（无约束返回 null） */
function readSide(attrs: Record<string, string>, s: (typeof SIDES)[number]): string | null {
  for (const v of s.variants) {
    if (attrs[attrName(s.side, v.mode)] !== undefined) return v.mode;
  }
  return null;
}

const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);
const refLabel = (ref: string) => ref.replace(/^@\+?id\//, "");

export function ConstraintPanel({ node, siblings, onCommitMany, onAuto, onClear, autoNotes }: Props) {
  const attrs = node.rawAttrs;
  const [marginDraft, setMarginDraft] = useState<Record<string, string>>({});

  const hasStart = readSide(attrs, SIDES[0]) !== null;
  const hasEnd = readSide(attrs, SIDES[1]) !== null;
  const hasTop = readSide(attrs, SIDES[2]) !== null;
  const hasBottom = readSide(attrs, SIDES[3]) !== null;
  const constraintCount = [hasStart, hasEnd, hasTop, hasBottom].filter(Boolean).length;

  const biasH = attrs.layout_constraintHorizontal_bias;
  const biasV = attrs.layout_constraintVertical_bias;

  /** 切换某一侧的目标：选了目标就按当前（或默认）对齐方式写一条约束 */
  const setTarget = (s: (typeof SIDES)[number], ref: string) => {
    const curMode = readSide(attrs, s);
    const mode = curMode ?? s.variants[0].mode;
    const changes: [string, string | null][] = [];
    for (const v of s.variants) {
      const name = attrName(s.side, v.mode);
      if (v.mode === mode && ref) changes.push([name, ref]);
      else changes.push([name, null]);
    }
    onCommitMany(changes);
  };

  const setMode = (s: (typeof SIDES)[number], mode: string) => {
    const curMode = readSide(attrs, s);
    if (!curMode) return;
    const target = attrs[attrName(s.side, curMode)];
    if (!target) return;
    const changes: [string, string | null][] = [];
    for (const v of s.variants) {
      const name = attrName(s.side, v.mode);
      if (v.mode === mode) changes.push([name, target]);
      else changes.push([name, null]);
    }
    onCommitMany(changes);
  };

  const commitMargin = (name: string) => {
    const v = marginDraft[name];
    if (v === undefined) return;
    const cleaned = v.trim();
    onCommitMany([[name, cleaned === "" ? null : /^\d+$/.test(cleaned) ? `${cleaned}dp` : cleaned]]);
    setMarginDraft((d) => {
      const n = { ...d };
      delete n[name];
      return n;
    });
  };

  const setBias = (name: string, pct: number) => {
    onCommitMany([[name, (pct / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")]]);
  };

  return (
    <div className="axv-constraint">
      <div className="axv-constraint-head">
        <span>约束布局</span>
        <span className="axv-constraint-count">{constraintCount} / 4 边</span>
      </div>

      {SIDES.map((s) => {
        const mode = readSide(attrs, s);
        const target = mode ? attrs[attrName(s.side, mode)] ?? "" : "";
        const marginVal = attrs[s.marginAttr] ?? "";
        return (
          <div className="axv-constraint-side" key={s.side}>
            <div className="axv-constraint-row">
              <label className="axv-attr-name">{s.title}</label>
              <div className="axv-constraint-ctl">
                <select
                  className="axv-attr-select"
                  value={target}
                  onChange={(e) => setTarget(s, e.target.value)}
                  aria-label={`${s.title} 约束目标`}
                >
                  <option value="">无约束</option>
                  <option value="parent">父容器</option>
                  {siblings.map((o) => (
                    <option key={o.ref} value={o.ref}>{o.label}</option>
                  ))}
                </select>
                {mode && (
                  <select
                    className="axv-attr-select"
                    value={mode}
                    onChange={(e) => setMode(s, e.target.value)}
                    aria-label={`${s.title} 对齐方式`}
                  >
                    {s.variants.map((v) => (
                      <option key={v.mode} value={v.mode}>{v.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            {mode && (
              <div className="axv-constraint-row axv-constraint-sub">
                <label className="axv-attr-name">边距</label>
                <input
                  className="axv-attr-input"
                  inputMode="numeric"
                  placeholder="0"
                  value={marginDraft[s.marginAttr] ?? marginVal}
                  onChange={(e) => setMarginDraft((d) => ({ ...d, [s.marginAttr]: e.target.value }))}
                  onBlur={() => commitMargin(s.marginAttr)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  aria-label={`${s.title} 边距`}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* 两端都约束时才有意义 → 显示居中比例 */}
      {(hasStart && hasEnd) || (hasTop && hasBottom) ? (
        <div className="axv-constraint-bias">
          {hasStart && hasEnd && (
            <label className="axv-bias-row">
              <span>水平位置</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(parseFloat(biasH ?? "0.5") * 100)}
                onChange={(e) => setBias("layout_constraintHorizontal_bias", Number(e.target.value))}
              />
              <span className="axv-bias-val">{Math.round(parseFloat(biasH ?? "0.5") * 100)}%</span>
            </label>
          )}
          {hasTop && hasBottom && (
            <label className="axv-bias-row">
              <span>垂直位置</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(parseFloat(biasV ?? "0.5") * 100)}
                onChange={(e) => setBias("layout_constraintVertical_bias", Number(e.target.value))}
              />
              <span className="axv-bias-val">{Math.round(parseFloat(biasV ?? "0.5") * 100)}%</span>
            </label>
          )}
        </div>
      ) : null}

      <div className="axv-constraint-actions">
        <button className="axv-constraint-btn" onClick={onAuto} title="根据当前位置就近推断约束">
          自动约束
        </button>
        <button className="axv-constraint-btn axv-ghost" onClick={onClear} title="删除该控件的全部约束">
          清除约束
        </button>
      </div>

      {autoNotes && autoNotes.length > 0 && (
        <ul className="axv-constraint-notes">
          {autoNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <div className="axv-constraint-hint">
        目标控件需要 id 才能被约束；父容器是 {shortTag(node.tag) === "ConstraintLayout" ? "ConstraintLayout" : "ConstraintLayout"} 时生效。
        {siblings.length === 0 ? "（同级暂无带 id 的控件）" : ""}
        当前选中：{node.rawAttrs.id ? refLabel(node.rawAttrs.id) : "无 id（自动约束会先补 id）"}
      </div>
    </div>
  );
}
