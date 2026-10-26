// components/AttrPanel.tsx — 右侧滑面板：选中节点的属性编辑器
// 已知枚举属性 → 下拉选择；size_input → 可编辑输入 + datalist 预设过滤；
// 颜色属性 → swatch 触发原生 color picker + hex 文本；background 加「选 drawable」按钮。

"use client";

import { useEffect, useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { editorFor, type AttrEditor } from "./attr-catalog";

interface Props {
  node: ResolvedNode;
  /** 提交单个属性值（已和原值不同才调用） */
  onCommit: (name: string, value: string) => void;
  /** 删除属性 */
  onRemove: (name: string) => void;
  /** 删除当前选中的节点（控件） */
  onDeleteNode?: () => void;
  /** 打开「添加属性」弹窗 */
  onAddAttr: () => void;
  /** 已上传 res 资源（可选；提供后 background/src 可弹 drawable 列表） */
  resExtras?: ResourceExtras | null;
}

const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);

function sizeOptions(value: string): string[] {
  const presets = ["match_parent", "wrap_content", "0dp", "8dp", "16dp", "24dp", "48dp"];
  const extra = !presets.includes(value) && value ? [value] : [];
  return [...presets, ...extra];
}

/** 从 resExtras.drawables + vectorNames 里取所有可选 drawable 名 */
function drawableNames(extras: ResourceExtras | null | undefined): string[] {
  if (!extras) return [];
  const names = new Set<string>();
  Object.keys(extras.drawables || {}).forEach((n) => names.add(n));
  (extras.vectorNames || []).forEach((n) => names.add(n));
  return Array.from(names).sort();
}

export function AttrPanel({ node, onCommit, onRemove, onAddAttr, resExtras, onDeleteNode }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 换节点时清空草稿
  useEffect(() => setDrafts({}), [node.path]);

  const commit = (name: string, value: string) => {
    const cur = node.rawAttrs[name];
    if (cur !== undefined && cur === value) return;
    onCommit(name, value);
  };

  const rows = Object.entries(node.rawAttrs);
  const dNames = drawableNames(resExtras);

  /** 颜色输入区：swatch（可点触发 color picker）+ hex 文本框 */
  const renderColor = (name: string, value: string, allowDrawable: boolean) => {
    const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
    const swatchBg = isHex ? value : "transparent";
    const pickerVal = isHex
      ? value.length === 4
        ? "#" + value.slice(1).split("").map((c) => c + c).join("") + "00"
        : value.length === 9
          ? "#" + value.slice(7) + value.slice(1, 7)
          : value
      : "#00000000";
    const datalistId = "axv-drawables";
    return (
      <div className="axv-attr-color" style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
        <span
          className="axv-attr-sw"
          style={{
            background: swatchBg,
            position: "relative",
            flex: "0 0 28px",
            cursor: "pointer",
            border: "1px solid rgba(0,0,0,.15)",
            borderRadius: 4,
            overflow: "hidden",
          }}
          title={isHex ? value : "非 hex 颜色值"}
        >
          {isHex ? (
            <input
              type="color"
              value={pickerVal}
              onChange={(e) => commit(name, e.target.value.toUpperCase())}
              style={{ position: "absolute", inset: -6, width: "calc(100% + 12px)", height: "calc(100% + 12px)", opacity: 0, cursor: "pointer", border: "none" }}
            />
          ) : null}
        </span>
        <input
          className="axv-attr-input"
          style={{ flex: 1, minWidth: 0 }}
          value={drafts[name] ?? value}
          placeholder={value || "#FFFFFF"}
          spellCheck={false}
          onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
          onBlur={() => {
            if (drafts[name] !== undefined) commit(name, drafts[name]);
            setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        {allowDrawable && dNames.length > 0 ? (
          <>
            <input
              id={datalistId}
              style={{ display: "none" }}
              list={datalistId}
            />
            <datalist id={datalistId}>
              {dNames.map((n) => <option key={n} value={n} />)}
            </datalist>
            <button
              className="axv-attr-input"
              style={{
                flex: "0 0 80px",
                padding: "0 8px",
                cursor: "pointer",
                fontSize: 11,
              }}
              title="从已上传 drawable 里选（值会写成 @drawable/name）"
              onClick={(e) => {
                const btn = e.currentTarget;
                // 简单弹出：让 input 显示为列表选择
                const inp = document.createElement("input");
                inp.style.position = "absolute";
                inp.style.zIndex = "99";
                inp.setAttribute("list", datalistId);
                inp.style.left = btn.offsetLeft + "px";
                inp.style.top = "0px";
                inp.style.width = "100px";
                btn.parentElement?.appendChild(inp);
                inp.focus();
                inp.addEventListener("change", () => {
                  if (inp.value) commit(name, "@drawable/" + inp.value);
                  inp.remove();
                });
              }}
            >
              🖼 选图
            </button>
          </>
        ) : null}
      </div>
    );
  };

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
      case "size_input": {
        // 可编辑：input + datalist 预设过滤
        const listId = "axv-size-" + name;
        return (
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <input
              className="axv-attr-input"
              style={{ width: "100%" }}
              value={draft ?? value}
              list={listId}
              placeholder="match_parent / 8dp / …"
              spellCheck={false}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
              onBlur={() => {
                if (draft !== undefined) commit(name, draft);
                setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
            <datalist id={listId}>
              {sizeOptions(value).map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
        );
      }
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
          </select>
        );
      case "color":
        return renderColor(name, value, name === "background" || name === "src" || name === "foreground");
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
              setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
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
        {onDeleteNode ? (
          <button
            className="axv-attr-del-node"
            title="删除当前选中的控件"
            aria-label="删除当前选中的控件"
            onClick={onDeleteNode}
          >
            🗑 删除
          </button>
        ) : null}
      </div>
      <div className="axv-attr-rows">
        {rows.length === 0 && <div className="axv-attr-empty">该节点还没有属性</div>}
        {rows.map(([name, value]) => (
          <div className="axv-attr-row" key={name}>
            <label className="axv-attr-name" title={name}>{name}</label>
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
