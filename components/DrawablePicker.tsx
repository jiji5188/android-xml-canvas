"use client";

// components/DrawablePicker.tsx — M4b：background 等属性的「资源选择对话框」
// 一个输入框（显示资源 ID，即属性值本身）+ 一个「选择」按钮，点击弹出本对话框。
// 对话框内四个入口：
//   🎨 颜色：取色器 + 预设色板 → 直接写 #hex
//   🖼 图片/xml 资源：已上传的 res/drawable（位图 + xml 矢量 + shape）列表 → 写 @drawable/name
//   ⬛ 编辑/创建 xml 形状：打开全屏 ShapeEditor（选已有资源 = 编辑，新名字 = 创建）
//   📦 图标：弹 IconPickerPanel（Material Symbols → 生成 vector drawable）

import { useEffect, useMemo, useState } from "react";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { isValidResName } from "@/lib/xml/resname";

interface DrawableItem {
  name: string;
  kind: "xml" | "png" | "vector";
  /** xml 资源的全文（drawableXml 或 generatedXml） */
  xml?: string;
}

interface Props {
  /** 属性名（background / foreground / src …） */
  attrName: string;
  /** 当前属性值（资源 ID / #hex / 其他） */
  value: string;
  /** 已上传 res 的 drawable：名 → dataURL（png 等） */
  bitmapDrawables?: Record<string, string>;
  /** 已上传 res 的 xml drawable：名 → 全文 */
  xmlDrawables?: Record<string, string>;
  /** 本工具生成的 drawable（图标 vector / 自定义形状）：名 → 全文 */
  generatedXml?: Record<string, string>;
  /** 打开形状编辑器（全屏）。existingXml = 选中的 xml 资源全文（编辑用），undefined = 新建 */
  onEditShape: (existingXml?: string) => void;
  /** 直接弹图标选择器（M3g 已有面板） */
  onPickIcon?: () => void;
  /** 选中的值写回属性 */
  onCommit: (value: string) => void;
  /** true = 图片类属性（src / icon / drawableStart …）：drawable 不认纯色，
   *  所以不提供「颜色」tab（纯色写进 src 在画布上是空白） */
  imageOnly?: boolean;
  onClose: () => void;
}

const SWATCHES = [
  "#FFFFFF", "#F5F5F5", "#EEEEEE", "#E0E0E0", "#BDBDBD", "#9E9E9E",
  "#616161", "#424242", "#212121", "#000000", "#7C4DFF", "#448AFF",
  "#00B0FF", "#00C853", "#FFAB00", "#FF5252", "#FF4081", "#B388FF",
];

export function DrawablePicker({
  attrName,
  value,
  bitmapDrawables,
  xmlDrawables,
  generatedXml,
  onEditShape,
  onPickIcon,
  onCommit,
  imageOnly,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"color" | "res" | "shape" | "icon">(imageOnly ? "res" : "color");
  const [filter, setFilter] = useState("");
  /** 资源 ID 输入框草稿（不与属性实时同步，回车/失焦才写回，避免污染 XML） */
  const [idDraft, setIdDraft] = useState(value);
  useEffect(() => setIdDraft(value), [value]);
  const idError = validateAttrValue(idDraft);

  const items = useMemo<DrawableItem[]>(() => {
    const out: DrawableItem[] = [];
    for (const [name, url] of Object.entries(bitmapDrawables ?? {})) {
      out.push({ name, kind: "png" });
    }
    for (const [name, xml] of Object.entries(xmlDrawables ?? {})) {
      out.push({ name, kind: "xml", xml });
    }
    for (const [name, xml] of Object.entries(generatedXml ?? {})) {
      out.push({ name, kind: "vector", xml });
    }
    // 上传与生成的同名：generated 覆盖（更新）
    const byName = new Map<string, DrawableItem>();
    for (const it of out) byName.set(it.name, it);
    const uniq = Array.from(byName.values());
    const f = filter.trim().toLowerCase();
    uniq.sort((a, b) => a.name.localeCompare(b.name));
    return f ? uniq.filter((x) => x.name.toLowerCase().includes(f)) : uniq;
  }, [bitmapDrawables, xmlDrawables, generatedXml, filter]);

  const previewUrl = (it: DrawableItem) => {
    if (it.kind === "png") return (bitmapDrawables ?? {})[it.name];
    if (it.xml) {
      try {
        return vectorToDataUrl(it.xml);
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
  const colorVal = toHex6(value);
  /** 只有「形状类」xml 才能进形状编辑器（vector 是画出来的一次性资源） */
  const isShapeXml = (xml?: string) => !!xml && /<\s*(shape|ripple|selector|layer-list|inset)\b/.test(xml);

  /** 当前值指向的 xml 资源（若是形状类，编辑时回填参数） */
  const currentShapeXml = () => {
    const name = value.replace(/^@(?:drawable|mipmap)\//, "").replace(/\.xml$/, "");
    const xml = value.startsWith("@") ? (generatedXml?.[name] ?? xmlDrawables?.[name]) : undefined;
    return isShapeXml(xml) ? xml : undefined;
  };

  return (
    <div
      className="axv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-modal axv-dp-modal" role="dialog" aria-label="选择背景资源">
        <div className="axv-modal-head">
          <span>
            {attrName} · 选择资源
            {isHex ? <code className="axv-dp-cur"> {value}</code> : null}
          </span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 资源 ID 行：输入框 + 校验（Android 资源名只能 a-z0-9_，颜色不能当文件名） */}
        <div className="axv-dp-idrow">
          <code className="axv-dp-idlabel">@drawable/ 或 #hex</code>
          <input
            className={"axv-attr-input axv-dp-id" + (idError ? " is-bad" : "")}
            value={idDraft}
            placeholder="@drawable/bg_card 或 #FFFFFF"
            spellCheck={false}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={() => {
              if (!idError && idDraft.trim() !== value) onCommit(idDraft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!idError && idDraft.trim() !== value) onCommit(idDraft.trim());
                onClose();
              }
            }}
          />
        </div>
        {idError ? <div className="axv-dp-iderr">⛔ {idError}</div> : null}

        <div className="axv-dp-tabs">
          {(
            [
              ...(imageOnly ? [] : ([ ["color", "🎨 颜色"] ] as const)),
              ["res", `🖼 图片/XML 资源（${Object.keys(bitmapDrawables ?? {}).length + Object.keys(xmlDrawables ?? {}).length + Object.keys(generatedXml ?? {}).length}）`],
              ["shape", "⬛ 编辑/创建 XML 形状"],
              ["icon", "📦 图标生成"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={"axv-dp-tab" + (tab === k ? " is-on" : "")} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        <div className="axv-dp-body">
          {tab === "color" ? (
            <div className="axv-dp-color">
              <div className="axv-dp-pickrow">
                <input
                  type="color"
                  value={colorVal}
                  onChange={(e) => onCommit(withAlphaLike(e.target.value, value))}
                />
                <span className="axv-dp-hint">选完直接写回；带透明度的值会保留原 alpha</span>
              </div>
              <div className="axv-dp-swatch-grid">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={"axv-dp-swatch" + (value.toUpperCase() === c ? " is-on" : "")}
                    style={{ background: c }}
                    title={c}
                    onClick={() => onCommit(c)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {tab === "res" ? (
            <div className="axv-dp-res">
              {items.length === 0 ? (
                <div className="axv-dp-empty">
                  没有可选资源。先在左侧「资源」里上传 res/ 目录（含 drawable/），或用下面两个 tab 生成一个。
                </div>
              ) : (
                <>
                  <input
                    className="axv-attr-input axv-dp-search"
                    placeholder={`搜索 ${Object.keys(bitmapDrawables ?? {}).length + Object.keys(xmlDrawables ?? {}).length + Object.keys(generatedXml ?? {}).length} 个 drawable…`}
                    value={filter}
                    spellCheck={false}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <div className="axv-dp-res-list">
                    {items.map((it) => {
                      const url = previewUrl(it);
                      const sel = value === `@drawable/${it.name}`;
                      return (
                        <button
                          key={it.name}
                          className={"axv-dp-res-item" + (sel ? " is-on" : "")}
                          onClick={() => onCommit(`@drawable/${it.name}`)}
                        >
                          <span className="axv-dp-res-thumb">
                            {url ? (
                              <img src={url} alt="" />
                            ) : (
                              <span className="msr">{it.kind === "xml" ? "auto_awesome" : "image"}</span>
                            )}
                          </span>
                          <span className="axv-dp-res-meta">
                            <code>{it.name}</code>
                            <small>{it.kind === "png" ? "位图" : it.kind === "vector" ? "vector（本工具生成）" : "xml drawable"}</small>
                          </span>
                          <span className="axv-dp-res-kind">
                            {isShapeXml(it.xml) ? (
                              <a className="axv-dp-editlink" title="打开形状编辑器修改" onClick={(e) => { e.stopPropagation(); onEditShape(it.xml!); }}>
                                编辑
                              </a>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === "shape" ? (
            <div className="axv-dp-shape">
              <p className="axv-dp-hint">
                新建一个 <code>&lt;shape&gt;</code> / <code>&lt;ripple&gt;</code> 资源（圆角、描边、渐变、水波纹、按下态、阴影），保存后自动写回本属性。
                若当前值已是本工具生成的资源，可直接在上面「图片/XML 资源」里点「编辑」修改。
              </p>
              <button className="axv-btn axv-btn-primary" onClick={() => onEditShape(currentShapeXml())}>
                ⬛ 打开形状编辑器
              </button>
            </div>
          ) : null}

          {tab === "icon" ? (
            <div className="axv-dp-shape">
              <p className="axv-dp-hint">从 Material Symbols 生成一个 24dp 图标 vector（离线 TTF，导出 res 包时一并带走）。</p>
              {onPickIcon ? (
                <button className="axv-btn axv-btn-primary" onClick={onPickIcon}>
                  📦 打开图标选择器
                </button>
              ) : (
                <button className="axv-btn" disabled>
                  图标选择器需要工具栏入口（未接入）
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 校验属性值：颜色 或 @drawable|mipmap/合法名 或 @color/合法名，其余报错
 *  （尤其别让 #00C853 这种当成文件名——aapt 会报 “invalid resource name”） */
function validateAttrValue(v: string): string | null {
  const s = v.trim();
  if (!s) return null; // 空值 = 没设，允许
  if (/^#(?:[0-9a-fA-F]{3,8})$/.test(s)) return null;
  if (/^\?(?:attr|android:attr)\//.test(s)) return null;
  const m = /^@(?:android:)?([a-z]+)\/(.+)$/.exec(s);
  if (!m) return "格式应为 #RRGGBB、@drawable/名字 或 @color/名字";
  const [, kind, rawName] = m;
  const name = rawName.replace(/\.xml$/, "");
  if (!isValidResName(name)) {
    return `资源名 “${name}” 不合法：只能用小写字母、数字、下划线，且不能以数字开头（颜色请直接填 #RRGGBB）`;
  }
  return kind === "drawable" || kind === "mipmap" || kind === "color" ? null : null;
}

/** #AARRGGBB / #RRGGBB / #RGB → input[type=color] 需要的 #RRGGBB */
function toHex6(v: string): string {
  const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
  if (!m) return "#FFFFFF";
  const h = m[1];
  if (h.length === 6) return "#" + h;
  if (h.length === 8) return "#" + h.slice(2); // Android 是 AARRGGBB
  if (h.length === 3) return "#" + h.split("").map((c) => c + c).join("");
  return "#FFFFFF";
}

/** 取色器只给不透明色：若原值是 AARRGGBB 就保留原 alpha */
function withAlphaLike(picked: string, prev: string): string {
  const m = /^#([0-9a-f]{8})$/i.exec((prev || "").trim());
  const rgb = picked.replace("#", "").toUpperCase();
  return m ? "#" + m[1].slice(0, 2) + rgb : "#" + rgb;
}
