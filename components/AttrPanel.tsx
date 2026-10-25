// components/AttrPanel.tsx — 右侧滑面板：选中节点的属性编辑器
// 已知枚举属性 → 下拉选择；其余 → 输入框（失焦/Enter 提交）。
// 每次提交通过 onCommit / onRemove 回写 XML（writebackAttrs）。

"use client";

import { useEffect, useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import { editorFor, type AttrEditor } from "./attr-catalog";

interface Props {
  node: ResolvedNode;
  /** 提交单个属性值（已和原值不同才调用） */
  onCommit: (name: string, value: string) => void;
  /** 删除属性 */
  onRemove: (name: string) => void;
  /** 打开「添加属性」弹窗 */
  onAddAttr: () => void;
}

const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);

function sizeOptions(value: string): string[] {
  const presets = ["match_parent", "wrap_content", "0dp"];
  return presets.includes(value) ? presets : [...presets, value];
}

export function AttrPanel({ node, onCommit, onRemove, onAddAttr }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 换节点时清空草稿
  useEffect(() => setDrafts({}), [node.path]);

  const commit = (name: string, value: string) => {
    const cur = node.rawAttrs[name];
    if (cur !== undefined && cur === value) return;
    onCommit(name, value);
  };

  const rows = Object.entries(node.rawAttrs);

  const renderEditor = (name: string, value: string) => {
    const { editor, options } = editorFor(name, value);
    const draft = drafts[name];
    switch (editor) {
      case "enum":
      case "bool":
        return (
          <select
            className="axv-attr-select"
            value={value}
            onChange={(e) => commit(name, e.target.value)}
          >
            {(options ?? ["true", "false"]).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case "size":
        return (
          <select
            className="axv-attr-select"
            value={value}
            onChange={(e) => commit(name, e.target.value)}
          >
            {sizeOptions(value).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
            {!(options ?? []).includes(value) && <option value="__custom__">自定义 dp…</option>}
          </select>
        );
      case "color":
        return (
          <div className="axv-attr-color">
            <span className="axv-attr-sw" style={{ background: /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "transparent" }} />
            <input
              className="axv-attr-input"
              value={draft ?? value}
              placeholder={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
              onBlur={() => {
                if (draft !== undefined) commit(name, draft);
                setDrafts((d) => {
                  const n = { ...d };
                  delete n[name];
                  return n;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        );
      default: {
        const ph: Record<string, string> = { dimen: "8dp / 14sp", number: "0.5", ref: "@+id/xxx 或 parent", string: "…" };
        return (
          <input
            className="axv-attr-input"
            value={draft ?? value}
            placeholder={ph[editor] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            onBlur={() => {
              if (draft !== undefined) commit(name, draft);
              setDrafts((d) => {
                const n = { ...d };
                delete n[name];
                return n;
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        );
      }
    }
  };

  const tag = shortTag(node.tag);

  return (
    <div className="axv-attr-panel">
      <div className="axv-attr-head">
        <span className="axv-attr-tag">{tag}</span>
        {node.rawAttrs.id ? <span className="axv-attr-id">{node.rawAttrs.id}</span> : null}
      </div>
      <div className="axv-attr-rows">
        {rows.length === 0 && <div className="axv-attr-empty">该节点还没有属性</div>}
        {rows.map(([name, value]) => (
          <div className="axv-attr-row" key={name}>
            <label className="axv-attr-name" title={name.replace(/^layout_/, "layout_")}>{name}</label>
            <div className="axv-attr-value">{renderEditor(name, String(value))}</div>
            <button
              className="axv-attr-del"
              title={`删除 ${name}`}
              aria-label={`删除 ${name}`}
              onClick={() => onRemove(name)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className="axv-attr-add" onClick={onAddAttr}>
        ＋ 添加属性
      </button>
    </div>
  );
}
