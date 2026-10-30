// components/AttrPanel.tsx — 右侧滑面板：选中节点的属性编辑器
// 已知枚举属性 → 下拉选择；size_input → 可编辑输入 + datalist 预设过滤；
// 颜色属性 → swatch 触发原生 color picker + hex 文本；background 加「选 drawable」按钮。

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ResolvedNode } from "@/lib/xml/types";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { editorFor, defaultFor, type AttrEditor } from "./attr-catalog";
import { getWidgetDoc, docAttrs, attrHint } from "@/lib/xml/widget-docs";
import { officialDocUrl } from "@/lib/xml/widget-links";
import { IconPickerPanel } from "./IconPickerPanel";
import { ShapeEditor } from "./ShapeEditor";
import { DrawablePicker } from "./DrawablePicker";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { specToCss } from "@/lib/xml/shape-gen";
import { parseShapeSpec } from "@/lib/xml/shape-gen";

export interface AttrPanelProps {
  node: ResolvedNode;
  /** M16e：根 → 当前节点的层级链（ScrollView > LinearLayout > TextView） */
  chain?: { tag: string; path: string; id?: string }[];
  /** M16e：点面包屑跳层 */
  onSelectPath?: (path: string) => void;
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
  /** M11p：从资源对话框直接打开图标编辑器（xml 为空 = 当前值不是 vector，让编辑器新建） */
  onEditIconResource?: (name: string, xml: string | undefined, attr: string) => void;
  /** M3g：已生成的图标资源名（用于标记「复用」） */
  iconNames?: string[];
  /** M3h：保存自定义形状（生成 res/drawable 资源 + 写入属性） */
  onSaveShape?: (attr: string, resourceName: string, xml: string) => void;
  /** M3h：已生成资源（名 → xml），用来回填已有形状的参数 */
  generatedXml?: Record<string, string>;
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

/** 哪些属性可以做「形状背景」（形状态/描边/圆角/水波纹最多用在背景上） */
const DRAWABLE_PICK_ATTRS = new Set([
  "src",
  "srcCompat",
  "icon",
  "navigationIcon",
  "checkedIcon",
  "drawableStart",
  "drawableLeft",
  "drawableEnd",
  "drawableRight",
  "drawableTop",
  "drawableBottom",
]);

const SHAPE_ATTRS = new Set(["background", "foreground", "src", "drawableStart", "drawableEnd"]);

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
  chain,
  onSelectPath,
  onCommit,
  onRemove,
  onAddAttr,
  resExtras,
  onDeleteNode,
  onPickIcon,
  onEditIconResource,
  iconNames,
  onSaveShape,
  generatedXml,
}: AttrPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** M3g：当前正在选图标的属性 */
  const [iconPick, setIconPick] = useState<string | null>(null);
  /** M3h：当前正在编辑形状的属性 */
  const [shapeEdit, setShapeEdit] = useState<string | null>(null);
  /** M4b：drawable 选择对话框（颜色/资源/形状/图标 四入口） */
  const [dpOpen, setDpOpen] = useState<string | null>(null);
  /** M4b：从对话框进入形状编辑器时携带的已有 XML（编辑模式回填参数） */
  const shapeEditRef = useRef<string | undefined>(undefined);
  // 换节点时清空
  useEffect(() => {
    shapeEditRef.current = undefined;
  }, [node.path]);
  /** M3a：右侧面板双页签：属性 / 文档 */
  const [tab, setTab] = useState<"attrs" | "docs">("attrs");
  /** 属性行展开的说明（点 ? 切换） */
  const [hintOpen, setHintOpen] = useState<string | null>(null);
  /** M28：属性搜索 + 只看已修改（30+ 属性时靠肉眼找太累） */
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  // 换节点时清空草稿
  useEffect(() => {
    setDrafts({});
    setHintOpen(null);
    setQ("");
    setOnlyChanged(false);
  }, [node.path]);

  const commit = (name: string, value: string) => {
    const cur = node.rawAttrs[name];
    if (cur !== undefined && cur === value) return;
    onCommit(name, value);
  };

  const allRows = Object.entries(node.rawAttrs);
  /** 与默认值相同 = 没改过（没有默认值的属性只要存在就算改过） */
  const isChanged = (name: string, value: string) => {
    const def = defaultFor(name);
    if (!def) return true;
    return String(value) !== def;
  };
  const qq = q.trim().toLowerCase();
  const rows = allRows.filter(([name, value]) => {
    if (onlyChanged && !isChanged(name, String(value))) return false;
    if (!qq) return true;
    return name.toLowerCase().includes(qq) || String(value).toLowerCase().includes(qq);
  });
  const changedCount = allRows.filter(([n, v]) => isChanged(n, String(v))).length;
  const dNames = drawableNames(resExtras);

  /** M4b：颜色输入区新布局 ——
   *  drawable 类属性（background/src/foreground）：一行 = 输入框（资源 ID / hex）+ 一个按钮
   *    按钮弹出「选择资源」对话框（颜色 / 图片xml资源 / 编辑创建形状 / 图标）
   *    按钮背景显示当前值：纯色=色块，vector/shape=缩略图，其他资源=占位图标
   *  纯颜色属性：保留原 swatch（原生取色器）+ hex 输入框 */
  const renderColor = (name: string, value: string, allowDrawable: boolean) => {
    if (allowDrawable) {
      const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
      const isRes = /^@/.test(value.trim());
      const resName = value.replace(/^@(?:drawable|mipmap)\//, "").replace(/\.xml$/, "");
      const genXml = generatedXml?.[resName];
      const upXml = resExtras?.drawableXml?.[resName];
      /** 按钮背景：优先 shape 预览，其次 vector 缩略，再次位图，最后纯色 */
      let btnBg: React.CSSProperties = { background: isHex ? value : "transparent" };
      let btnLabel = isHex ? "" : isRes ? "🖼" : "＋ 选择";
      if (isRes && genXml && /^<(ripple|selector|layer-list|inset|shape)/.test(genXml)) {
        const spec = parseShapeSpec(genXml);
        if (spec) {
          const css = specToCss(spec);
          btnBg = {
            background: css.background ?? "transparent",
            borderRadius: css.borderRadius as React.CSSProperties["borderRadius"] ?? undefined,
            border: css.border ?? undefined,
          };
          btnLabel = "";
        } else {
          btnLabel = "";
        }
      } else if (isRes && upXml && /^<(ripple|selector|layer-list|inset|shape)/.test(upXml)) {
        const spec = parseShapeSpec(upXml);
        if (spec) {
          const css = specToCss(spec);
          btnBg = {
            background: css.background ?? "transparent",
            borderRadius: css.borderRadius as React.CSSProperties["borderRadius"] ?? undefined,
            border: css.border ?? undefined,
          };
          btnLabel = "";
        }
      } else if (isRes && genXml && /<vector/.test(genXml)) {
        try {
          const url = vectorToDataUrl(genXml);
          btnBg = { background: "#fff url(" + url + ") center / 18px 18px no-repeat" };
        } catch {
          /* 缩略失败保持占位 */
        }
        btnLabel = "";
      } else if (isRes && resExtras?.drawables?.[resName]) {
        btnBg = { background: "#fff url(" + resExtras.drawables[resName] + ") center / cover no-repeat" };
        btnLabel = "";
      }
      return (
        <div className="axv-attr-color axv-dp-row" style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
          <input
            className="axv-attr-input"
            style={{ flex: 1, minWidth: 0 }}
            value={drafts[name] ?? value}
            placeholder="@drawable/bg_card 或 #FFFFFF"
            spellCheck={false}
            onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            onBlur={() => {
              if (drafts[name] !== undefined) commit(name, drafts[name]);
              setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <button
            className={"axv-dp-btn" + (isHex || isRes ? "" : " is-empty")}
            title={
              isHex
                ? `当前是纯色 ${value}。点按钮可换成资源、改色或自定义形状`
                : isRes
                  ? `当前是资源 ${value}。点按钮可换资源或编辑参数`
                  : "点按钮选择颜色 / 图片 xml 资源 / 自定义形状 / 图标"
            }
            aria-label={`选择 ${name} 的背景`}
            onClick={() => setDpOpen(name)}
          >
            {btnLabel ? <span className="axv-dp-btn-label">{btnLabel}</span> : <span className="axv-dp-prev" style={btnBg} />}
          </button>
        </div>
      );
    }
    const isHex2 = /^#[0-9a-fA-F]{3,8}$/.test(value);
    const swatchBg = isHex2 ? value : "transparent";
    const pickerVal = isHex2
      ? value.length === 4
        ? "#" + value.slice(1).split("").map((c) => c + c).join("") + "00"
        : value.length === 9
          ? "#" + value.slice(7) + value.slice(1, 7)
          : value
      : "#00000000";
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
          title={isHex2 ? value : "非 hex 颜色值"}
        >
          {isHex2 ? (
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
      </div>
    );
  };

  const renderEditor = (name: string, value: string) => {
    if (DRAWABLE_PICK_ATTRS.has(name)) return renderColor(name, value, true);
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
        return renderColor(name, value, name === "background" || name === "src" || name === "foreground" || name === "tint");
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
      {/* M16e：层级链（根 → 当前），比只看单层更清楚自己在哪一层 */}
      {chain && chain.length > 1 ? (
        <div className="axv-attr-chain" title="层级链：点任意一层可直接选中它">
          {chain.map((c, i) => (
            <span key={c.path} className="axv-chain-item">
              {i > 0 ? <span className="axv-chain-sep">&gt;</span> : null}
              <button
                type="button"
                className={"axv-chain-node" + (i === chain.length - 1 ? " on" : "")}
                onClick={() => onSelectPath?.(c.path)}
                title={c.id ? `${c.tag}  ${c.id}` : c.tag}
              >
                {shortTag(c.tag)}
                {c.id ? <i className="axv-chain-id">{c.id.replace(/^@\+?id\//, "")}</i> : null}
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
        <div className="axv-doc-body">          <div className="axv-doc-title">
            {wdoc.title}
            <span className="axv-doc-cat">{wdoc.category}</span>
          </div>
          {(() => {
            const url = wdoc.officialDoc ?? officialDocUrl(node.tag);
            return url ? (
              <a
                className="axv-doc-link"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                title={url}
              >
                官方文档
                <span className="msr" aria-hidden="true">open_in_new</span>
              </a>
            ) : null;
          })()}
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
      {/* M28：属性搜索 + 只看已修改 */}
      {allRows.length > 0 ? (
        <div className="axv-attr-filter">
          <input
            className="axv-attr-filter-input"
            placeholder={`过滤 ${allRows.length} 个属性…`}
            aria-label="过滤属性"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className={"axv-attr-filter-toggle" + (onlyChanged ? " is-on" : "")}
            title="只显示与默认值不同的属性"
            onClick={() => setOnlyChanged((v) => !v)}
          >
            只看已修改 {changedCount}
          </button>
          {qq ? (
            <button type="button" className="axv-attr-filter-clear" title="清空搜索" onClick={() => setQ("")}>✕</button>
          ) : null}
        </div>
      ) : null}
      <div className="axv-attr-rows">
        {allRows.length === 0 && <div className="axv-attr-empty">该节点还没有属性</div>}
        {allRows.length > 0 && rows.length === 0 && (
          <div className="axv-attr-empty">
            {onlyChanged && !qq ? `没有已修改的属性（共 ${allRows.length} 个都是默认值）` : `没有匹配「${q}」的属性`}
          </div>
        )}
        {rows.map(([name, value]) => {
          const hint = attrHint(node.tag, name);
          const vstr = String(value);
          return (
            <div key={name}>
              <div className="axv-attr-row">
                <label className="axv-attr-name" title={name}>{name}</label>
                <div className="axv-attr-value">{renderEditor(name, vstr)}</div>
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

      {dpOpen ? (
        createPortal(
        <DrawablePicker
          attrName={dpOpen}
          imageOnly={DRAWABLE_PICK_ATTRS.has(dpOpen)}
          value={String(node.rawAttrs[dpOpen] ?? "")}
          bitmapDrawables={resExtras?.drawables}
          xmlDrawables={{ ...(resExtras?.drawableXml ?? {}), ...(generatedXml ?? {}) }}
          generatedXml={generatedXml}
          onEditShape={(existingXml) => {
            setDpOpen(null);
            setShapeEdit(dpOpen);
            /** M4b：从对话框进入形状编辑器时带已有 XML 回填参数 */
            shapeEditRef.current = existingXml;
          }}
          onPickIcon={() => {
            setDpOpen(null);
            setIconPick(dpOpen);
          }}
          onEditIcon={() => {
            const attr = dpOpen;
            const nm = String(node.rawAttrs[attr] ?? "")
              .replace(/^@(?:drawable|mipmap)\//, "")
              .replace(/\.xml$/i, "");
            const xml = nm ? (generatedXml?.[nm] ?? resExtras?.drawableXml?.[nm]) : undefined;
            const isVec = !!xml && /<vector[\s>]/.test(xml);
            setDpOpen(null);
            onEditIconResource?.(isVec ? nm : "", isVec ? xml : undefined, attr);
          }}
          onCommit={(v) => {
            commit(dpOpen, v);
            setDpOpen(null);
          }}
          onClose={() => setDpOpen(null)}
        />,
          document.body
        )
      ) : null}

      {shapeEdit ? (
        createPortal(
        <ShapeEditor
          attrName={shapeEdit}
          value={String(node.rawAttrs[shapeEdit] ?? "")}
          existingXml={shapeEditRef.current ?? generatedXml?.[String(node.rawAttrs[shapeEdit] ?? "").replace(/^@(?:drawable|mipmap)\//, "").replace(/\.xml$/, "")]}
          existingNames={Object.keys(generatedXml ?? {})}
          onClose={() => { setShapeEdit(null); shapeEditRef.current = undefined; }}
          onSave={(resourceName, xml) => {
            onSaveShape?.(shapeEdit, resourceName, xml);
            setShapeEdit(null);
            shapeEditRef.current = undefined;
          }}
        />,
          document.body
        )
      ) : null}
    </div>
  );
}
