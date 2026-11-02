"use client";
// components/IconPickerPanel.tsx — M88：多图标库选择弹窗（移植自 svg-board iconModal）
// tab：Material（235 实心）/ Lucide（2015）/ Tabler（5203）/ 几何（16）+ 粘贴 SVG
// Lucide/Tabler 走 gzip+base64 懒解压（首次 80~250ms），几何永远可用。
// 单击图标 = 替换整块画布；双击 / 底部按钮 = 追加成新图层。
import * as React from "react";
import { ICON_MATERIAL, ICON_BUILTIN, ICON_CATS, decompressIconSet, type IconItem } from "@/lib/xml/icon-libs";
import { parsePastedSvg } from "@/lib/xml/svg-paste";
import { scalePath, translateShape, type DrawShape } from "@/lib/xml/canvas-shapes";
import { iconToShapes } from "@/lib/xml/icon-to-shapes";

type TabKey = "material" | "lucide" | "tabler" | "geo" | "paste";

const TAB_LABELS: Array<[TabKey, string]> = [
  ["material", "Material"],
  ["lucide", "Lucide"],
  ["tabler", "Tabler"],
  ["geo", "几何"],
  ["paste", "粘贴 SVG"],
];

let seq = 0;
const nextId = () => `ic${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 24x24 图标 → 当前视口里的 path 图形（等比缩放 + 居中，留 10% 边距） */
export interface IconPickerPanelProps {
  /** 替换：整块画布换成这个图标 */
  onPick: (shapes: DrawShape[]) => void;
  /** 模式：replace = 单击替换整块画布；insert = 单击追加为新图层 */
  mode?: "replace" | "insert";
  /** 取消 */
  onClose: () => void;
  /** 当前画布视口（粘贴 SVG 归一化用） */
  viewport: { vw: number; vh: number };
  /** 弹窗标题 */
  title?: string;
}

export function IconPickerPanel({ onPick, onClose, viewport, title = "图标库", mode = "replace" }: IconPickerPanelProps) {
  const [tab, setTab] = React.useState<TabKey>("material");
  const [cat, setCat] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [lazy, setLazy] = React.useState<Partial<Record<"lucide" | "tabler", IconItem[]>>>({});
  const [err, setErr] = React.useState("");
  const [paste, setPaste] = React.useState("");
  const [pasteErr, setPasteErr] = React.useState("");

  // 切到懒加载库时首次解压（结果缓存，来回切 tab 不再解）
  React.useEffect(() => {
    if (tab !== "lucide" && tab !== "tabler") return;
    if (lazy[tab]) return;
    let alive = true;
    const p = decompressIconSet(tab);
    if (!p) {
      setErr("当前环境不支持 gzip 解压，该图标库不可用");
      return;
    }
    p.then((arr) => {
      if (alive) setLazy((prev) => ({ ...prev, [tab]: arr }));
    }).catch(() => {
      if (alive) setErr("图标库解压失败（可能是浏览器不支持 DecompressionStream）");
    });
    return () => {
      alive = false;
    };
  }, [tab, lazy]);

  const pool: IconItem[] =
    tab === "material" ? ICON_MATERIAL : tab === "geo" ? ICON_BUILTIN : lazy[tab as "lucide" | "tabler"] ?? [];
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

  const pick = (it: IconItem) => onPick(iconToShapes(it, viewport.vw, viewport.vh));

  const parsedPaste = () => {
    const parts = parsePastedSvg(paste);
    if (!parts) {
      setPasteErr("没解析出任何图形（支持 path / circle / ellipse / rect / line / polygon / polyline）");
      return null;
    }
    setPasteErr("");
    // 源 SVG 视口 → 当前画布视口等比缩放
    const src = parts[0];
    const k = Math.min(viewport.vw / src.vw, viewport.vh / src.vh) * 0.9;
    const ox = (viewport.vw - src.vw * k) / 2;
    const oy = (viewport.vh - src.vh * k) / 2;
    return parts.map((p) => {
      const { vw: _vw, vh: _vh, ...rest } = p;
      const sh = { ...rest, id: nextId() } as DrawShape;
      const sc =
        sh.type === "path"
          ? { ...sh, d: scalePath(sh.d, k, k, 0, 0), strokeWidth: sh.strokeWidth * k }
          : (scaleShapeLite(sh, k) as DrawShape);
      return translateShape(sc, ox, oy);
    });
  };

  const doPaste = (kind: "replace" | "insert") => {
    const shapes = parsedPaste();
    if (!shapes) return;
    onPick(shapes);
    void kind;
    setPaste("");
  };

  return (
    <div
      className="axv-cp-mask"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-cp axv-iconlib" role="dialog" aria-label={title} aria-modal="true">
        <div className="cp-header">
          <div className="cp-title">
            <span className="msr" aria-hidden>
              apps
            </span>
            {title}
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
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" ? (
          <div className="axv-iconlib-paste">
            <p className="axv-iconlib-hint">
              粘贴 SVG 源码（支持 path / circle / ellipse / rect / line / polygon / polyline），会转成可编辑图元。
            </p>
            <textarea
              className="axv-iconlib-ta"
              placeholder={"<svg viewBox='0 0 24 24'><path d='M4 12l5 5L20 6'/></svg>"}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            {pasteErr ? <p className="axv-iconlib-err">{pasteErr}</p> : null}
            <div className="axv-iconlib-foot">
              <button type="button" className="cp-btn cp-copy" onClick={onClose}>
                取消
              </button>
              <button type="button" className="cp-btn cp-confirm" onClick={() => doPaste(mode)}>
                {mode === "insert" ? "插入画布" : "替换画布"}
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
            {err ? <p className="axv-iconlib-err">{err}</p> : null}
            {loading ? (
              <p className="axv-iconlib-hint">正在解压 {tab} …（首次约 100~250ms）</p>
            ) : null}
            {!loading && !err ? (
              <div className="axv-iconlib-grid">
                {list.slice(0, 300).map((it, i) => (
                  <button
                    key={it.n + i}
                    type="button"
                    className="axv-iconlib-cell"
                    title={it.n}
                    onClick={() => pick(it)}
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
                    <span>{it.n}</span>
                  </button>
                ))}
                {!list.length ? <p className="axv-iconlib-hint">没有匹配「{q}」的图标</p> : null}
              </div>
            ) : null}
            <div className="axv-iconlib-foot">
              <span className="axv-iconlib-count">
                共 {list.length} 个 · {mode === "insert" ? "单击插入为图层" : "单击替换画布"}
              </span>
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

/** 非 path 图元的等比缩放（rect/circle/ellipse/line 各自换算） */
function scaleShapeLite(s: DrawShape, k: number): DrawShape {
  const c = { ...s };
  switch (c.type) {
    case "rect":
    case "roundRect":
      c.x *= k;
      c.y *= k;
      c.w *= k;
      c.h *= k;
      if (c.round) c.round *= k;
      break;
    case "circle":
      c.cx *= k;
      c.cy *= k;
      c.r *= k;
      break;
    case "ellipse":
      c.cx *= k;
      c.cy *= k;
      c.rx *= k;
      c.ry *= k;
      break;
    case "line":
      c.x1 *= k;
      c.y1 *= k;
      c.x2 *= k;
      c.y2 *= k;
      break;
    case "polygon":
    case "star":
      c.cx *= k;
      c.cy *= k;
      c.r *= k;
      break;
    case "text":
      c.x *= k;
      c.y *= k;
      c.size *= k;
      break;
    default:
      break;
  }
  c.strokeWidth *= k;
  return c;
}
