"use client";

// components/IconPickerPanel.tsx — M3g 图标选择器
// 从 Material Symbols 全集里选图标 → 生成 res/drawable/ic_xxx.xml 矢量文件 → 写入布局属性
// 关键点：图标不是引用字体，而是真的生成 vector xml 资源，导出时一起打包，避免别处打开找不到图标。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadIconFont,
  getIconVector,
  iconResourceName,
  isIconFontLoaded,
} from "@/lib/xml/icon-vectors";

interface IconMeta {
  /** 图标名（也是 Material Symbols 的 ligature 文本） */
  n: string;
  /** 热度（越大越常用），仅用于排序 */
  p: number;
  /** 关键词，用于搜索 */
  t: string;
}

interface Props {
  /** 当前属性值，如 @drawable/ic_search */
  value: string;
  /** 正在编辑的属性名（用于文案） */
  attrName: string;
  /** 已经生成过的图标资源名（显示标记，避免重复生成） */
  existing: string[];
  onClose: () => void;
  /** 选中：资源名（ic_search）+ vector xml 原文 */
  onPick: (resourceName: string, vectorXml: string, iconName: string) => void;
}

const SHOWN = 120;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function IconPickerPanel({ value, attrName, existing, onClose, onPick }: Props) {
  const [icons, setIcons] = useState<IconMeta[] | null>(null);
  const [fontReady, setFontReady] = useState(isIconFontLoaded());
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string>("");
  const gridRef = useRef<HTMLDivElement>(null);

  // 加载图标索引（本地静态 json，离线可用）
  useEffect(() => {
    let alive = true;
    fetch(`${basePath}/material-symbols.json`)
      .then((r) => r.json())
      .then((d: IconMeta[]) => alive && setIcons(d))
      .catch(() => alive && setErr("图标列表加载失败（material-symbols.json）"));
    return () => {
      alive = false;
    };
  }, []);

  // 按需解析 TTF（1.2MB，本地文件，只解析一次）
  useEffect(() => {
    if (isIconFontLoaded()) {
      setFontReady(true);
      return;
    }
    let alive = true;
    loadIconFont(`${basePath}/material-symbols-rounded.ttf`)
      .then(() => alive && setFontReady(true))
      .catch(() => alive && setErr("图标字体解析失败（material-symbols-rounded.ttf）"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const list = useMemo(() => {
    if (!icons) return [];
    const raw = q.trim().toLowerCase();
    if (!raw) {
      // 无搜索时按热度排（p 越大越常用）
      return [...icons].sort((a, b) => b.p - a.p).slice(0, SHOWN);
    }
    const key = raw.replace(/\s+/g, "_");
    const starts: IconMeta[] = [];
    const rest: IconMeta[] = [];
    for (const i of icons) {
      if (i.n.startsWith(key)) starts.push(i);
      else if (i.n.includes(key) || i.t.includes(raw)) rest.push(i);
      if (starts.length + rest.length >= SHOWN * 2) break;
    }
    return [...starts, ...rest].slice(0, SHOWN);
  }, [icons, q]);

  const pick = (iconName: string) => {
    const xml = getIconVector(iconName);
    if (!xml) {
      setErr(`「${iconName}」没有可用字形，无法生成 vector`);
      return;
    }
    onPick(iconResourceName(iconName), xml, iconName);
  };

  const currentName = value.replace(/^@(?:drawable|mipmap)\//, "").replace(/\.xml$/, "");

  return (
    <div
      className="axv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-modal axv-icon-modal" role="dialog" aria-label="选择图标">
        <div className="axv-modal-head">
          <span>选择图标 · {attrName}</span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="axv-icon-search">
          <span className="msr" aria-hidden style={{ fontSize: 20, opacity: 0.6 }}>
            search
          </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={icons ? "搜索图标名 / 关键词（如 arrow、user、check）" : "加载中…"}
            spellCheck={false}
          />
          {q ? (
            <button className="axv-icon-btn" onClick={() => setQ("")} title="清空">
              ✕
            </button>
          ) : null}
        </div>

        {err ? <div className="axv-icon-err">{err}</div> : null}

        <div className="axv-icon-grid" ref={gridRef}>
          {!icons || !fontReady ? (
            <div className="axv-icon-empty">
              <span className="msr" aria-hidden style={{ fontSize: 22 }}>
                hourglass_top
              </span>
              {icons ? "正在解析图标字体…" : "正在加载图标列表…"}
            </div>
          ) : list.length === 0 ? (
            <div className="axv-icon-empty">
              <span className="msr" aria-hidden style={{ fontSize: 22 }}>
                search_off
              </span>
              没有匹配的图标
            </div>
          ) : (
            list.map((i) => {
              const rn = iconResourceName(i.n);
              const isCur = rn === currentName;
              const isDup = existing.includes(rn);
              return (
                <button
                  key={i.n}
                  className={"axv-icon-cell" + (isCur ? " is-current" : "") + (isDup ? " is-dup" : "")}
                  title={`${i.n}${isDup ? "（已生成，复用同一个文件）" : ""}`}
                  onClick={() => pick(i.n)}
                >
                  <span className="msr" aria-hidden>
                    {i.n}
                  </span>
                  <span className="axv-icon-name">{i.n}</span>
                  {isCur ? <span className="axv-icon-badge">当前</span> : null}
                </button>
              );
            })
          )}
        </div>

        <div className="axv-icon-foot">
          <span>
            选中后生成 <code>res/drawable/ic_xxx.xml</code>，属性写成 <code>@drawable/ic_xxx</code>
          </span>
          <button className="axv-btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
