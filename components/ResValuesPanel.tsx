// components/ResValuesPanel.tsx — M66（C1）：项目里所有 values 资源一页管完
//
// 以前要看/改 strings.xml 得先在项目树里找到那个文件、打开、再切到「视图」表格；
// 想改一个 @string/app_name 必须离开当前布局。这个面板把 res/values*/ 下所有
// 字符串/颜色/尺寸/整数/布尔拉平成一张表：就地改值、改完直接写回原文件。
//
// 写回用 values-edit 的「外科手术」（只替换值区间），注释、空行、顺序都不动；
// 新建条目落到 values/strings.xml|colors.xml|dimens.xml…，文件不存在就现建。

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { scanResDirs } from "@/lib/xml/res-index";
import {
  KIND_LABEL,
  appendItem,
  parseValues,
  removeItem,
  setItemValue,
  uniqueName,
  type ValueItem,
} from "@/lib/xml/values-edit";

export interface ResValuesPanelProps {
  io: AiFileIo | null;
  /** 当前文档，用来推 res 目录（app/src/main/res 之类） */
  docRel?: string | null;
  onNote?: (msg: string) => void;
  /** 点行尾「↗」跳到定义（rel, 1 起行号） */
  onJump?: (rel: string, line: number) => void;
}

interface Row {
  rel: string;
  dirName: string;
  item: ValueItem;
  line: number;
}

const KINDS = ["all", "string", "color", "dimen", "integer", "bool"] as const;

const CONVENTIONAL: Record<string, string> = {
  string: "strings.xml",
  color: "colors.xml",
  dimen: "dimens.xml",
  integer: "integers.xml",
  bool: "bools.xml",
};

const NEW_TYPES = [
  { tag: "string", label: "字符串", sample: "标题" },
  { tag: "color", label: "颜色", sample: "#0B5FA5" },
  { tag: "dimen", label: "尺寸", sample: "8dp" },
  { tag: "integer", label: "整数", sample: "1" },
  { tag: "bool", label: "布尔", sample: "true" },
];

const EMPTY_FILE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
</resources>
`;

const FILE_CAP = 40;
const ITEM_CAP = 800;

/** 行号：值区间的起点落在第几行（1 起） */
function lineOf(xml: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < xml.length; i++) if (xml.charCodeAt(i) === 10) line++;
  return line;
}

export function ResValuesPanel({ io, docRel, onNote, onJump }: ResValuesPanelProps) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [resRel, setResRel] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [msg, setMsg] = useState("");
  const [busyRow, setBusyRow] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newType, setNewType] = useState("string");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /** rel → 该文件当前文本（改完就地更新，避免每次重读） */
  const texts = useRef<Map<string, string>>(new Map());

  const note = useCallback(
    (s: string) => {
      setMsg(s);
      onNote?.(s);
      window.setTimeout(() => setMsg(""), 2600);
    },
    [onNote],
  );

  const load = useCallback(async () => {
    if (!io) return;
    setLoading(true);
    try {
      const info = await scanResDirs(io, docRel ?? null);
      setResRel(info.resRel);
      const valuesDirs = info.dirs.filter((d) => /^values/.test(d)).sort();
      const next: Row[] = [];
      let files = 0;
      let cut = false;
      for (const d of valuesDirs) {
        if (files >= FILE_CAP || next.length >= ITEM_CAP) {
          cut = true;
          break;
        }
        const list = await io.list(`${info.resRel}/${d}`);
        if (!list.ok || !list.items) continue;
        for (const it of list.items) {
          if (it.kind !== "file" || !/\.xml$/i.test(it.name)) continue;
          if (files >= FILE_CAP || next.length >= ITEM_CAP) {
            cut = true;
            break;
          }
          files++;
          const rel = `${info.resRel}/${d}/${it.name}`;
          const r = await io.read(rel);
          if (!r.ok) continue;
          const text = r.text || "";
          texts.current.set(rel, text);
          const doc = parseValues(text);
          if (!doc.ok) continue;
          for (const item of doc.items) {
            if (next.length >= ITEM_CAP) {
              cut = true;
              break;
            }
            next.push({ rel, dirName: d, item, line: lineOf(text, item.elemFrom) });
          }
        }
      }
      setRows(next);
      setFileCount(files);
      setTruncated(cut);
      setLoaded(true);
      if (!info.resRel) note("没找到 res 目录：先打开一个 Android 项目");
      else if (!valuesDirs.length) note("这个项目里没有 res/values* 目录");
    } catch (e) {
      note(`读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [docRel, io, note]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.item.kind] = (c[r.item.kind] || 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.item.kind !== kind) return false;
      if (!needle) return true;
      return r.item.name.toLowerCase().includes(needle) || r.item.value.toLowerCase().includes(needle);
    });
  }, [kind, q, rows]);

  /** 写回某个 values 文件（只改动给定条目） */
  const writeFile = async (rel: string, nextText: string): Promise<boolean> => {
    if (!io) return false;
    const r = await io.write(rel, nextText);
    if (!r.ok) {
      note(`写回失败：${r.error || rel}`);
      return false;
    }
    texts.current.set(rel, nextText);
    return true;
  };

  const commitValue = async (row: Row, raw: string) => {
    const key = `${row.rel}#${row.item.name}`;
    const cur = texts.current.get(row.rel) || "";
    if (raw === row.item.value) return;
    const next = setItemValue(cur, row.item, raw);
    if (next === cur) {
      note("没改动（值相同或区间失效，建议刷新）");
      return;
    }
    setBusyRow(key);
    try {
      if (!(await writeFile(row.rel, next))) return;
      const doc = parseValues(next);
      setRows((all) =>
        all.map((r) => {
          if (r.rel !== row.rel) return r;
          if (r.item.name !== row.item.name || r.item.kind !== row.item.kind) return r;
          const fresh = doc.items.find((x) => x.name === row.item.name && x.kind === row.item.kind) || r.item;
          return { ...r, item: fresh, line: lineOf(next, fresh.elemFrom) };
        }),
      );
      note(`已改 ${row.item.name} = ${raw}`);
    } finally {
      setBusyRow("");
    }
  };

  const dropRow = async (row: Row) => {
    const cur = texts.current.get(row.rel) || "";
    const next = removeItem(cur, row.item);
    if (next === cur) {
      note("删不掉（元素区间失效，刷新后再试）");
      return;
    }
    if (!(await writeFile(row.rel, next))) return;
    setRows((all) => all.filter((r) => !(r.rel === row.rel && r.item.name === row.item.name && r.item.kind === row.item.kind)));
    note(`已删 ${row.item.name}`);
  };

  /** 新建条目：优先落在同名约定文件，其次落在已有同类型条目的文件，最后现建 */
  const addItem = async () => {
    const name = newName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      note("资源名只能用字母/数字/下划线，且不能以数字开头");
      return;
    }
    const value = newValue.trim();
    if (!value) {
      note("值不能为空");
      return;
    }
    const def = NEW_TYPES.find((t) => t.tag === newType) ?? NEW_TYPES[0];
    const baseDir = `${resRel}/values`;
    const sameKind = rows.filter((r) => r.item.kind === def.tag);
    const conventionalRel = `${baseDir}/${CONVENTIONAL[def.tag] || "values.xml"}`;
    let target =
      (texts.current.has(conventionalRel) ? conventionalRel : "") ||
      sameKind.find((r) => r.rel.startsWith(baseDir + "/"))?.rel ||
      conventionalRel;
    if (!texts.current.has(target)) {
      // 现建文件
      const ok = await writeFile(target, EMPTY_FILE);
      if (!ok) return;
      const doc0 = parseValues(EMPTY_FILE);
      if (doc0.items.some((it) => it.name === name)) {
        note(`已有 ${name}`);
        return;
      }
      const created = appendItem(EMPTY_FILE, { tag: def.tag, name, value }, doc0);
      if (!(await writeFile(target, created))) return;
      const doc1 = parseValues(created);
      const item = doc1.items.find((it) => it.name === name);
      if (item) {
        setRows((all) => [...all, { rel: target, dirName: "values", item, line: lineOf(created, item.elemFrom) }]);
        setFileCount((n) => n + 1);
      }
      setNewName("");
      setNewValue("");
      setNewOpen(false);
      note(`已新建 ${name} → ${target.replace(resRel + "/", "")}`);
      return;
    }
    const cur = texts.current.get(target) || "";
    const doc0 = parseValues(cur);
    if (doc0.items.some((it) => it.name === name && it.kind === def.tag)) {
      note(`这个文件里已经有 ${name} 了`);
      return;
    }
    const suggested = uniqueName(doc0, name);
    const next = appendItem(cur, { tag: def.tag, name: suggested, value }, doc0);
    if (!(await writeFile(target, next))) return;
    const doc = parseValues(next);
    const item = doc.items.find((it) => it.name === suggested && it.kind === def.tag);
    if (item) setRows((all) => [...all, { rel: target, dirName: target.split("/").slice(-2)[0], item, line: lineOf(next, item.elemFrom) }]);
    setNewName("");
    setNewValue("");
    setNewOpen(false);
    note(`已新建 ${suggested} = ${value}`);
  };

  const draftOf = (row: Row) => drafts[`${row.rel}#${row.item.name}`];

  return (
    <div className="axv-rv">
      <div className="axv-rv-head">
        <span className="axv-rv-title">资源值</span>
        <span className="axv-rv-count">
          {rows.length} 条 · {fileCount} 个文件
          {truncated ? "（已截断）" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button className="axv-rv-btn" title="重新读取" disabled={loading} onClick={() => void load()}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
            refresh
          </span>
        </button>
        <button className="axv-rv-btn" title="新建资源" onClick={() => setNewOpen((v) => !v)}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
            add
          </span>
        </button>
      </div>

      {!io ? <div className="axv-rv-empty">先打开一个项目目录，才能读写 res/values。</div> : null}
      {io && loading && !loaded ? <div className="axv-rv-empty">正在读取 values…</div> : null}

      {newOpen ? (
        <div className="axv-rv-new">
          <select className="axv-rv-sel" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {NEW_TYPES.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className="axv-rv-in"
            placeholder="名称，如 app_name"
            value={newName}
            spellCheck={false}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="axv-rv-in"
            placeholder={NEW_TYPES.find((t) => t.tag === newType)?.sample ?? "值"}
            value={newValue}
            spellCheck={false}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addItem();
            }}
          />
          <button className="axv-rv-ok" onClick={() => void addItem()}>
            添加
          </button>
        </div>
      ) : null}

      {loaded ? (
        <>
          <div className="axv-rv-filter">
            <input
              className="axv-rv-q"
              placeholder="搜索名称或值"
              value={q}
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="axv-rv-kinds">
            {KINDS.map((k) => (
              <button
                key={k}
                className={"axv-rv-kind" + (kind === k ? " on" : "")}
                onClick={() => setKind(k)}
              >
                {k === "all" ? "全部" : KIND_LABEL[k] ?? k}
                <span className="axv-rv-n">{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="axv-rv-list">
            {shown.length === 0 ? <div className="axv-rv-empty">没有匹配的资源</div> : null}
            {shown.map((row) => {
              const key = `${row.rel}#${row.item.name}`;
              const draft = draftOf(row);
              return (
                <div className="axv-rv-row" key={key} title={`${row.rel}:${row.line}`}>
                  <span className={"axv-rv-tag k-" + row.item.kind}>{row.item.kind}</span>
                  <span className="axv-rv-name">{row.item.name}</span>
                  <input
                    className="axv-rv-value"
                    value={draft ?? row.item.value}
                    spellCheck={false}
                    disabled={busyRow === key}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    onBlur={() => {
                      if (draft === undefined) return;
                      setDrafts((d) => {
                        const n = { ...d };
                        delete n[key];
                        return n;
                      });
                      void commitValue(row, draft);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") {
                        setDrafts((d) => {
                          const n = { ...d };
                          delete n[key];
                          return n;
                        });
                      }
                    }}
                  />
                  {onJump ? (
                    <button
                      className="axv-rv-ic"
                      title="跳到这一行"
                      onClick={() => onJump(row.rel, row.line)}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
                        arrow_outward
                      </span>
                    </button>
                  ) : null}
                  <button className="axv-rv-ic del" title={`删除 ${row.item.name}`} onClick={() => void dropRow(row)}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {msg ? <div className="axv-rv-msg">{msg}</div> : null}
    </div>
  );
}
