"use client";
// components/IconResPicker.tsx — M88：资源对话框里的「图标资源」选择器
// 选中图标 → 返回 (资源名, <vector> xml, 原图标名)，由调用方写入 res/drawable。
// M89k：把 svg-board 那套图标库弹窗完整搬进来（分类二级筛选 + 分页 + 粘贴 SVG），
// 与画布编辑器里的 IconPickerPanel 同为 .axv-cp.axv-iconlib 外壳。
import * as React from "react";
import {
  ICON_MATERIAL,
  ICON_BUILTIN,
  ICON_CATS,
  decompressIconSet,
  type IconItem,
} from "@/lib/xml/icon-libs";
import { parsePastedSvg } from "@/lib/xml/svg-paste";
import {
  scalePath,
  scaleShapeLite,
  shapesToModel,
  translateShape,
  type DrawShape,
} from "@/lib/xml/canvas-shapes";
import { buildVectorXml } from "@/lib/xml/vector-edit";
import { isValidResName } from "@/lib/xml/resname";

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

type Tab = "material" | "lucide" | "tabler" | "geo" | "paste";

const TAB_LABELS: Array<[Tab, string]> = [
  ["material", "Material"],
  ["lucide", "Lucide"],
  ["tabler", "Tabler"],
  ["geo", "几何"],
  ["paste", "粘贴 SVG"],
];

/** 每页图标数（svg-board 是 24，这里带名字，48 少翻几页） */
const ICON_PAGE = 48;

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
  const [cat, setCat] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [lazy, setLazy] = React.useState<Partial<Record<"lucide" | "tabler", IconItem[]>>>({});
  const [err, setErr] = React.useState("");
  const [paste, setPaste] = React.useState("");
  const [resName, setResName] = React.useState("ic_icon");
  const [pasteErr, setPasteErr] = React.useState("");

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

  React.useEffect(() => setPage(1), [tab, cat, q]);

  const pool: IconItem[] =
    tab === "material"
      ? ICON_MATERIAL
      : tab === "geo"
        ? ICON_BUILTIN
        : lazy[tab as "lucide" | "tabler"] ?? [];
  const loading = (tab === "lucide" || tab === "tabler") && !lazy[tab] && !err;

  const list = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return pool.filter((it) => {
      if (cat !== "all" && it.c !== cat) return false;
      if (s && !it.n.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [pool, cat, q]);

  const cats = tab === "geo" ? ICON_CATS.filter(([k]) => k === "all" || k === "geo") : ICON_CATS;
  const pages = Math.max(1, Math.ceil(list.length / ICON_PAGE));
  const pg = Math.min(Math.max(1, page), pages);
  const pageItems = list.slice((pg - 1) * ICON_PAGE, pg * ICON_PAGE);

  /** 粘贴 SVG → 归一 24×24 视口 → <vector> xml（先缩放到 90% 再居中） */
  const doPaste = () => {
    const parts = parsePastedSvg(paste);
    if (!parts) {
      setPasteErr("没解析出任何图形（支持 path / circle / ellipse / rect / line / polygon / polyline）");
      return;
    }
    const nm = resName.trim().toLowerCase().replace(/\.xml$/, "");
    if (!isValidResName(nm)) {
      setPasteErr("资源名不合法：只能用小写字母、数字、下划线，且不能以数字开头");
      return;
    }
    const src = parts[0];
    const k = Math.min(24 / src.vw, 24 / src.vh) * 0.9;
    const ox = (24 - src.vw * k) / 2;
    const oy = (24 - src.vh * k) / 2;
    let n = 0;
    const shapes = parts.map((p) => {
      const { vw: _vw, vh: _vh, ...rest } = p;
      const sh = { ...rest, id: `p${n++}` } as DrawShape;
      const scaled =
        sh.type === "path"
          ? { ...sh, d: scalePath(sh.d, k, k, 0, 0), strokeWidth: sh.strokeWidth * k }
          : scaleShapeLite(sh, k);
      return translateShape(scaled, ox, oy);
    });
    const model = shapesToModel(shapes, {
      w: 24,
      h: 24,
      vw: 24,
      vh: 24,
      group: { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 12, pivotY: 12 },
    });
    onPick(nm, buildVectorXml(model, nm), nm);
    onClose();
  };

  return (
    <div
      className="axv-cp-mask"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="axv-cp axv-iconlib"
        role="dialog"
        aria-label={attrName ? `图标资源 · ${attrName}` : "图标资源"}
        aria-modal="true"
      >
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
          {TAB_LABELS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={"axv-iconlib-tab" + (tab === k ? " on" : "")}
              onClick={() => {
                setTab(k);
                setCat("all");
                setQ("");
                setErr("");
                setPasteErr("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" ? (
          <div className="axv-iconlib-paste">
            <p className="axv-iconlib-hint">
              把 SVG 源码整个粘进来（支持 path / circle / ellipse / rect / line / polygon / polyline），会转成 vector drawable。
            </p>
            <textarea
              className="axv-iconlib-ta"
              placeholder={"<svg viewBox='0 0 24 24'><path d='M4 12l5 5L20 6'/></svg>"}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="axv-iconlib-namerow">
              <span>资源名</span>
              <input
                value={resName}
                spellCheck={false}
                onChange={(e) => setResName(e.target.value)}
                placeholder="ic_custom"
              />
            </div>
            {pasteErr ? <p className="axv-iconlib-err">{pasteErr}</p> : null}
            <div className="axv-iconlib-foot">
              <button type="button" className="cp-btn cp-copy" onClick={onClose}>
                取消
              </button>
              <button type="button" className="cp-btn cp-confirm" onClick={doPaste}>
                保存并使用
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="axv-iconlib-chips">
              {cats.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={"axv-iconlib-chip" + (cat === k ? " on" : "")}
                  onClick={() => setCat(k)}
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
                {pageItems.map((it, i) => (
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
            {!loading && !err && list.length > ICON_PAGE ? (
              <div className="axv-iconlib-pager">
                <button type="button" disabled={pg <= 1} onClick={() => setPage(pg - 1)} title="上一页">
                  <span className="msr" aria-hidden>
                    chevron_left
                  </span>
                </button>
                <span>
                  {pg} / {pages} · 共 {list.length} 个
                </span>
                <button type="button" disabled={pg >= pages} onClick={() => setPage(pg + 1)} title="下一页">
                  <span className="msr" aria-hidden>
                    chevron_right
                  </span>
                </button>
              </div>
            ) : null}
            <div className="axv-iconlib-foot">
              <span className="axv-iconlib-count">共 {list.length} 个</span>
              <button type="button" className="cp-btn cp-copy" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
