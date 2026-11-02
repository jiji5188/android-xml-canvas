"use client";
// components/IconResPicker.tsx — M88：资源对话框里的「图标资源」选择器
// 旧版 IconPickerPanel 的接口搬到独立文件（AttrPanel 的 @drawable 图标资源流程仍在用）：
// 选中图标 → 返回 (资源名, <vector> xml, 原图标名)，由 AttrPanel 写入 res/drawable。
import * as React from "react";
import { ICON_MATERIAL, ICON_BUILTIN, decompressIconSet, type IconItem } from "@/lib/xml/icon-libs";

export interface IconResPickerProps {
  /** 当前属性值（如 @drawable/ic_xxx），仅用于展示 */
  value?: string;
  /** 属性名 */
  attrName?: string;
  /** 已存在的图标资源名（列表里标「已有」） */
  existing?: string[];
  onClose: () => void;
  onPick: (resourceName: string, vectorXml: string, iconName: string) => void;
}

type Tab = "material" | "lucide" | "tabler" | "geo";

/** IconItem → 24dp 的 Android <vector> xml */
export function iconToVectorXml(it: IconItem): string {
  const st = it.st === 1;
  const attrs = [`android:pathData="${it.d}"`, `android:fillColor="${st ? "#00000000" : "#1D1B20"}"`];
  if (st) {
    attrs.push('android:strokeColor="#1D1B20"');
    attrs.push('android:strokeWidth="2"');
    attrs.push('android:strokeLineCap="round"');
    attrs.push('android:strokeLineJoin="round"');
  }
  return (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" ' +
    'android:width="24dp" android:height="24dp" ' +
    'android:viewportWidth="24" android:viewportHeight="24">\n' +
    `  <path ${attrs.join(" ")} />\n` +
    "</vector>"
  );
}

export function IconResPicker({ value, attrName, existing = [], onClose, onPick }: IconResPickerProps) {
  const [tab, setTab] = React.useState<Tab>("material");
  const [q, setQ] = React.useState("");
  const [lazy, setLazy] = React.useState<Partial<Record<"lucide" | "tabler", IconItem[]>>>({});
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (tab !== "lucide" && tab !== "tabler") return;
    if (lazy[tab]) return;
    const p = decompressIconSet(tab);
    if (!p) {
      setErr("当前环境不支持 gzip 解压");
      return;
    }
    let alive = true;
    p.then((arr) => {
      if (alive) setLazy((prev) => ({ ...prev, [tab]: arr }));
    }).catch(() => {
      if (alive) setErr("图标库解压失败");
    });
    return () => {
      alive = false;
    };
  }, [tab, lazy]);

  const pool: IconItem[] = tab === "material" ? ICON_MATERIAL : tab === "geo" ? ICON_BUILTIN : lazy[tab] ?? [];
  const loading = (tab === "lucide" || tab === "tabler") && !lazy[tab] && !err;
  const s = q.trim().toLowerCase();
  const list = pool.filter((it) => !s || it.n.toLowerCase().includes(s));

  return (
    <div
      className="axv-cp-mask"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-cp axv-iconlib" role="dialog" aria-label={attrName ? `图标资源 · ${attrName}` : "图标资源"} aria-modal="true">
        <div className="cp-header">
          <div className="cp-title">
            <span className="msr" aria-hidden>
              apps
            </span>
            {attrName ? `图标资源 · ${attrName}` : "图标资源"}
          </div>
          <button type="button" className="cp-x" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="axv-iconlib-tabs">
          {(
            [
              ["material", "Material"],
              ["lucide", "Lucide"],
              ["tabler", "Tabler"],
              ["geo", "几何"],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={"axv-iconlib-tab" + (tab === k ? " on" : "")}
              onClick={() => {
                setTab(k);
                setErr("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="axv-iconlib-search">
          <span className="msr" aria-hidden>
            search
          </span>
          <input placeholder="搜索图标名…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {value ? <p className="axv-iconlib-hint">当前值：{value}</p> : null}
        {err ? <p className="axv-iconlib-err">{err}</p> : null}
        {loading ? <p className="axv-iconlib-hint">正在解压 {tab} …</p> : null}
        {!loading && !err ? (
          <div className="axv-iconlib-grid">
            {list.slice(0, 300).map((it, i) => (
              <button
                key={it.n + i}
                type="button"
                className="axv-iconlib-cell"
                title={it.n}
                onClick={() => {
                  onPick(it.n, iconToVectorXml(it), it.n);
                  onClose();
                }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                  <path
                    d={it.d}
                    fill={it.st === 1 ? "none" : "currentColor"}
                    stroke={it.st === 1 ? "currentColor" : "none"}
                    strokeWidth={it.st === 1 ? 2 : 0}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  {it.n}
                  {existing.includes(it.n) ? " ✓" : ""}
                </span>
              </button>
            ))}
            {!list.length ? <p className="axv-iconlib-hint">没有匹配「{q}」的图标</p> : null}
          </div>
        ) : null}
        <div className="axv-iconlib-foot">
          <span className="axv-iconlib-count">共 {list.length} 个</span>
          <button type="button" className="cp-btn cp-copy" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
