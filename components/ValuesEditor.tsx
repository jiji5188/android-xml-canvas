// components/ValuesEditor.tsx — M39：res/values/*.xml 的可视化编辑（表格化）
//
// 只做「键值表」这一层：名称 + 值，按类型分组筛选。真正的写回是 values-edit.ts 里的
// 外科手术（只替换值/name 区间），所以文件里的注释、空行、自定义顺序都不会被动。
//
// 颜色值有取色块；尺寸/整数给单位提示；字符串按正文编辑。

"use client";

import { useMemo, useState } from "react";
import {
  KIND_LABEL,
  appendItem,
  colorForPreview,
  isColorValue,
  parseValues,
  removeItem,
  setItemName,
  setItemValue,
  uniqueName,
  type ValueItem,
} from "@/lib/xml/values-edit";

export interface ValuesEditorProps {
  xml: string;
  onChange: (next: string) => void;
  onNote?: (msg: string) => void;
  className?: string;
}

const KINDS = ["all", "string", "color", "dimen", "integer", "bool", "other"] as const;

const NEW_TYPES: { tag: string; label: string; hint: string; sample: string }[] = [
  { tag: "string", label: "字符串", hint: "显示文本", sample: "标题" },
  { tag: "color", label: "颜色", hint: "#RRGGBB / @color/x", sample: "#0B5FA5" },
  { tag: "dimen", label: "尺寸", hint: "8dp / 12sp", sample: "8dp" },
  { tag: "integer", label: "整数", hint: "纯数字", sample: "1" },
  { tag: "bool", label: "布尔", hint: "true / false", sample: "true" },
];

export function ValuesEditor({ xml, onChange, onNote, className }: ValuesEditorProps) {
  const doc = useMemo(() => parseValues(xml), [xml]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newType, setNewType] = useState("string");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [msg, setMsg] = useState("");

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

  const commitValue = (it: ValueItem, raw: string, el?: HTMLInputElement) => {
    if (raw === it.value) return;
    if (it.kind === "color" && raw.trim() && !isColorValue(raw)) {
      note("颜色值要写 #RRGGBB / #AARRGGBB 或 @color/xxx");
      if (el) el.value = it.value;
      return;
    }
    onChange(setItemValue(xml, it, raw));
    note(`已改 ${it.name}`);
  };

  const commitName = (it: ValueItem, raw: string, el?: HTMLInputElement) => {
    const next = raw.trim();
    if (!next || next === it.name) {
      if (el && el.value !== it.name) el.value = it.name;
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next)) {
      note("名称只能用字母/数字/下划线，且不能以数字开头");
      if (el) el.value = it.name;
      return;
    }
    if (doc.items.some((o) => o !== it && o.name === next)) {
      note(`名称 ${next} 已存在`);
      if (el) el.value = it.name;
      return;
    }
    onChange(setItemName(xml, it, next));
    note(`已重命名为 ${next}`);
  };

  const del = (it: ValueItem) => {
    onChange(removeItem(xml, it));
    note(`已删除 ${it.name}`);
  };

  const add = () => {
    const t = NEW_TYPES.find((x) => x.tag === newType) || NEW_TYPES[0];
    const name = uniqueName(doc, newName.trim() || `${t.tag}_new`);
    const value = newValue.trim() || t.sample;
    if (t.tag === "color" && !isColorValue(value)) {
      note("颜色值要写 #RRGGBB / #AARRGGBB 或 @color/xxx");
      return;
    }
    onChange(appendItem(xml, { tag: t.tag, name, value }));
    setNewName("");
    setNewValue("");
    setNewOpen(false);
    note(`已新建 ${name}`);
  };

  if (!doc.ok) {
    return (
      <div className={"axv-val " + (className || "")}>
        <div className="axv-val-empty">
          <span className="msr" aria-hidden="true">warning</span>
          <div>{doc.reason || "这个文件不是 values 资源"}</div>
          <div className="axv-val-hint">切到「代码」还能直接改原文。</div>
        </div>
      </div>
    );
  }

  return (
    <div className={"axv-val " + (className || "")}>
      <div className="axv-val-top">
        <div className="axv-val-chips" role="tablist" aria-label="资源类型">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={"axv-val-chip" + (kind === k ? " on" : "")}
              onClick={() => setKind(k)}
            >
              {k === "all" ? "全部" : KIND_LABEL[k] || k}
              <b>{counts[k] || 0}</b>
            </button>
          ))}
        </div>
        <div className="axv-val-tools">
          <input
            className="axv-val-search"
            value={q}
            placeholder="搜名称或值"
            aria-label="搜索资源"
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className="axv-val-add"
            onClick={() => setNewOpen((v) => !v)}
            title="新建一条资源"
          >
            <span className="msr" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      {newOpen ? (
        <div className="axv-val-new">
          <select
            className="axv-tb-select"
            aria-label="新资源类型"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          >
            {NEW_TYPES.map((t) => (
              <option key={t.tag} value={t.tag}>{t.label}</option>
            ))}
          </select>
          <input
            value={newName}
            placeholder="名称（留空自动生成）"
            aria-label="新资源名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <input
            value={newValue}
            placeholder={(NEW_TYPES.find((t) => t.tag === newType) || NEW_TYPES[0]).hint}
            aria-label="新资源值"
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button type="button" className="axv-val-ok" onClick={add}>添加</button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="axv-val-empty">
          <span className="msr" aria-hidden="true">inbox</span>
          <div>{doc.items.length === 0 ? "这个文件里还没有资源" : "没有匹配的条目"}</div>
          <div className="axv-val-hint">点右上角 + 新建一条。</div>
        </div>
      ) : (
        <div className="axv-val-list" role="list">
          {rows.map((it) => {
            const swatch = it.kind === "color" ? colorForPreview(it.value) : null;
            return (
              <div className="axv-val-row" role="listitem" key={`${it.tag}:${it.name}:${it.elemFrom}`}>
                <span className={"axv-val-tag k-" + it.kind}>{KIND_LABEL[it.kind] || it.kind}</span>
                <input
                  className="axv-val-name"
                  defaultValue={it.name}
                  aria-label={`${it.name} 名称`}
                  spellCheck={false}
                  onBlur={(e) => commitName(it, e.target.value, e.target)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      (e.target as HTMLInputElement).value = it.name;
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                {swatch ? (
                  <input
                    className="axv-val-swatch"
                    type="color"
                    aria-label={`${it.name} 取色`}
                    value={swatch}
                    onChange={(e) => onChange(setItemValue(xml, it, e.target.value.toUpperCase()))}
                  />
                ) : null}
                <input
                  className="axv-val-value"
                  defaultValue={it.value}
                  aria-label={`${it.name} 值`}
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
                <button
                  type="button"
                  className="axv-val-del"
                  title={`删除 ${it.name}`}
                  aria-label={`删除 ${it.name}`}
                  onClick={() => del(it)}
                >
                  <span className="msr" aria-hidden="true">delete</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="axv-val-foot">
        {msg ? <span className="axv-val-msg">{msg}</span> : <span>共 {doc.items.length} 条资源</span>}
        <span className="axv-val-tip">改动只动对应那一段，注释和排版保持原样</span>
      </div>
    </div>
  );
}
