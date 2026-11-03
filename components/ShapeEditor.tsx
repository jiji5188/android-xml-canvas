"use client";

// components/ShapeEditor.tsx — M3h 自定义形状编辑器
// 调参数 → 生成 res/drawable/*.xml（<shape> / <ripple>），中间画布区实时预览（与画布同一套语义）。
// 渐变收在「填充 → 高级」里，默认只露纯色 + 圆角 + 描边，避免面板一上来就吓人。
//
// M89n：UI 布局改成和图标编辑器（IconCanvasEditor）一致
//   顶栏（返回 + 标题 + 工具） / 左工具条 + 画布 / 右侧参数栏（手机可滑出） / 底部可折叠抽屉（分页） / 底栏保存

import { useEffect, useMemo, useState } from "react";
import { useOverlayBack } from "@/lib/overlay-back";
import {
  argbColorsForPreview,
  buildShapeXml,
  parseShapeSpec,
  shapeResourceName,
  specToCss,
  type GradientType,
  type ShapeKind,
  type ShapeSpec,
} from "@/lib/xml/shape-gen";
import { resNameFromValue, sanitizeResName } from "@/lib/xml/resname";
import { ColorField } from "./ColorField";
import { parseColorOr, toAndroidHex } from "@/lib/xml/color-argb";

/** 取色器回传的 CSS 串 → 形状规格里存的 Android 写法（#RRGGBB / #AARRGGBB，大写） */
const cssToShapeColor = (css: string) => toAndroidHex(parseColorOr(css, "#FFFFFF"));

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

type SheetTab = "shape" | "fill" | "stroke" | "effect";

const KINDS: { v: ShapeKind; label: string; icon: string }[] = [
  { v: "rectangle", label: "矩形", icon: "crop_square" },
  { v: "oval", label: "椭圆", icon: "circle" },
  { v: "line", label: "线条", icon: "remove" },
];

/** 底部抽屉的分页（和图标编辑器同款） */
const SHEET_TABS: [SheetTab, string][] = [
  ["shape", "形状"],
  ["fill", "填充"],
  ["stroke", "描边"],
  ["effect", "效果"],
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

  /* UI 骨架状态（M89n）：右侧参数栏、底部抽屉 */
  const [formOpen, setFormOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [sheetTab, setSheetTab] = useState<SheetTab>("fill");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // jsdom 里没有 matchMedia，必须判一下
    if (typeof window.matchMedia !== "function") return;
    // 手机上默认收起（和图标编辑器一致：画布优先）
    if (window.matchMedia("(max-width: 840px)").matches) {
      setFormOpen(false);
      setSheetOpen(false);
    }
  }, []);

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
  const css = useMemo(() => specToCss(argbColorsForPreview(spec)), [spec]);

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
  // M78：系统返回键也能关（否则手机上按返回会退出 app）
  const close = useOverlayBack(true, onClose);

  /* 画布里的预览尺寸（dp）：线条铺满，其它给一块矩形/椭圆 */
  const isLine = spec.kind === "line";
  const prevW = isLine ? 240 : 220;
  const prevH = isLine ? 2 : 140;

  return (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label="自定义形状">
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label="返回编辑器" title="返回">
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">自定义形状 · {attrName}</span>
        <span className="axv-cv-head-tools">
          <button
            className="axv-icon-btn"
            onClick={() => {
              setSheetTab("shape");
              setSheetOpen(true);
            }}
            title="形状参数"
            aria-label="形状参数"
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>tune</span>
          </button>
          <button
            className={"axv-icon-btn" + (showRaw ? " is-on" : "")}
            onClick={() => setShowRaw((v) => !v)}
            title="查看生成的 XML"
            aria-label="查看生成的 XML"
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
          </button>
        </span>
      </div>

      <div className="axv-icon-page-body axv-cv-body">
        {/* 左：形状工具条 + 画布预览 */}
        <div className="axv-cv-left">
          <div className="axv-cv-tools" role="toolbar" aria-label="形状类型">
            {KINDS.map((k) => (
              <button
                key={k.v}
                className={"axv-cv-tool" + (spec.kind === k.v ? " on" : "")}
                onClick={() => patch({ kind: k.v })}
                title={k.label}
                aria-label={k.label}
                aria-pressed={spec.kind === k.v}
              >
                <span className="msr" aria-hidden="true">{k.icon}</span>
              </button>
            ))}
            <span className="axv-cv-tool-sep" />
            <button
              className={"axv-cv-tool" + (spec.ripple ? " on" : "")}
              onClick={() =>
                setSpec((s) => ({ ...s, ripple: s.ripple ? undefined : { color: RIPPLE_DEFAULT } }))
              }
              title="点按水波纹"
              aria-label="点按水波纹"
              aria-pressed={!!spec.ripple}
            >
              <span className="msr" aria-hidden="true">touch_app</span>
            </button>
            <button
              className={"axv-cv-tool" + (spec.shadow ? " on" : "")}
              onClick={() =>
                setSpec((s) =>
                  s.shadow
                    ? { ...s, shadow: undefined }
                    : { ...s, shadow: { dx: 0, dy: 4, blur: 6, color: "#1F000000" } },
                )
              }
              title="阴影层"
              aria-label="阴影层"
              aria-pressed={!!spec.shadow}
            >
              <span className="msr" aria-hidden="true">layers</span>
            </button>
          </div>

          <div className="axv-cv-stage">
            <div className="axv-cv-board" style={{ width: 300, display: "grid", placeItems: "center" }}>
              <div
                className="axv-shape-preview"
                style={{
                  background: css.background,
                  borderRadius: css.borderRadius,
                  border: css.border,
                  // M5c：inset 预览——背景向内裁掉 l/t/r/b（画布里由独立背景层实现）
                  clipPath: css.clipPath,
                  width: prevW,
                  height: prevH,
                }}
              />
            </div>
            <div className="axv-cv-hint" style={{ textAlign: "center" }}>
              预览 = 画布效果（同一套渲染规则）
            </div>
          </div>
        </div>

        {/* 右：资源名 + 生成的 XML（手机上是靠右滑出的浮层） */}
        <button
          type="button"
          className={"axv-cv-form-toggle" + (formOpen ? "" : " is-closed")}
          onClick={() => setFormOpen((v) => !v)}
          aria-label={formOpen ? "收起参数面板" : "展开参数面板"}
          title={formOpen ? "收起参数面板" : "展开参数面板"}
        >
          <span className="msr" aria-hidden="true">{formOpen ? "chevron_right" : "chevron_left"}</span>
        </button>
        <div className={"axv-icon-ed-form axv-cv-form" + (formOpen ? "" : " is-closed")}>
          <div className="axv-set-group">
            <div className="axv-set-label">资源名</div>
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

          <div className="axv-set-group">
            <button className="axv-set-btn" onClick={() => setShowRaw((v) => !v)}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
              {showRaw ? "收起 XML" : "查看生成的 XML"}
            </button>
            {showRaw ? <pre className="axv-icon-ed-raw">{xml}</pre> : null}
          </div>
        </div>

        {/* 底部抽屉：形状 / 填充 / 描边 / 效果 */}
        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")}>
          <div className="axv-cv-sheet-head" onClick={() => setSheetOpen((v) => !v)}>
            <span className="axv-cv-grabber" aria-hidden="true" />
            <span className="axv-cv-sheet-title">样式</span>
            <div className="axv-cv-sheet-tabs" onClick={(e) => e.stopPropagation()}>
              {SHEET_TABS.map(([k, label]) => (
                <button
                  key={k}
                  className={"axv-cv-sheet-tab" + (sheetTab === k ? " on" : "")}
                  onClick={() => {
                    setSheetTab(k);
                    setSheetOpen(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="axv-cv-sheet-chev msr" aria-hidden="true">expand_more</span>
          </div>

          <div className="axv-cv-sheet-body">
            {sheetTab === "shape" ? (
              <div className="axv-cv-sheet-pane">
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
              </div>
            ) : null}

            {sheetTab === "fill" ? (
              <div className="axv-cv-sheet-pane">
                {!grad ? (
                  <div className="axv-shape-field">
                    <label>填充色</label>
                    <div className="axv-shape-color">
                      <ColorField
                        aboveModal
                        label="填充色"
                        value={spec.solid ?? "#FFFFFF"}
                        onChange={(css) => setSolid(cssToShapeColor(css))}
                      />
                      <input
                        className="axv-attr-input"
                        value={spec.solid ?? ""}
                        placeholder="#FFFFFF 或 #80FFFFFF（带透明度）"
                        spellCheck={false}
                        onChange={(e) => setSolid(e.target.value)}
                      />
                      <label className="axv-shape-alpha" title="拖动调填充透明度">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          aria-label="填充不透明度"
                          value={alphaPercent(spec.solid)}
                          onChange={(e) => setSolid(withAlphaPercent(spec.solid ?? "#FFFFFF", Number(e.target.value)))}
                        />
                        <b>{alphaPercent(spec.solid)}%</b>
                      </label>
                    </div>
                  </div>
                ) : null}

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
                          <ColorField
                            aboveModal
                            label="渐变起点"
                            value={grad.start}
                            onChange={(css) => setGradient({ start: cssToShapeColor(css) })}
                          />
                          <ColorField
                            aboveModal
                            label="渐变中间色"
                            value={grad.center ?? grad.end}
                            onChange={(css) => setGradient({ center: cssToShapeColor(css) })}
                          />
                          <ColorField
                            aboveModal
                            label="渐变终点"
                            value={grad.end}
                            onChange={(css) => setGradient({ end: cssToShapeColor(css) })}
                          />
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
            ) : null}

            {sheetTab === "stroke" ? (
              <div className="axv-cv-sheet-pane">
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
                    <ColorField
                      aboveModal
                      label="描边色"
                      value={spec.stroke?.color ?? "#E0E0E0"}
                      onChange={(css) => setStroke({ color: cssToShapeColor(css), width: spec.stroke?.width ?? 1 })}
                    />
                    <label className="axv-shape-check">
                      <input
                        type="checkbox"
                        checked={dashed}
                        onChange={(e) => {
                          setDashed(e.target.checked);
                          if (e.target.checked) setStroke({ dashWidth: 4, dashGap: 3, width: spec.stroke?.width ?? 1 });
                          else
                            setSpec((s) =>
                              s.stroke ? { ...s, stroke: { ...s.stroke, dashWidth: undefined, dashGap: undefined } } : s,
                            );
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
              </div>
            ) : null}

            {sheetTab === "effect" ? (
              <div className="axv-cv-sheet-pane">
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
                      <ColorField
                        aboveModal
                        label="涟漪色"
                        value={spec.ripple.color}
                        onChange={(css) => setSpec((s) => ({ ...s, ripple: { color: cssToShapeColor(css) } }))}
                      />
                      <input
                        className="axv-attr-input"
                        value={spec.ripple.color}
                        spellCheck={false}
                        onChange={(e) => setSpec((s) => ({ ...s, ripple: { color: e.target.value } }))}
                      />
                      <label className="axv-shape-alpha" title="拖动调涟漪透明度">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          aria-label="涟漪不透明度"
                          value={alphaPercent(spec.ripple.color)}
                          onChange={(e) =>
                            setSpec((s) => ({
                              ...s,
                              ripple: {
                                color: withAlphaPercent(s.ripple?.color ?? "#FFFFFF", Number(e.target.value)),
                              },
                            }))
                          }
                        />
                        <b>{alphaPercent(spec.ripple.color)}%</b>
                      </label>
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
                      <ColorField
                        aboveModal
                        label="按下态颜色"
                        value={spec.states.pressed ?? spec.solid ?? "#FFFFFF"}
                        onChange={(css) =>
                          setSpec((s) => ({ ...s, states: { ...s.states, pressed: cssToShapeColor(css) } }))
                        }
                      />
                      <span className="axv-shape-hint">禁用</span>
                      <ColorField
                        aboveModal
                        label="禁用态颜色"
                        value={spec.states.disabled ?? "#EEEEEE"}
                        onChange={(css) =>
                          setSpec((s) => ({ ...s, states: { ...s.states, disabled: cssToShapeColor(css) } }))
                        }
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
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dx: Number(e.target.value) } }))
                        }
                      />
                      <input
                        className="axv-attr-input"
                        type="number"
                        title="垂直偏移 dp"
                        value={spec.shadow.dy}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dy: Number(e.target.value) } }))
                        }
                      />
                      <input
                        className="axv-attr-input"
                        type="number"
                        title="扩散 dp（没有真模糊，靠外扩近似）"
                        value={spec.shadow.blur}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, blur: Number(e.target.value) } }))
                        }
                      />
                      <ColorField
                        aboveModal
                        label="阴影色"
                        value={spec.shadow.color}
                        onChange={(css) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, color: cssToShapeColor(css) } }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>
          <span className="axv-icon-page-foot-note">
            保存后生成 res/drawable/{name || "…"}.xml，导出 res 包时一并带走。
          </span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={close}>
            取消
          </button>
          <button className="axv-btn axv-btn-primary" onClick={save} disabled={!name.trim() || nameConflicts}>
            保存并应用
          </button>
        </span>
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

/** M52：当前颜色的 alpha 百分比（0-100），无 alpha → 100 */
function alphaPercent(v?: string): number {
  const m = /^#([0-9a-f]{8})$/i.exec((v ?? "").trim());
  if (!m) return 100;
  return Math.round((parseInt(m[1].slice(0, 2), 16) / 255) * 100);
}

/** M52：只改 alpha，写回 Android 习惯：#RRGGBB（100%）/ #AARRGGBB */
function withAlphaPercent(v: string, pct: number): string {
  const rgb = toHex6(v).slice(1).toUpperCase();
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (p >= 100) return "#" + rgb;
  const a = Math.round((p / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
  return "#" + a + rgb;
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
