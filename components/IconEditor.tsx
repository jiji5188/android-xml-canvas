"use client";

// components/IconEditor.tsx — M11j：生成的图标（vector drawable）编辑器
// 可改：尺寸 dp、填充色（全部 / 单条）、fillAlpha、pathData、旋转 / 镜像、增删 path，
// 以及「选择图标」直接换字形（保留名字与尺寸）。
// 布局与形状编辑器一致：整页全屏（.axv-icon-page），不是小弹窗。

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buildVectorXml, parseVectorModel, nextRotation } from "@/lib/xml/vector-edit";
import type { VectorModel } from "@/lib/xml/vector-edit";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { IconPickerPanel } from "./IconPickerPanel";

interface Props {
  name: string;
  /** vector xml 原文；空字符串 / undefined = 新建一个空图标（从图标库选字形） */
  xml?: string;
  onClose: () => void;
  onSave: (name: string, xml: string) => void;
  /** 已占用的资源名（防止改名撞车 / 给图标选择器打「已生成」标记） */
  existingNames?: string[];
}

const PRESET_COLORS = ["#1D1B20", "#04409F", "#B3261E", "#1F7A3D", "#F5A524", "#6B7280"];

/** 新建 / 空内容时的占位图形：24dp 圆角方块 */
const BLANK_MODEL: VectorModel = {
  w: 24,
  h: 24,
  vw: 24,
  vh: 24,
  group: { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 12, pivotY: 12 },
  paths: [{ d: "M5 5h14v14H5z", fill: "#1D1B20" }],
};

/** M11p：判断传进来的内容到底是什么，防止把普通图片当图标改 */
function inspect(xml?: string): "vector" | "bitmap" | "other-xml" | "empty" {
  const s = (xml ?? "").trim();
  if (!s) return "empty";
  if (/^data:image\//i.test(s) || /^\/9j\//.test(s) || /^iVBOR/.test(s)) return "bitmap";
  if (/<vector[\s>]/.test(s)) return "vector";
  if (!s.startsWith("<")) return "bitmap";
  return "other-xml";
}

export default function IconEditor({ name, xml, onClose, onSave, existingNames = [] }: Props) {
  const kind = useMemo(() => inspect(xml), [xml]);
  const initial = useMemo(() => parseVectorModel(xml ?? ""), [xml]);
  const [model, setModel] = useState<VectorModel | null>(initial ?? (kind === "empty" ? BLANK_MODEL : null));
  const [resName, setResName] = useState(name);
  const [activePath, setActivePath] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState("");

  // 解析失败（不是标准 vector）：说清楚原因，并给「改为从图标库选」的退路
  if (!model) {
    const msg =
      kind === "bitmap"
        ? "这是普通图片（png / jpg 等位图），不是矢量图标 —— 图标编辑器只能改 <vector> 资源。位图请直接用图片资源，或点下面的按钮从图标库重新选一个。"
        : "这个文件不是标准 <vector>，暂时只能原样查看。可以点下面的按钮改用图标库里的字形。";
    const body = (
      <div className="axv-icon-page" role="dialog" aria-label="图标编辑器">
        <div className="axv-shape-head">
          <button className="axv-shape-back" onClick={onClose} aria-label="返回编辑器">
            <span className="msr" aria-hidden="true">arrow_back</span>
          </button>
          <span className="axv-shape-title">编辑图标 · {name}</span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="axv-icon-page-body">
          <div className="axv-icon-ed-form">
            <div className="axv-icon-ed-warn">
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>warning</span>
              <span>{msg}</span>
            </div>
            <div className="axv-icon-ed-btns">
              <button
                className="axv-btn axv-btn-primary"
                onClick={() => {
                  setModel(BLANK_MODEL);
                  setActivePath(0);
                }}
              >
                从图标库选一个
              </button>
              <button className="axv-btn axv-ghost" onClick={onClose}>
                关闭
              </button>
            </div>
            {xml ? <textarea className="axv-icon-ed-raw" readOnly value={xml} /> : null}
          </div>
        </div>
      </div>
    );
    return typeof document === "undefined" ? body : createPortal(body, document.body);
  }

  const preview = vectorToDataUrl(buildVectorXml(model, resName)) || "";

  const patch = (p: Partial<VectorModel>) => setModel((m) => (m ? { ...m, ...p } : m));
  const patchGroup = (g: Partial<VectorModel["group"]>) =>
    setModel((m) => (m ? { ...m, group: { ...m.group, ...g } } : m));
  const patchPath = (i: number, p: Partial<VectorModel["paths"][number]>) =>
    setModel((m) => {
      if (!m) return m;
      const paths = m.paths.map((it, idx) => (idx === i ? { ...it, ...p } : it));
      return { ...m, paths };
    });

  const applyColorToAll = (color: string) =>
    setModel((m) => (m ? { ...m, paths: m.paths.map((p) => ({ ...p, fill: color })) } : m));

  /** 从图标选择器换字形：只替换路径与视口，尺寸 / 旋转 / 颜色沿用当前的 */
  const applyIcon = (vectorXml: string) => {
    const src = parseVectorModel(vectorXml);
    setPicking(false);
    if (!src) return;
    setModel((m) => {
      if (!m) return m;
      const keepFill = m.paths[0]?.fill;
      return {
        ...m,
        vw: src.vw,
        vh: src.vh,
        group: { ...m.group, pivotX: src.vw / 2, pivotY: src.vh / 2 },
        paths: src.paths.map((p) => ({
          ...p,
          fill: keepFill ?? p.fill,
          alpha: m.paths[0]?.alpha,
        })),
      };
    });
    setActivePath(0);
  };

  const save = () => {
    const safe = resName.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    if (!safe) {
      setErr("资源名不能为空");
      return;
    }
    if (safe !== name && existingNames.includes(safe)) {
      setErr(`已存在同名资源 ${safe}`);
      return;
    }
    onSave(safe, buildVectorXml(model, safe));
  };

  const cur = model.paths[activePath] ?? model.paths[0];

  const body = (
    <div className="axv-icon-page" role="dialog" aria-label="图标编辑器">
      <div className="axv-shape-head">
        <button className="axv-shape-back" onClick={onClose} aria-label="返回编辑器">
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">编辑图标 · {name}</span>
        <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <div className="axv-icon-page-body">
        {/* 左：预览 */}
        <div className="axv-icon-ed-preview">
          <div className="axv-icon-ed-canvas">
            {preview ? <img src={preview} alt="" draggable={false} /> : null}
          </div>
          <div className="axv-icon-ed-meta">
            {model.w}×{model.h}dp · viewport {model.vw}×{model.vh}
          </div>
        </div>

        {/* 右：参数 */}
        <div className="axv-icon-ed-form">
          {kind === "empty" ? (
            <div className="axv-icon-ed-warn">
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>info</span>
              <span>当前还没有图标内容，点「选择图标」从图标库挑一个字形，或直接在下面改路径。</span>
            </div>
          ) : null}
          <div className="axv-set-group">
            <div className="axv-set-label">资源</div>
            <div className="axv-icon-ed-row">
              <span>名称</span>
              <input
                className="axv-icon-ed-input"
                value={resName}
                onChange={(e) => {
                  setResName(e.target.value);
                  setErr("");
                }}
              />
              <button className="axv-icon-ed-pick" onClick={() => setPicking(true)}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>apps</span>
                选择图标
              </button>
            </div>
            <label className="axv-icon-ed-row">
              <span>尺寸（dp）</span>
              <span className="axv-icon-ed-two">
                <input
                  className="axv-icon-ed-input"
                  type="number"
                  min={1}
                  value={model.w}
                  onChange={(e) => patch({ w: Number(e.target.value) || 1 })}
                />
                <input
                  className="axv-icon-ed-input"
                  type="number"
                  min={1}
                  value={model.h}
                  onChange={(e) => patch({ h: Number(e.target.value) || 1 })}
                />
              </span>
            </label>
            {err ? <div className="axv-icon-ed-err">{err}</div> : null}
          </div>

          <div className="axv-set-group">
            <div className="axv-set-label">填充颜色</div>
            <div className="axv-icon-ed-swatches">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className="axv-icon-ed-swatch"
                  style={{ background: c }}
                  title={`全部填充 ${c}`}
                  onClick={() => applyColorToAll(c)}
                />
              ))}
              <input
                type="color"
                className="axv-icon-ed-color"
                value={toHex(cur?.fill ?? "#1D1B20")}
                onChange={(e) => patchPath(activePath, { fill: e.target.value })}
                title="当前 path 颜色"
              />
            </div>
            <div className="axv-set-hint">
              点色块 = 全部 path 统一上色；右边取色器只改当前 path（{activePath + 1}/{model.paths.length}）
            </div>
            <label className="axv-icon-ed-row">
              <span>不透明度</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cur?.alpha ?? 1}
                onChange={(e) => patchPath(activePath, { alpha: Number(e.target.value) })}
              />
              <b className="axv-icon-ed-val">{Math.round((cur?.alpha ?? 1) * 100)}%</b>
            </label>
          </div>

          <div className="axv-set-group">
            <div className="axv-set-label">变换</div>
            <div className="axv-icon-ed-btns">
              <button
                className="axv-set-btn"
                onClick={() => patchGroup({ rotation: nextRotation(model.group.rotation) })}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>rotate_90_degrees_cw</span>
                旋转 {model.group.rotation}°
              </button>
              <button
                className={"axv-set-btn" + (model.group.scaleX === -1 ? " on" : "")}
                onClick={() => patchGroup({ scaleX: model.group.scaleX === -1 ? 1 : -1 })}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>
                水平镜像
              </button>
              <button
                className={"axv-set-btn" + (model.group.scaleY === -1 ? " on" : "")}
                onClick={() => patchGroup({ scaleY: model.group.scaleY === -1 ? 1 : -1 })}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>
                垂直镜像
              </button>
            </div>
            <div className="axv-set-hint">只在编辑器和画布里生效，导出就是标准 &lt;group&gt; 变换。</div>
          </div>

          <div className="axv-set-group">
            <div className="axv-set-label">
              路径（{model.paths.length}）
              <button
                className="axv-icon-ed-mini"
                onClick={() => {
                  const src = model.paths[model.paths.length - 1];
                  setModel((m) =>
                    m
                      ? {
                          ...m,
                          paths: [
                            ...m.paths,
                            { d: src?.d ?? "M0 0h24v24H0z", fill: src?.fill ?? "#1D1B20" },
                          ],
                        }
                      : m
                  );
                  setActivePath(model.paths.length);
                }}
              >
                ＋ 复制一条
              </button>
            </div>
            <div className="axv-icon-ed-paths">
              {model.paths.map((p, i) => (
                <div
                  key={i}
                  className={"axv-icon-ed-path" + (i === activePath ? " on" : "")}
                  onClick={() => setActivePath(i)}
                >
                  <span className="axv-icon-ed-swatch" style={{ background: toHex(p.fill) }} />
                  <span className="axv-icon-ed-d">{p.d.slice(0, 42)}…</span>
                  {model.paths.length > 1 ? (
                    <button
                      className="axv-icon-ed-del"
                      title="删除这条 path"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModel((m) =>
                          m ? { ...m, paths: m.paths.filter((_, idx) => idx !== i) } : m
                        );
                        setActivePath(0);
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {cur ? (
              <textarea
                className="axv-icon-ed-pathdata"
                value={cur.d}
                spellCheck={false}
                onChange={(e) => patchPath(activePath, { d: e.target.value })}
                placeholder="pathData，例如 M12 2 L22 20 H2 Z"
              />
            ) : null}
          </div>

          <div className="axv-set-group">
            <button className="axv-set-btn" onClick={() => setShowRaw((v) => !v)}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
              {showRaw ? "收起 XML" : "查看生成的 XML"}
            </button>
            {showRaw ? (
              <textarea className="axv-icon-ed-raw" readOnly value={buildVectorXml(model, resName)} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>保存后立即写回 drawable/{resName}.xml，布局里所有引用同步生效。</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={onClose}>
            取消
          </button>
          <button className="axv-btn" onClick={save}>
            保存
          </button>
        </span>
      </div>

      {/* 换字形：图标选择器叠在全页之上 */}
      {picking ? (
        <IconPickerPanel
          value={`@drawable/${resName}`}
          attrName="编辑图标"
          existing={existingNames}
          onClose={() => setPicking(false)}
          onPick={(_rn, vectorXml) => applyIcon(vectorXml)}
        />
      ) : null}
    </div>
  );

  return typeof document === "undefined" ? body : createPortal(body, document.body);
}

/** #AARRGGBB / #RRGGBB → #rrggbb（input[type=color] 只认 6 位） */
function toHex(v: string): string {
  const s = v.trim();
  const m = /^#([0-9a-fA-F]{8})$/.exec(s);
  if (m) return "#" + m[1].slice(2).toLowerCase();
  const m3 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m3) return "#" + m3[1].toLowerCase();
  return "#1d1b20";
}
