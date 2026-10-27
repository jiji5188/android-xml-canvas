// components/AttrPanel.tsx — 右侧滑面板：选中节点的属性编辑器
// 已知枚举属性 → 下拉选择；size_input → 可编辑输入 + datalist 预设过滤；
// 颜色属性 → swatch 触发原生 color picker + hex 文本；background 加「选 drawable」按钮。

"use client";

import { useEffect, useState } from "react";
import type { ResolvedNode } from "@/lib/xml/types";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { editorFor, type AttrEditor } from "./attr-catalog";
import { getWidgetDoc, docAttrs, attrHint } from "@/lib/xml/widget-docs";
import { IconPickerPanel } from "./IconPickerPanel";

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
  /** M3g：选中图标 → 生成 res/drawable 资源并写入该属性 */
  onPickIcon?: (attr: string, resourceName: string, vectorXml: string) => void;
  /** M3g：已生成的图标资源名（用于标记「复用」） */
  iconNames?: string[];
}

/** 哪些属性可以接图标（点击弹选择器） */
const ICON_ATTRS = new Set([
  "src",
  "srcCompat",
  "background",
  "foreground",
  "drawableStart",
  "drawableLeft",
  "drawableEnd",
  "drawableRight",
  "drawableTop",
  "drawableBottom",
  "icon",
  "navigationIcon",
  "checkedIcon",
]);

function canPickIcon(name: string, value: string): boolean {
  if (ICON_ATTRS.has(name)) return true;
  return /^@(drawable|mipmap)\//.test(value.trim());
}

const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);

/** M3e：从属性值里读 dp 数（"8dp" → 8；读不出算 0） */
function dpValue(raw: string | undefined): number {
  if (!raw) return 0;
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:dp|dip)?$/.exec(raw.trim());
  return m ? Number(m[1]) : 0;
}

const ELEV_PRESETS = [0, 2, 4, 8, 12, 24];

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

export function AttrPanel({
  node,
  onCommit,
  onRemove,
  onAddAttr,
  resExtras,
  onDeleteNode,
  onPickIcon,
  iconNames,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** M3g：当前正在选图标的属性 */
  const [iconPick, setIconPick] = useState<string | null>(null);
  /** M3a：右侧面板双页签：属性 / 文档 */
  const [tab, setTab] = useState<"attrs" | "docs">("attrs");
  /** 属性行展开的说明（点 ? 切换） */
  const [hintOpen, setHintOpen] = useState<string | null>(null);
  // 换节点时清空草稿
  useEffect(() => {
    setDrafts({});
    setHintOpen(null);
  }, [node.path]);

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
  const wdoc = getWidgetDoc(node.tag);
  /** M3e：当前层级（elevation + translationZ 的总和才是真实 Z） */
  const elevDp = dpValue(node.rawAttrs["elevation"]);
  const tzDp = dpValue(node.rawAttrs["translationZ"]);
  /** 拖动滑块/点预设：0 就删掉属性（别在 XML 里留一堆 elevation="0dp"） */
  const commitElev = (dp: number) => {
    if (dp <= 0) {
      if (node.rawAttrs["elevation"] !== undefined) onRemove("elevation");
      return;
    }
    if (String(dp) + "dp" === node.rawAttrs["elevation"]) return;
    onCommit("elevation", `${dp}dp`);
  };
  /** 文档页：当前节点已有值的属性排前面，其余说在后面 */
  const allDocs = docAttrs(node.tag);
  const owned = new Set(Object.keys(node.rawAttrs));

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

      {/* M3e：层级（elevation）专用控件——比在属性行里手打数字好找 */}
      <div className="axv-elev">
        <div className="axv-elev-head">
          <span className="axv-elev-title">层级</span>
          <span className="axv-elev-val">
            {tzDp > 0 ? `Z ${elevDp + tzDp}dp` : `${elevDp}dp`}
          </span>
          <span className="axv-elev-tip" title="抬得越高越靠上层：能盖住兄弟控件，并带阴影（Android: elevation）">
            elevation
          </span>
        </div>
        <input
          className="axv-elev-range"
          type="range"
          min={0}
          max={24}
          step={1}
          value={elevDp > 24 ? 24 : elevDp}
          aria-label="层级高度"
          onChange={(e) => commitElev(Number(e.target.value))}
        />
        <div className="axv-elev-presets">
          {ELEV_PRESETS.map((v) => (
            <button
              key={v}
              className={"axv-elev-chip" + (elevDp === v ? " is-on" : "")}
              title={v === 0 ? "平放（无阴影，不抬升）" : `抬升 ${v}dp`}
              onClick={() => commitElev(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* M3a：属性 / 文档页签 */}
      <div className="axv-attr-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "attrs"}
          className={"axv-attr-tab" + (tab === "attrs" ? " is-on" : "")}
          onClick={() => setTab("attrs")}
        >
          属性
        </button>
        <button
          role="tab"
          aria-selected={tab === "docs"}
          className={"axv-attr-tab" + (tab === "docs" ? " is-on" : "")}
          onClick={() => setTab("docs")}
        >
          文档
        </button>
      </div>

      {tab === "docs" ? (
        <div className="axv-doc-body">
          <div className="axv-doc-title">
            {wdoc.title}
            <span className="axv-doc-cat">{wdoc.category}</span>
          </div>
          <div className="axv-doc-summary">{wdoc.summary}</div>
          {wdoc.notes?.length ? (
            <ul className="axv-doc-notes">
              {wdoc.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="axv-doc-list">
            {allDocs.map((a) => (
              <div className={"axv-doc-item" + (owned.has(a.name) ? " is-set" : "")} key={a.name}>
                <div className="axv-doc-row">
                  <code className="axv-doc-name">{a.name}</code>
                  <span className="axv-doc-type">{a.type}</span>
                  {owned.has(a.name) ? <span className="axv-doc-badge">已设</span> : null}
                </div>
                <div className="axv-doc-desc">{a.desc}</div>
                {a.values?.length ? (
                  <div className="axv-doc-values">
                    {a.values.slice(0, 4).map((v) => (
                      <code key={v}>{v}</code>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
      <div className="axv-attr-rows">
        {rows.length === 0 && <div className="axv-attr-empty">该节点还没有属性</div>}
        {rows.map(([name, value]) => {
          const hint = attrHint(node.tag, name);
          const vstr = String(value);
          return (
            <div key={name}>
              <div className="axv-attr-row">
                <label className="axv-attr-name" title={name}>{name}</label>
                <div className="axv-attr-value">{renderEditor(name, vstr)}</div>
                {onPickIcon && canPickIcon(name, vstr) ? (
                  <button
                    className="axv-attr-info"
                    title="从 Material Symbols 选图标（会生成 res/drawable 资源）"
                    aria-label={`为 ${name} 选择图标`}
                    onClick={() => setIconPick(name)}
                  >
                    🖼
                  </button>
                ) : null}
                {hint ? (
                  <button
                    className="axv-attr-info"
                    title={hint}
                    aria-label={`${name} 说明`}
                    onClick={() => setHintOpen((h) => (h === name ? null : name))}
                  >
                    ?
                  </button>
                ) : null}
                <button
                  className="axv-attr-del"
                  title={`删除 ${name}`}
                  aria-label={`删除 ${name}`}
                  onClick={() => onRemove(name)}
                >
                  ✕
                </button>
              </div>
              {hintOpen === name && hint ? <div className="axv-attr-note">{hint}</div> : null}
            </div>
          );
        })}
      </div>
      <button className="axv-attr-add" onClick={onAddAttr}>
        ＋ 添加属性
      </button>
        </>
      )}

      {iconPick ? (
        <IconPickerPanel
          value={String(node.rawAttrs[iconPick] ?? "")}
          attrName={iconPick}
          existing={iconNames ?? []}
          onClose={() => setIconPick(null)}
          onPick={(resourceName, vectorXml, iconName) => {
            onPickIcon?.(iconPick, resourceName, vectorXml);
            setIconPick(null);
          }}
        />
      ) : null}
    </div>
  );
}
