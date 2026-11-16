// components/ValuesEditor.tsx — M39：res/values/*.xml 的可视化编辑（表格化）
//
// 只做「键值表」这一层：名称 + 值，按类型分组筛选。真正的写回是 values-edit.ts 里的
// 外科手术（只替换值/name 区间），所以文件里的注释、空行、自定义顺序都不会被动。
//
// 颜色值有取色块；尺寸/整数给单位提示；字符串按正文编辑。

"use client";

import { useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { isValidResName } from "@/lib/xml/resname";
import { ColorField } from "./ColorField";
import { parseColorOr, toArgbHex, toRgbHex } from "@/lib/xml/color-argb";
import {
  KIND_LABEL,
  appendItem,
  colorForPreview,
  groupByContainer,
  isColorValue,
  parseValues,
  removeItem,
  setItemName,
  setItemValue,
  uniqueName,
  type ValueItem,
} from "@/lib/xml/values-edit";
import { themeItemDesc, allItemDescs, SYSTEM_PARENT_THEMES, type ThemeItemValueType } from "@/lib/xml/theme-item-descs";

export interface ValuesEditorProps {
  xml: string;
  onChange: (next: string) => void;
  onNote?: (msg: string) => void;
  className?: string;
  /** M341：整个 values 下其它文件已定义的顶层资源名（跨文件查重用；不含本文件） */
  reservedNames?: string[];
}

const KINDS = ["all", "string", "color", "dimen", "integer", "bool", "other"] as const;

/** M338：主题 style 里 item 的类型标签（按属性说明表推出来） */
const TYPE_LABEL: Record<ThemeItemValueType, string> = {
  color: "颜色", // i18n-ignore
  dimen: "尺寸", // i18n-ignore
  text: "文本", // i18n-ignore
  bool: "开关", // i18n-ignore
  other: "自定义", // i18n-ignore
};

/** 取色器回传的是 CSS 颜色串 → 转回 colors.xml 习惯的写法：
 *  alpha=1 写 #RRGGBB，带透明度写 #AARRGGBB（都是大写，与老行为一致） */
function cssToAndroidColor(css: string): string {
  const c = parseColorOr(css, "#000000");
  return (c.a >= 1 ? toRgbHex(c) : toArgbHex(c)).toUpperCase();
}

const NEW_TYPES: { tag: string; label: string; hint: string; sample: string }[] = [
  { tag: "string", label: "字符串", hint: "显示文本", sample: "标题" }, // i18n-ignore
  { tag: "color", label: "颜色", hint: "#RRGGBB / @color/x", sample: "#0B5FA5" }, // i18n-ignore
  { tag: "dimen", label: "尺寸", hint: "8dp / 12sp", sample: "8dp" }, // i18n-ignore
  { tag: "integer", label: "整数", hint: "纯数字", sample: "1" }, // i18n-ignore
  { tag: "bool", label: "布尔", hint: "true / false", sample: "true" }, // i18n-ignore
];

export function ValuesEditor({ xml, onChange, onNote, className, reservedNames }: ValuesEditorProps) {
  const doc = useMemo(() => parseValues(xml), [xml]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newType, setNewType] = useState("string");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [msg, setMsg] = useState("");
  /** M341：style 容器折叠状态（key = style name）；缺省展开 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** M341：parent 选择弹窗（哪个样式头打开 + 过滤词） */
  const [parentFor, setParentFor] = useState<string | null>(null);
  const [parentQ, setParentQ] = useState("");
  /** M341：属性名过滤弹窗（哪个 style 内的 item 打开 + 过滤词） */
  const [attrFor, setAttrFor] = useState<string | null>(null);
  const [attrQ, setAttrQ] = useState("");

  const note = (s: string) => {
    setMsg(s);
    onNote?.(s);
    window.setTimeout(() => setMsg(""), 2600);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: doc.items.length };
    for (const it of doc.items) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [doc.items]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return doc.items.filter((it) => {
      if (kind !== "all" && it.kind !== kind) return false;
      if (!needle) return true;
      return (
        it.name.toLowerCase().includes(needle) || it.value.toLowerCase().includes(needle)
      );
    });
  }, [doc.items, q, kind]);

  /** M341：按 style 容器分组（多个主题样式各自一）。先按 kind/搜索过滤，再保留有可见成员的组 */
  const groups = useMemo(() => {
    const visible = new Set(rows.map((r) => r.elemFrom));
    return groupByContainer(doc).filter(
      (g) =>
        (g.head && visible.has(g.head.elemFrom)) ||
        g.children.some((c) => visible.has(c.elemFrom)),
    );
  }, [doc, rows]);

  /** M341：跨文件保留名集合（其它 values 文件已用的顶层资源名） */
  const reserved = useMemo(() => new Set((reservedNames ?? []).map((n) => n.trim())), [reservedNames]);
  /** M341：属性名过滤列表（全部已知 item 属性，去重排序） */
  const attrOptions = useMemo(() => allItemDescs(), []);

  const commitValue = (it: ValueItem, raw: string, el?: HTMLInputElement) => {
    if (it.valueFrom < 0) return; // M315：容器分组标题不可改值
    if (raw === it.value) return;
    if (it.kind === "color" && raw.trim() && !isColorValue(raw)) {
      note(tt("颜色值要写 #RRGGBB / #AARRGGBB 或 @color/xxx"));
      if (el) el.value = it.value;
      return;
    }
    onChange(setItemValue(xml, it, raw));
    note(tt("已改 {name}", { name: it.name }));
  };

  /** M341：改了 parent 属性（style 标题行） */
  const setParent = (it: ValueItem, parent: string) => {
    if (it.valueFrom >= 0) return;
    const from = it.elemFrom;
    const slice = xml.slice(from, it.elemEnd);
    const openEnd = slice.indexOf(">");
    if (openEnd < 0) return;
    const open = slice.slice(0, openEnd + 1);
    const hasParent = /\sparent\s*=/.test(open);
    let nextOpen: string;
    if (!parent) {
      // 删 parent
      nextOpen = open.replace(/\s+parent\s*=\s*("[^"]*"|'[^']*')/, "");
    } else if (hasParent) {
      nextOpen = open.replace(/\sparent\s*=\s*("[^"]*"|'[^']*')/, ` parent="${parent}"`);
    } else {
      // 插在 name 属性后（或标签名前）
      nextOpen = open.replace(/^(<style\b)/, `$1 parent="${parent}"`);
    }
    onChange(xml.slice(0, from) + nextOpen + slice.slice(openEnd + 1) + xml.slice(it.elemEnd));
    note(parent ? tt("已继承 {p}", { p: parent }) : tt("已清除 parent"));
  };

  const commitName = (it: ValueItem, raw: string, el?: HTMLInputElement) => {
    const next = raw.trim();
    if (!next || next === it.name) {
      if (el && el.value !== it.name) el.value = it.name;
      return;
    }
    if (!isValidResName(next)) {
      note(tt("名称只能用小写字母/数字/下划线，且不能以数字开头"));
      if (el) el.value = it.name;
      return;
    }
    // M341：style 内的 <item> 是属性引用，同名合法，不做重名校验
    if (!it.inStyle) {
      if (doc.items.some((o) => o !== it && !o.inStyle && o.name === next)) {
        note(tt("名称 {name} 在本文件已存在", { name: next }));
        if (el) el.value = it.name;
        return;
      }
      if (reserved.has(next)) {
        note(tt("资源名 {name} 在其它 values 文件已用过（全局不能重名）", { name: next }));
        if (el) el.value = it.name;
        return;
      }
    }
    onChange(setItemName(xml, it, next));
    note(tt("已重命名为 {name}", { name: next }));
  };

  const del = (it: ValueItem) => {
    onChange(removeItem(xml, it));
    note(tt("已删除 {name}", { name: it.name }));
  };

  const add = () => {
    const t = NEW_TYPES.find((x) => x.tag === newType) || NEW_TYPES[0];
    const name = uniqueName(doc, newName.trim() || `${t.tag}_new`);
    const value = newValue.trim() || t.sample;
    if (t.tag === "color" && !isColorValue(value)) {
      note(tt("颜色值要写 #RRGGBB / #AARRGGBB 或 @color/xxx"));
      return;
    }
    onChange(appendItem(xml, { tag: t.tag, name, value }));
    setNewName("");
    setNewValue("");
    setNewOpen(false);
    note(tt("已新建 {name}", { name }));
  };

  /** 渲染一条（顶层资源 / 样式头 / style 内子项） */
  const renderRow = (it: ValueItem, isHeadRow = false) => {
    const isHead = it.valueFrom < 0;
    const desc = it.inStyle ? themeItemDesc(it.name) : undefined;
    const swatch = !isHead && it.kind === "color" ? colorForPreview(it.value) : null;
    const tagLabel = isHead
      ? it.tag === "style"
        ? tt("样式")
        : tt("属性组")
      : desc
        ? TYPE_LABEL[desc.type]
        : KIND_LABEL[it.kind] || it.kind;
    const rowClass =
      "axv-val-row" +
      (isHead ? " is-style-head" : "") +
      (desc ? " has-desc" : "") +
      (it.inStyle ? " in-style" : "");
    const isCollapsed = !!collapsed[it.name];
    return (
      <div
        className={rowClass}
        role="listitem"
        key={`${it.tag}:${it.name}:${it.elemFrom}`}
        style={it.depth ? { paddingLeft: 22 } : undefined}
      >
        <div className="axv-val-line">
          {isHeadRow ? (
            <button
              type="button"
              className="axv-val-fold"
              aria-expanded={!isCollapsed}
              title={isCollapsed ? tt("展开") : tt("折叠")}
              aria-label={isCollapsed ? tt("展开") : tt("折叠")}
              onClick={() => setCollapsed((m) => ({ ...m, [it.name]: !m[it.name] }))}
            >
              <span className="msr" aria-hidden="true">
                {isCollapsed ? "chevron_right" : "expand_more"}
              </span>
            </button>
          ) : null}
          <span className={"axv-val-tag k-" + (isHead ? "style" : it.kind)}>{tagLabel}</span>
          <input
            className="axv-val-name"
            defaultValue={it.name}
            aria-label={tt("{name} 名称", { name: it.name })}
            spellCheck={false}
            list={it.inStyle ? "axv-attr-dl" : undefined}
            placeholder={it.inStyle ? tt("属性名（可输入过滤）") : undefined}
            onBlur={(e) => commitName(it, e.target.value, e.target)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = it.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {isHead ? (
            <input
              className="axv-val-parent"
              defaultValue={it.parent ?? ""}
              list="axv-parent-dl"
              placeholder={tt("无 parent")}
              aria-label={tt("{name} 继承父样式", { name: it.name })}
              title={tt("选择或输入系统主题名")}
              spellCheck={false}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (it.parent ?? "")) setParent(it, v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <>
              {swatch ? (
                <ColorField
                  label={tt("{name} 取色", { name: it.name })}
                  value={it.value}
                  fallback={swatch}
                  onChange={(next) => onChange(setItemValue(xml, it, cssToAndroidColor(next)))}
                />
              ) : null}
              <input
                className="axv-val-value"
                defaultValue={it.value}
                aria-label={tt("{name} 值", { name: it.name })}
                spellCheck={false}
                onBlur={(e) => commitValue(it, e.target.value, e.target)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    (e.target as HTMLInputElement).value = it.value;
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </>
          )}
          <button
            type="button"
            className="axv-val-del"
            title={tt("删除 {name}", { name: it.name })}
            aria-label={tt("删除 {name}", { name: it.name })}
            onClick={() => del(it)}
          >
            <span className="msr" aria-hidden="true">delete</span>
          </button>
        </div>
        {desc ? <div className="axv-val-desc">{tt(desc.desc)}</div> : null}
      </div>
    );
  };

  if (!doc.ok) {
    return (
      <div className={"axv-val " + (className || "")}>
        <div className="axv-val-empty">
          <span className="msr" aria-hidden="true">warning</span>
          <div>{doc.reason || tt("这个文件不是 values 资源")}</div>
          <div className="axv-val-hint">{tt("切到「代码」还能直接改原文。")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={"axv-val " + (className || "")}>
      {/* M341：属性名 / parent 的过滤列表（原生 datalist，随输入过滤） */}
      <datalist id="axv-attr-dl" aria-hidden="true">
        {attrOptions.map((d) => (
          <option key={d.attr} value={d.attr} />
        ))}
      </datalist>
      <datalist id="axv-parent-dl" aria-hidden="true">
        {SYSTEM_PARENT_THEMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="axv-val-top">
        <div className="axv-val-chips" role="tablist" aria-label={tt("资源类型")}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={"axv-val-chip" + (kind === k ? " on" : "")}
              onClick={() => setKind(k)}
            >
              {k === "all" ? tt("全部") : KIND_LABEL[k] || k}
              <b>{counts[k] || 0}</b>
            </button>
          ))}
        </div>
        <div className="axv-val-tools">
          <input
            className="axv-val-search"
            value={q}
            placeholder={tt("搜名称或值")}
            aria-label={tt("搜索资源")}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className="axv-val-add"
            onClick={() => setNewOpen((v) => !v)}
            title={tt("新建一条资源")}
          >
            <span className="msr" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      {newOpen ? (
        <div className="axv-val-new">
          <select
            className="axv-tb-select"
            aria-label={tt("新资源类型")}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          >
            {NEW_TYPES.map((t) => (
              <option key={t.tag} value={t.tag}>{t.label}</option>
            ))}
          </select>
          <input
            value={newName}
            placeholder={tt("名称（留空自动生成）")}
            aria-label={tt("新资源名称")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {newType === "color" ? (
            <ColorField
              label={tt("新颜色")}
              value={newValue.trim() || "#0B5FA5"}
              fallback="#0B5FA5"
              onChange={(next) => setNewValue(cssToAndroidColor(next))}
            />
          ) : null}
          <input
            value={newValue}
            placeholder={(NEW_TYPES.find((t) => t.tag === newType) || NEW_TYPES[0]).hint}
            aria-label={tt("新资源值")}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button type="button" className="axv-val-ok" onClick={add}>{tt("添加")}</button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="axv-val-empty">
          <span className="msr" aria-hidden="true">inbox</span>
          <div>{doc.items.length === 0 ? tt("这个文件里还没有资源") : tt("没有匹配的条目")}</div>
          <div className="axv-val-hint">{tt("点右上角 + 新建一条。")}</div>
        </div>
      ) : (
        <div className="axv-val-list" role="list">
          {groups.map((g) => {
            // 单个顶层资源条目（非容器）
            if (!g.head) return renderRow(g.children[0]);
            const head = g.head;
            const isCollapsed = !!collapsed[head.name];
            return (
              <div className="axv-val-group" role="listitem" key={`g:${head.name}:${head.elemFrom}`}>
                {renderRow(head, true)}
                {isCollapsed
                  ? null
                  : g.children.map((c) => renderRow(c))}
              </div>
            );
          })}
        </div>
      )}

      <div className="axv-val-foot">
        {msg ? <span className="axv-val-msg">{msg}</span> : <span>{tt("共 {n} 条资源", { n: doc.items.length })}</span>}
        <span className="axv-val-tip">{tt("改动只动对应那一段，注释和排版保持原样")}</span>
      </div>
    </div>
  );
}
