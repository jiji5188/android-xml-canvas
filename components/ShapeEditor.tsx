"use client";

// components/ShapeEditor.tsx — M3h 自定义形状编辑器
// 调参数 → 生成 res/drawable/*.xml（<shape> / <ripple>），右侧实时预览（与画布同一套语义）。
// 渐变收在「高级」里，默认只露纯色 + 圆角 + 描边，避免面板一上来就吓人。

import { useEffect, useMemo, useState } from "react";
import {
  buildShapeXml,
  parseShapeSpec,
  shapeResourceName,
  specToCss,
  type GradientType,
  type ShapeKind,
  type ShapeSpec,
} from "@/lib/xml/shape-gen";
import { resNameFromValue, sanitizeResName } from "@/lib/xml/resname";

interface Props {
  /** 正在编辑的属性名（background / foreground …） */
  attrName: string;
  /** 当前属性值（@drawable/xxx），用于预填名字 */
  value: string;
  /** 若该资源是「本工具生成」的，传原文进来 → 打开即回填参数 */
  existingXml?: string;
  /** 已有资源名（防重名） */
  existingNames: string[];
  onClose: () => void;
  /** 保存：资源名 + XML */
  onSave: (name: string, xml: string) => void;
}

const KINDS: { v: ShapeKind; label: string }[] = [
  { v: "rectangle", label: "矩形" },
  { v: "oval", label: "椭圆" },
  { v: "line", label: "线条" },
];

const RIPPLE_DEFAULT = "#33FFFFFF";

export function ShapeEditor({ attrName, value, existingXml, existingNames, onClose, onSave }: Props) {
  const initial = useMemo<ShapeSpec>(() => {
    const parsed = existingXml ? parseShapeSpec(existingXml) : null;
    return (
      parsed ?? {
        kind: "rectangle",
        solid: "#FFFFFF",
        radius: 12,
      }
    );
  }, [existingXml]);

  const [spec, setSpec] = useState<ShapeSpec>(initial);
  const [advanced, setAdvanced] = useState<boolean>(!!initial.gradient);
  const [perCorner, setPerCorner] = useState<boolean>(!!initial.corners);
  const [dashed, setDashed] = useState<boolean>(!!initial.stroke?.dashWidth);
  const [name, setName] = useState<string>(() => {
    // 只有「合法的 @drawable/名字」才沿用已有名；
    // 纯色（#00C853）等值绝不能当文件名 —— Android 资源名只能 a-z0-9_ 且不能以数字开头
    const cur = resNameFromValue(value);
    if (cur) return cur;
    return shapeResourceName(initial, existingNames);
  });
  /** 名字是否被别的资源占用（编辑自己时不算冲突） */
  const nameConflicts = existingNames.includes(name) && !existingXml;

  const patch = (p: Partial<ShapeSpec>) => setSpec((s) => ({ ...s, ...p }));

  const setSolid = (color: string) => {
    setSpec((s) => ({ ...s, solid: color, gradient: undefined }));
    setAdvanced(false);
  };

  const setGradient = (g: Partial<NonNullable<ShapeSpec["gradient"]>>) => {
    setSpec((s) => {
      const base = s.gradient ?? { type: "linear" as GradientType, start: "#7C4DFF", end: "#00BCD4", angle: 0 };
      return { ...s, gradient: { ...base, ...g }, solid: undefined };
    });
  };

  const setCorners = (key: keyof NonNullable<ShapeSpec["corners"]>, v: number) => {
    setSpec((s) => {
      const r = s.radius ?? 0;
      const base = s.corners ?? { tl: r, tr: r, br: r, bl: r };
      return { ...s, corners: { ...base, [key]: v } };
    });
  };

  const togglePerCorner = (on: boolean) => {
    setPerCorner(on);
    setSpec((s) => {
      if (!on) return { ...s, corners: undefined };
      const r = s.radius ?? 0;
      return { ...s, corners: { tl: r, tr: r, br: r, bl: r } };
    });
  };

  const setStroke = (p: Partial<NonNullable<ShapeSpec["stroke"]>>) => {
    setSpec((s) => {
      const base = s.stroke ?? { width: 1, color: "#E0E0E0" };
      return { ...s, stroke: { ...base, ...p } };
    });
  };

  const xml = useMemo(() => buildShapeXml(spec), [spec]);
  const css = useMemo(() => specToCss(spec), [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = () => {
    const safe = sanitizeResName(name);
    if (!safe || nameConflicts) return;
    onSave(safe, xml);
  };

  const grad = spec.gradient;

  return (
    <div className="axv-shape-page" role="dialog" aria-label="自定义形状">
      <div className="axv-shape-head">
        <button className="axv-shape-back" onClick={onClose} aria-label="返回编辑器">
          <span className="msr" aria-hidden="true">arrow_back</span>
          返回
        </button>
        <span className="axv-shape-title">自定义形状 · {attrName}</span>
        <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

        <div className="axv-shape-body">
          {/* 左：参数 */}
          <div className="axv-shape-form">
            <div className="axv-shape-field">
              <label>形状</label>
              <div className="axv-shape-seg">
                {KINDS.map((k) => (
                  <button
                    key={k.v}
                    className={"axv-shape-seg-btn" + (spec.kind === k.v ? " is-on" : "")}
                    onClick={() => patch({ kind: k.v })}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            {!grad ? (
              <div className="axv-shape-field">
                <label>填充色</label>
                <div className="axv-shape-color">
                  <input
                    type="color"
                    value={toHex6(spec.solid ?? "#FFFFFF")}
                    onChange={(e) => setSolid(e.target.value.toUpperCase())}
                  />
                  <input
                    className="axv-attr-input"
                    value={spec.solid ?? ""}
                    placeholder="#FFFFFF 或 #80FFFFFF（带透明度）"
                    spellCheck={false}
                    onChange={(e) => setSolid(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {spec.kind === "rectangle" ? (
              <div className="axv-shape-field">
                <label>
                  圆角
                  <button className="axv-shape-link" onClick={() => togglePerCorner(!perCorner)}>
                    {perCorner ? "统一" : "四角独立"}
                  </button>
                </label>
                {perCorner ? (
                  <div className="axv-shape-corners">
                    {(
                      [
                        ["tl", "左上"],
                        ["tr", "右上"],
                        ["br", "右下"],
                        ["bl", "左下"],
                      ] as const
                    ).map(([k, label]) => (
                      <input
                        key={k}
                        className="axv-attr-input"
                        type="number"
                        min={0}
                        value={spec.corners?.[k] ?? spec.radius ?? 0}
                        title={label}
                        onChange={(e) => setCorners(k, Number(e.target.value))}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="axv-shape-range">
                    <input
                      type="range"
                      min={0}
                      max={48}
                      value={spec.radius ?? 0}
                      onChange={(e) => patch({ radius: Number(e.target.value) })}
                    />
                    <span>{spec.radius ?? 0}dp</span>
                  </div>
                )}
              </div>
            ) : null}

            <div className="axv-shape-field">
              <label>
                描边
                <span className="axv-shape-hint">宽度 0 = 无描边</span>
              </label>
              <div className="axv-shape-row">
                <input
                  className="axv-attr-input"
                  type="number"
                  min={0}
                  max={24}
                  value={spec.stroke?.width ?? 0}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    if (w <= 0) setSpec((s) => ({ ...s, stroke: undefined }));
                    else setStroke({ width: w });
                  }}
                />
                <input
                  type="color"
                  value={toHex6(spec.stroke?.color ?? "#E0E0E0")}
                  onChange={(e) => setStroke({ color: e.target.value.toUpperCase(), width: spec.stroke?.width ?? 1 })}
                />
                <label className="axv-shape-check">
                  <input
                    type="checkbox"
                    checked={dashed}
                    onChange={(e) => {
                      setDashed(e.target.checked);
                      if (e.target.checked) setStroke({ dashWidth: 4, dashGap: 3, width: spec.stroke?.width ?? 1 });
                      else setSpec((s) => (s.stroke ? { ...s, stroke: { ...s.stroke, dashWidth: undefined, dashGap: undefined } } : s));
                    }}
                  />
                  虚线
                </label>
              </div>
              {dashed ? (
                <div className="axv-shape-row">
                  <input
                    className="axv-attr-input"
                    type="number"
                    min={1}
                    value={spec.stroke?.dashWidth ?? 4}
                    title="虚线段长 dp"
                    onChange={(e) => setStroke({ dashWidth: Number(e.target.value) })}
                  />
                  <input
                    className="axv-attr-input"
                    type="number"
                    min={1}
                    value={spec.stroke?.dashGap ?? 3}
                    title="虚线间隔 dp"
                    onChange={(e) => setStroke({ dashGap: Number(e.target.value) })}
                  />
                </div>
              ) : null}
            </div>

            <div className="axv-shape-field">
              <label className="axv-shape-check axv-shape-check-line">
                <input
                  type="checkbox"
                  checked={!!spec.ripple}
                  onChange={(e) =>
                    setSpec((s) => ({ ...s, ripple: e.target.checked ? { color: RIPPLE_DEFAULT } : undefined }))
                  }
                />
                点按水波纹（&lt;ripple&gt;）
              </label>
              {spec.ripple ? (
                <div className="axv-shape-color">
                  <input
                    type="color"
                    value={toHex6(spec.ripple.color)}
                    onChange={(e) => setSpec((s) => ({ ...s, ripple: { color: withAlphaHex(e.target.value, s.ripple?.color) } }))}
                  />
                  <input
                    className="axv-attr-input"
                    value={spec.ripple.color}
                    spellCheck={false}
                    onChange={(e) => setSpec((s) => ({ ...s, ripple: { color: e.target.value } }))}
                  />
                </div>
              ) : null}
            </div>

            {/* M3h-2：selector 按下/禁用态 */}
            <div className="axv-shape-field">
              <label className="axv-shape-check axv-shape-check-line">
                <input
                  type="checkbox"
                  checked={!!spec.states}
                  onChange={(e) =>
                    setSpec((s) =>
                      e.target.checked
                        ? { ...s, states: { pressed: shade(s.solid ?? "#FFFFFF", 0.12) } }
                        : { ...s, states: undefined },
                    )
                  }
                />
                按下/禁用用不同颜色（&lt;selector&gt;）
              </label>
              {spec.states ? (
                <div className="axv-shape-row" style={{ marginTop: 6 }}>
                  <span className="axv-shape-hint">按下</span>
                  <input
                    type="color"
                    value={toHex6(spec.states.pressed ?? spec.solid ?? "#FFFFFF")}
                    onChange={(e) => setSpec((s) => ({ ...s, states: { ...s.states, pressed: e.target.value.toUpperCase() } }))}
                  />
                  <span className="axv-shape-hint">禁用</span>
                  <input
                    type="color"
                    value={toHex6(spec.states.disabled ?? "#EEEEEE")}
                    onChange={(e) => setSpec((s) => ({ ...s, states: { ...s.states, disabled: e.target.value.toUpperCase() } }))}
                  />
                  <button
                    className="axv-shape-link"
                    onClick={() => setSpec((s) => ({ ...s, states: { ...s.states, disabled: undefined } }))}
                  >
                    不要禁用态
                  </button>
                </div>
              ) : null}
            </div>

            {/* M3h-2：layer-list 阴影层 */}
            <div className="axv-shape-field">
              <label className="axv-shape-check axv-shape-check-line">
                <input
                  type="checkbox"
                  checked={!!spec.shadow}
                  onChange={(e) =>
                    setSpec((s) =>
                      e.target.checked
                        ? { ...s, shadow: { dx: 0, dy: 4, blur: 6, color: "#1F000000" } }
                        : { ...s, shadow: undefined },
                    )
                  }
                />
                阴影层（&lt;layer-list&gt;）
              </label>
              {spec.shadow ? (
                <div className="axv-shape-row" style={{ marginTop: 6 }}>
                  <input
                    className="axv-attr-input"
                    type="number"
                    title="水平偏移 dp"
                    value={spec.shadow.dx}
                    onChange={(e) => setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dx: Number(e.target.value) } }))}
                  />
                  <input
                    className="axv-attr-input"
                    type="number"
                    title="垂直偏移 dp"
                    value={spec.shadow.dy}
                    onChange={(e) => setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dy: Number(e.target.value) } }))}
                  />
                  <input
                    className="axv-attr-input"
                    type="number"
                    title="扩散 dp（没有真模糊，靠外扩近似）"
                    value={spec.shadow.blur}
                    onChange={(e) => setSpec((s) => ({ ...s, shadow: { ...s.shadow!, blur: Number(e.target.value) } }))}
                  />
                  <input
                    type="color"
                    value={toHex6(spec.shadow.color)}
                    onChange={(e) =>
                      setSpec((s) => ({ ...s, shadow: { ...s.shadow!, color: withAlphaHex(e.target.value, s.shadow?.color) } }))
                    }
                  />
                </div>
              ) : null}
            </div>

            {/* M5c：<inset> 内缩（背景整体内缩绘制） */}
            <div className="axv-shape-field">
              <label className="axv-shape-check axv-shape-check-line">
                <input
                  type="checkbox"
                  checked={!!spec.inset}
                  onChange={(e) =>
                    setSpec((s) =>
                      e.target.checked
                        ? { ...s, inset: { l: 4, t: 4, r: 4, b: 4 } }
                        : { ...s, inset: undefined },
                    )
                  }
                />
                内缩（&lt;inset&gt;）
              </label>
              {spec.inset ? (
                <>
                  <div className="axv-shape-corners" style={{ marginTop: 6 }}>
                    {(
                      [
                        ["l", "左"],
                        ["t", "上"],
                        ["r", "右"],
                        ["b", "下"],
                      ] as const
                    ).map(([k, label]) => (
                      <input
                        key={k}
                        className="axv-attr-input"
                        type="number"
                        min={0}
                        title={`内缩${label}（dp）`}
                        placeholder={label}
                        value={spec.inset?.[k] ?? 0}
                        onChange={(e) =>
                          setSpec((s) => ({
                            ...s,
                            inset: { ...(s.inset ?? {}), [k]: Math.max(0, Number(e.target.value) || 0) },
                          }))
                        }
                      />
                    ))}
                  </div>
                  <button
                    className="axv-shape-link"
                    style={{ marginTop: 6 }}
                    onClick={() => setSpec((s) => ({ ...s, inset: { l: 4, t: 4, r: 4, b: 4 } }))}
                  >
                    四边统一 4dp
                  </button>
                </>
              ) : null}
            </div>

            <details
              className="axv-shape-adv"
              open={advanced}
              onToggle={(e) => setAdvanced((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>高级：渐变</summary>
              <div className="axv-shape-field">
                <label className="axv-shape-check">
                  <input
                    type="checkbox"
                    checked={!!grad}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setGradient({});
                        setAdvanced(true);
                      } else {
                        setSpec((s) => ({ ...s, gradient: undefined, solid: s.solid ?? "#FFFFFF" }));
                      }
                    }}
                  />
                  使用渐变（替换纯色）
                </label>
              </div>
              {grad ? (
                <>
                  <div className="axv-shape-field">
                    <label>类型</label>
                    <div className="axv-shape-seg">
                      {(["linear", "radial", "sweep"] as GradientType[]).map((t) => (
                        <button
                          key={t}
                          className={"axv-shape-seg-btn" + (grad.type === t ? " is-on" : "")}
                          onClick={() => setGradient({ type: t })}
                        >
                          {t === "linear" ? "线性" : t === "radial" ? "径向" : "扫描"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="axv-shape-field">
                    <label>颜色（起点 / 中间 / 终点）</label>
                    <div className="axv-shape-row">
                      <input type="color" value={toHex6(grad.start)} onChange={(e) => setGradient({ start: e.target.value.toUpperCase() })} />
                      <input
                        type="color"
                        value={toHex6(grad.center ?? grad.end)}
                        onChange={(e) => setGradient({ center: e.target.value.toUpperCase() })}
                      />
                      <input type="color" value={toHex6(grad.end)} onChange={(e) => setGradient({ end: e.target.value.toUpperCase() })} />
                      <button className="axv-shape-link" onClick={() => setGradient({ center: undefined })}>
                        去掉中间色
                      </button>
                    </div>
                  </div>
                  {grad.type === "linear" ? (
                    <div className="axv-shape-field">
                      <label>角度</label>
                      <div className="axv-shape-range">
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={45}
                          value={grad.angle ?? 0}
                          onChange={(e) => setGradient({ angle: Number(e.target.value) })}
                        />
                        <span>{grad.angle ?? 0}°</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </details>
          </div>

          {/* 右：预览 + 生成结果 */}
          <div className="axv-shape-side">
            <div className="axv-shape-preview-box">
              <div
                className="axv-shape-preview"
                style={{
                  background: css.background,
                  borderRadius: css.borderRadius,
                  border: css.border,
                  // M5c：inset 预览——背景向内裁掉 l/t/r/b（画布里由独立背景层实现）
                  clipPath: css.clipPath,
                  width: spec.kind === "line" ? "100%" : 180,
                  height: spec.kind === "line" ? 2 : 100,
                }}
              />
            </div>
            <div className="axv-shape-preview-note">预览 = 画布效果（同一套渲染规则）</div>
            <div className="axv-shape-name">
              <label>资源名</label>
              <div className="axv-shape-name-row">
                <code>@drawable/</code>
                <input
                  className="axv-attr-input"
                  value={name}
                  spellCheck={false}
                  placeholder="bg_card"
                  onChange={(e) => setName(sanitizeResName(e.target.value, ""))}
                />
              </div>
              {nameConflicts ? <div className="axv-shape-warn">这个名字已被占用，换一个或改已有资源</div> : null}
            </div>
            <pre className="axv-shape-xml">{xml}</pre>
          </div>
        </div>

        <div className="axv-shape-foot">
          <span>
            保存后生成 <code>res/drawable/{name || "…"}.xml</code>，导出 res 包时一并带走
          </span>
          <div className="axv-shape-foot-btns">
            <button className="axv-btn" onClick={onClose}>
              取消
            </button>
            <button className="axv-btn axv-btn-primary" onClick={save} disabled={!name.trim() || nameConflicts}>
              保存并应用
            </button>
          </div>
        </div>
      </div>
  );
}

/** #RRGGBBAA / #AARRGGBB / #RRGGBB → input[type=color] 需要的 #RRGGBB */
function toHex6(v: string): string {
  const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
  if (!m) return "#FFFFFF";
  const h = m[1];
  if (h.length === 6) return `#${h}`;
  if (h.length === 8) return `#${h.slice(2)}`; // Android 是 AARRGGBB
  if (h.length === 3) return `#${h.split("").map((c) => c + c).join("")}`;
  return "#FFFFFF";
}

/** 颜色选择器只给不透明色：保留原 alpha，写回 Android 的 AARRGGBB */
function withAlphaHex(picked: string, prev?: string): string {
  const m = /^#([0-9a-f]{8})$/i.exec((prev ?? "").trim());
  const alpha = m ? m[1].slice(0, 2) : "33";
  return `#${alpha}${picked.replace("#", "").toUpperCase()}`;
}

/** 按下色默认值：把常态色往黑/白撑一点（暗色变亮、亮色变暗） */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#E0E0E0";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const t = lum > 0.5 ? 0 : 255;
  const mix = (c: number) => Math.round(c + (t - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
