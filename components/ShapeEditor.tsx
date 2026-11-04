"use client";

// components/ShapeEditor.tsx — M3h 自定义形状编辑器
// 调参数 → 生成 res/drawable/*.xml（<shape> / <ripple>），中间画布区实时预览（与画布同一套语义）。
// 渐变收在「填充 → 高级」里，默认只露纯色 + 圆角 + 描边，避免面板一上来就吓人。
//
// M89n：UI 布局改成和图标编辑器（IconCanvasEditor）一致
//   顶栏（返回 + 标题 + 工具） / 左工具条 + 画布 / 右侧参数栏（手机可滑出） / 底部可折叠抽屉（分页） / 底栏保存

import { useEffect, useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
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
import { DrawableEditor } from "./DrawableEditor";
import { DrawablePreview } from "./DrawablePreview";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { rootInfo } from "@/lib/xml/drawable-root";
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

type SheetTab = "shape" | "fill" | "stroke" | "effect" | "layers";

const KINDS: { v: ShapeKind; label: string; icon: string }[] = [
  { v: "rectangle", label: tt("矩形"), icon: "crop_square" },
  { v: "oval", label: tt("椭圆"), icon: "circle" },
  { v: "ring", label: tt("环形"), icon: "ring" },
  { v: "line", label: tt("线条"), icon: "remove" },
];

/** M117：常用预设（点一下直接填参数） */
const SHAPE_PRESETS: { label: string; apply: (s: ShapeSpec) => ShapeSpec }[] = [
  {
    label: tt("圆角卡片"),
    apply: (s) => ({ ...s, kind: "rectangle", radius: 16, solid: "#FFFFFF", gradient: undefined, stroke: undefined }),
  },
  {
    label: tt("胶囊"),
    apply: (s) => ({ ...s, kind: "rectangle", radius: 999, solid: "#FFFFFF", gradient: undefined, stroke: undefined }),
  },
  {
    label: tt("圆形"),
    apply: (s) => ({ ...s, kind: "oval", solid: "#FFFFFF", gradient: undefined, stroke: undefined, corners: undefined, radius: undefined }),
  },
  {
    label: tt("环形"),
    apply: (s) => ({ ...s, kind: "ring", ringHole: 0.5, solid: "#FFFFFF", gradient: undefined, stroke: undefined, corners: undefined, radius: undefined }),
  },
];

/** M117：圆角快捷值 */
const RADIUS_PRESETS = [0, 4, 8, 12, 16, 24, 32, 999];

/** 底部抽屉的分页（和图标编辑器同款） */
const SHEET_TABS: [SheetTab, string][] = [
  ["shape", tt("形状")],
  ["fill", tt("填充")],
  ["stroke", tt("描边")],
  ["effect", tt("效果")],
  ["layers", tt("图层")],
];

const RIPPLE_DEFAULT = "#33FFFFFF";

export function ShapeEditorInner({ attrName, value, existingXml, existingNames, onClose, onSave }: Props) {
  /** M121：切到「结构树」编辑器（编辑 layer-list / selector / ripple 等非纯形状的 drawable） */
  const [treeMode, setTreeMode] = useState(false);
  const initial = useMemo<ShapeSpec>(() => {
    const parsed = existingXml ? parseShapeSpec(existingXml) : null;
    return (
      parsed ?? {
        kind: "rectangle",
        solid: "#FFFFFF",
        // M91d：新建矩形默认无圆角（直角），要圆角自己拉滑杆
        radius: 0,
      }
    );
  }, [existingXml]);

  /*
   * M119：图层模型
   * rootSpec 是权威数据（含 layers），spec 是“当前编辑目标”：
   * 选中某一层时，形状/填充/描边/效果四个抽屉页改的是那一层的 shape，未选中时改根。
   */
  const [rootSpec, setRootSpec] = useState<ShapeSpec>(initial);
  const [activeLayer, setActiveLayer] = useState<number | null>(null);
  const spec: ShapeSpec =
    activeLayer !== null && rootSpec.layers?.[activeLayer]
      ? rootSpec.layers[activeLayer].spec
      : rootSpec;
  const setSpec = (updater: ShapeSpec | ((s: ShapeSpec) => ShapeSpec)) =>
    setRootSpec((prev) => {
      const apply = (s: ShapeSpec) => (typeof updater === "function" ? updater(s) : updater);
      if (activeLayer !== null && prev.layers?.[activeLayer]) {
        const layers = prev.layers.slice();
        layers[activeLayer] = { ...layers[activeLayer], spec: apply(layers[activeLayer].spec) };
        return { ...prev, layers };
      }
      return apply(prev);
    });

  /* M117：撤销/重做（rootSpec 历史栈，最多 30 步） */
  const [undoStack, setUndoStack] = useState<ShapeSpec[]>([]);
  const [redoStack, setRedoStack] = useState<ShapeSpec[]>([]);
  const commitSpec = (updater: (s: ShapeSpec) => ShapeSpec) => {
    setUndoStack((prev) => [...prev.slice(-29), rootSpec]);
    setRedoStack([]);
    setSpec(updater);
  };
  const undo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, rootSpec]);
    setRootSpec(prev);
  };
  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, rootSpec]);
    setRootSpec(next);
  };
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
  /* M117：预览背景切换（透明格 / 白 / 深） */
  const [previewBg, setPreviewBg] = useState<"checker" | "white" | "dark">("checker");
  const previewBgStyle: React.CSSProperties =
    previewBg === "checker"
      ? {
          backgroundImage:
            "repeating-conic-gradient(#0000000a 0% 25%, transparent 0% 50%) 50% / 12px 12px",
          backgroundColor: "#f5f5f7",
        }
      : previewBg === "white"
        ? { backgroundColor: "#ffffff" }
        : { backgroundColor: "#1a1a22" };

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

  /* ── M119：图层操作（直接改 rootSpec，不走“当前编辑目标”分流） ── */
  const layers = rootSpec.layers ?? [];
  const kindLabel = (k: ShapeKind) => KINDS.find((x) => x.v === k)?.label ?? k;
  const mutateRoot = (updater: (s: ShapeSpec) => ShapeSpec) => {
    setUndoStack((prev) => [...prev.slice(-29), rootSpec]);
    setRedoStack([]);
    setRootSpec((prev) => updater(prev));
  };
  /** 只保留纯 shape 字段，防止层里套层/套 selector */
  const plainOf = (s: ShapeSpec): ShapeSpec => ({
    kind: s.kind,
    solid: s.solid,
    gradient: s.gradient,
    radius: s.radius,
    corners: s.corners,
    stroke: s.stroke,
    size: s.size,
    ringHole: s.ringHole,
  });
  const addLayer = () => {
    const base = plainOf(layers.length ? layers[layers.length - 1].spec : rootSpec);
    mutateRoot((s) => ({ ...s, layers: [...(s.layers ?? []), { spec: { ...base } }] }));
    setActiveLayer(layers.length);
    setSheetTab("layers");
    setSheetOpen(true);
  };
  const removeLayer = (i: number) => {
    mutateRoot((s) => {
      const ls = (s.layers ?? []).filter((_, k) => k !== i);
      return { ...s, layers: ls.length ? ls : undefined };
    });
    setActiveLayer((cur) => (cur === null ? null : cur === i ? null : cur > i ? cur - 1 : cur));
  };
  const moveLayer = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layers.length) return;
    mutateRoot((s) => {
      const ls = (s.layers ?? []).slice();
      const t = ls[i];
      ls[i] = ls[j];
      ls[j] = t;
      return { ...s, layers: ls };
    });
    setActiveLayer((cur) => (cur === i ? j : cur === j ? i : cur));
  };
  const patchLayerItem = (i: number, p: Partial<NonNullable<ShapeSpec["layers"]>[number]["item"]>) =>
    mutateRoot((s) => {
      const ls = (s.layers ?? []).slice();
      if (!ls[i]) return s;
      ls[i] = { ...ls[i], item: { ...ls[i].item, ...p } };
      return { ...s, layers: ls };
    });

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

  const xml = useMemo(() => buildShapeXml(rootSpec), [rootSpec]);
  const css = useMemo(() => specToCss(argbColorsForPreview(spec)), [spec]);
  /** M118：预览走的就是即将写入 XML 的那棵树，而不是另一套近似样式 */
  const doc = useMemo(() => parseDrawable(buildShapeXml(rootSpec)), [rootSpec]);

  /* M117：Ctrl/Cmd + Z / Shift+Z 撤销重做 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, undoStack, redoStack, spec]);

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
  const isRing = spec.kind === "ring";
  const prevW = isLine ? 240 : 220;
  const prevH = isLine ? 2 : 140;
  const ringPct = Math.round((spec.ringHole ?? 0.4) * 50);

  // M121：结构树模式（同一个入口，不再另开一套弹窗）
  if (treeMode) {
    return (
      <DrawableEditor
        attrName={attrName}
        value={value}
        existingXml={xml}
        existingNames={existingNames}
        onClose={() => setTreeMode(false)}
        onSave={onSave}
      />
    );
  }

  return (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label={tt("自定义形状")}>
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label={tt("返回编辑器")} title={tt("返回")}>
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">{tt("自定义形状 · {name}", { name: attrName })}</span>
        <span className="axv-cv-head-tools">
          <button
            className="axv-icon-btn"
            onClick={undo}
            disabled={undoStack.length === 0}
            title={tt("撤销")}
            aria-label={tt("撤销")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>undo</span>
          </button>
          <button
            className="axv-icon-btn"
            onClick={redo}
            disabled={redoStack.length === 0}
            title={tt("重做")}
            aria-label={tt("重做")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>redo</span>
          </button>
          <button
            className="axv-icon-btn"
            onClick={() => {
              setSheetTab("shape");
              setSheetOpen(true);
            }}
            title={tt("形状参数")}
            aria-label={tt("形状参数")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>tune</span>
          </button>
          <button
            className="axv-icon-btn"
            onClick={() => setTreeMode(true)}
            title={tt("结构树（图层 / 状态 / 水波纹）")}
            aria-label={tt("结构树")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>account_tree</span>
          </button>
          <button
            className={"axv-icon-btn" + (showRaw ? " is-on" : "")}
            onClick={() => setShowRaw((v) => !v)}
            title={tt("查看生成的 XML")}
            aria-label={tt("查看生成的 XML")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
          </button>
        </span>
      </div>

      <div className="axv-icon-page-body axv-cv-body">
        {/* 左：形状工具条 + 画布预览 */}
        <div className="axv-cv-left">
          <div className="axv-cv-tools" role="toolbar" aria-label={tt("形状类型")}>
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
              title={tt("点按水波纹")}
              aria-label={tt("点按水波纹")}
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
              title={tt("阴影层")}
              aria-label={tt("阴影层")}
              aria-pressed={!!spec.shadow}
            >
              <span className="msr" aria-hidden="true">layers</span>
            </button>
          </div>

          <div className="axv-cv-stage">
            <div
              className="axv-cv-board"
              style={{ width: 300, display: "grid", placeItems: "center", ...previewBgStyle }}
            >
              <div className="axv-shape-preview-slot" style={{ width: prevW, height: prevH }}>
                <DrawablePreview
                  doc={doc}
                  width={prevW}
                  height={prevH}
                  scale={1}
                  backdrop={previewBg}
                  showStateBar
                />
              </div>
            </div>
            <div className="axv-cv-hint" style={{ textAlign: "center" }}>
              {tt("预览 = 画布效果（同一套渲染规则）")}
              <div className="axv-shape-pv-bg" style={{ marginTop: 6, display: "inline-flex", gap: 4 }}>
                {(["checker", "white", "dark"] as const).map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    className={"axv-shape-pv-bg-btn" + (previewBg === bg ? " is-on" : "")}
                    onClick={() => setPreviewBg(bg)}
                    title={bg === "checker" ? tt("透明格") : bg === "white" ? tt("白底") : tt("深底")}
                    aria-label={bg === "checker" ? tt("透明格") : bg === "white" ? tt("白底") : tt("深底")}
                  >
                    <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>
                      {bg === "checker" ? "grid_4x4" : bg === "white" ? "wb_sunny" : "dark_mode"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右：资源名 + 生成的 XML（手机上是靠右滑出的浮层） */}
        <button
          type="button"
          className={"axv-cv-form-toggle" + (formOpen ? "" : " is-closed")}
          onClick={() => setFormOpen((v) => !v)}
          aria-label={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
          title={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
        >
          <span className="msr" aria-hidden="true">{formOpen ? "chevron_right" : "chevron_left"}</span>
        </button>
        <div className={"axv-icon-ed-form axv-cv-form" + (formOpen ? "" : " is-closed")}>
          <div className="axv-set-group">
            <div className="axv-set-label">{tt("资源名")}</div>
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
            {nameConflicts ? <div className="axv-shape-warn">{tt("这个名字已被占用，换一个或改已有资源")}</div> : null}
          </div>

          <div className="axv-set-group">
            <button className="axv-set-btn" onClick={() => setShowRaw((v) => !v)}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
              {showRaw ? tt("收起 XML") : tt("查看生成的 XML")}
            </button>
            {showRaw ? <pre className="axv-icon-ed-raw">{xml}</pre> : null}
          </div>
        </div>

        {/* 底部抽屉：形状 / 填充 / 描边 / 效果 */}
        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")}>
          <div className="axv-cv-sheet-head" onClick={() => setSheetOpen((v) => !v)}>
            <span className="axv-cv-grabber" aria-hidden="true" />
            <span className="axv-cv-sheet-title">{tt("样式")}</span>
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
                {/* M117：预设样式 */}
                <div className="axv-shape-field">
                  <label>{tt("预设")}</label>
                  <div className="axv-shape-preset-row">
                    {SHAPE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="axv-shape-preset"
                        onClick={() => commitSpec(p.apply)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="axv-shape-field">
                  <label>{tt("形状")}</label>
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

                {/* M117：环形洞比例（仅 ring） */}
                {isRing ? (
                  <div className="axv-shape-field">
                    <label>
                      {tt("环洞比例")}
                      <span className="axv-shape-hint">{tt("越大洞越大")}</span>
                    </label>
                    <div className="axv-shape-range">
                      <input
                        type="range"
                        min={0}
                        max={90}
                        value={Math.round((spec.ringHole ?? 0.4) * 100)}
                        onChange={(e) => patch({ ringHole: Number(e.target.value) / 100 })}
                      />
                      <span>{ringPct}%</span>
                    </div>
                  </div>
                ) : null}

                {spec.kind === "rectangle" ? (
                  <div className="axv-shape-field">
                    <label>
                      {tt("圆角")}
                      <button className="axv-shape-link" onClick={() => togglePerCorner(!perCorner)}>
                        {perCorner ? tt("统一") : tt("四角独立")}
                      </button>
                    </label>
                    {perCorner ? (
                      <div className="axv-shape-corners">
                        {(
                          [
                            ["tl", tt("左上")],
                            ["tr", tt("右上")],
                            ["br", tt("右下")],
                            ["bl", tt("左下")],
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
                      <>
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
                        {/* M117：圆角快捷值 */}
                        <div className="axv-shape-radius-quick">
                          {RADIUS_PRESETS.map((r) => (
                            <button
                              key={r}
                              type="button"
                              className={
                                "axv-shape-radius-chip" +
                                ((spec.radius ?? 0) === r ? " is-on" : "")
                              }
                              onClick={() => patch({ radius: r })}
                            >
                              {r === 999 ? tt("胶囊") : `${r}`}
                            </button>
                          ))}
                        </div>
                      </>
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
                    {tt("内缩（<inset>）")}
                  </label>
                  {spec.inset ? (
                    <>
                      <div className="axv-shape-corners" style={{ marginTop: 6 }}>
                        {(
                          [
                            ["l", tt("左")],
                            ["t", tt("上")],
                            ["r", tt("右")],
                            ["b", tt("下")],
                          ] as const
                        ).map(([k, label]) => (
                          <input
                            key={k}
                            className="axv-attr-input"
                            type="number"
                            min={0}
                            title={tt("内缩{side}（dp）", { side: label })}
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
                        {tt("四边统一 4dp")}
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
                    <label>{tt("填充色")}</label>
                    <div className="axv-shape-color">
                      <ColorField
                        aboveModal
                        label={tt("填充色")}
                        value={spec.solid ?? "#FFFFFF"}
                        onChange={(css) => setSolid(cssToShapeColor(css))}
                      />
                      <input
                        className="axv-attr-input"
                        value={spec.solid ?? ""}
                        placeholder="#FFFFFF 或 #80FFFFFF（带透明度）" // i18n-ignore
                        spellCheck={false}
                        onChange={(e) => setSolid(e.target.value)}
                      />
                      <label className="axv-shape-alpha" title={tt("拖动调填充透明度")}>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={tt("填充不透明度")}
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
                  <summary>{tt("高级：渐变")}</summary>
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
                      {tt("使用渐变（替换纯色）")}
                    </label>
                  </div>
                  {grad ? (
                    <>
                      <div className="axv-shape-field">
                        <label>{tt("类型")}</label>
                        <div className="axv-shape-seg">
                          {(["linear", "radial", "sweep"] as GradientType[]).map((t) => (
                            <button
                              key={t}
                              className={"axv-shape-seg-btn" + (grad.type === t ? " is-on" : "")}
                              onClick={() => setGradient({ type: t })}
                            >
                              {t === "linear" ? tt("线性") : t === "radial" ? tt("径向") : tt("扫描")}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="axv-shape-field">
                        <label>{tt("颜色（起点 / 中间 / 终点）")}</label>
                        <div className="axv-shape-row">
                          <ColorField
                            aboveModal
                            label={tt("渐变起点")}
                            value={grad.start}
                            onChange={(css) => setGradient({ start: cssToShapeColor(css) })}
                          />
                          <ColorField
                            aboveModal
                            label={tt("渐变中间色")}
                            value={grad.center ?? grad.end}
                            onChange={(css) => setGradient({ center: cssToShapeColor(css) })}
                          />
                          <ColorField
                            aboveModal
                            label={tt("渐变终点")}
                            value={grad.end}
                            onChange={(css) => setGradient({ end: cssToShapeColor(css) })}
                          />
                          <button className="axv-shape-link" onClick={() => setGradient({ center: undefined })}>
                            {tt("去掉中间色")}
                          </button>
                        </div>
                      </div>
                      {grad.type === "linear" ? (
                        <div className="axv-shape-field">
                          <label>{tt("角度")}</label>
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
                    {tt("描边")}
                    <span className="axv-shape-hint">{tt("宽度 0 = 无描边")}</span>
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
                      label={tt("描边色")}
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
                      {tt("虚线")}
                    </label>
                  </div>
                  {dashed ? (
                    <div className="axv-shape-row">
                      <input
                        className="axv-attr-input"
                        type="number"
                        min={1}
                        value={spec.stroke?.dashWidth ?? 4}
                        title={tt("虚线段长 dp")}
                        onChange={(e) => setStroke({ dashWidth: Number(e.target.value) })}
                      />
                      <input
                        className="axv-attr-input"
                        type="number"
                        min={1}
                        value={spec.stroke?.dashGap ?? 3}
                        title={tt("虚线间隔 dp")}
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
                    {tt("点按水波纹（<ripple>）")}
                  </label>
                  {spec.ripple ? (
                    <div className="axv-shape-color">
                      <ColorField
                        aboveModal
                        label={tt("涟漪色")}
                        value={spec.ripple.color}
                        onChange={(css) => setSpec((s) => ({ ...s, ripple: { color: cssToShapeColor(css) } }))}
                      />
                      <input
                        className="axv-attr-input"
                        value={spec.ripple.color}
                        spellCheck={false}
                        onChange={(e) => setSpec((s) => ({ ...s, ripple: { color: e.target.value } }))}
                      />
                      <label className="axv-shape-alpha" title={tt("拖动调涟漪透明度")}>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={tt("涟漪不透明度")}
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
                    {tt("按下/禁用用不同颜色（<selector>）")}
                  </label>
                  {spec.states ? (
                    <div className="axv-shape-row" style={{ marginTop: 6 }}>
                      <span className="axv-shape-hint">{tt("按下")}</span>
                      <ColorField
                        aboveModal
                        label={tt("按下态颜色")}
                        value={spec.states.pressed ?? spec.solid ?? "#FFFFFF"}
                        onChange={(css) =>
                          setSpec((s) => ({ ...s, states: { ...s.states, pressed: cssToShapeColor(css) } }))
                        }
                      />
                      <span className="axv-shape-hint">{tt("禁用")}</span>
                      <ColorField
                        aboveModal
                        label={tt("禁用态颜色")}
                        value={spec.states.disabled ?? "#EEEEEE"}
                        onChange={(css) =>
                          setSpec((s) => ({ ...s, states: { ...s.states, disabled: cssToShapeColor(css) } }))
                        }
                      />
                      <button
                        className="axv-shape-link"
                        onClick={() => setSpec((s) => ({ ...s, states: { ...s.states, disabled: undefined } }))}
                      >
                        {tt("不要禁用态")}
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
                    {tt("阴影层（<layer-list>）")}
                  </label>
                  {spec.shadow ? (
                    <div className="axv-shape-row" style={{ marginTop: 6 }}>
                      <input
                        className="axv-attr-input"
                        type="number"
                        title={tt("水平偏移 dp")}
                        value={spec.shadow.dx}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dx: Number(e.target.value) } }))
                        }
                      />
                      <input
                        className="axv-attr-input"
                        type="number"
                        title={tt("垂直偏移 dp")}
                        value={spec.shadow.dy}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, dy: Number(e.target.value) } }))
                        }
                      />
                      <input
                        className="axv-attr-input"
                        type="number"
                        title={tt("扩散 dp（没有真模糊，靠外扩近似）")}
                        value={spec.shadow.blur}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, shadow: { ...s.shadow!, blur: Number(e.target.value) } }))
                        }
                      />
                      <ColorField
                        aboveModal
                        label={tt("阴影色")}
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
            {activeLayer !== null && layers[activeLayer] ? (
              <div className="axv-layer-target">
                <span className="msr" aria-hidden="true">layers</span>
                <span>
                  {tt("正在编辑第 {n} 层", { n: String(activeLayer + 1) })}
                  <i>{kindLabel(layers[activeLayer].spec.kind)}</i>
                </span>
                <button className="axv-shape-link" onClick={() => setActiveLayer(null)}>
                  {tt("回到整体")}
                </button>
              </div>
            ) : null}

            {sheetTab === "layers" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-shape-field">
                  <label>
                    {tt("图层")}
                    <span className="axv-shape-hint">{tt("从下往上叠，最后一项在最上层")}</span>
                  </label>
                  {layers.length === 0 ? (
                    <div className="axv-shape-hint" style={{ padding: "4px 0" }}>
                      {tt("还没有图层。加一层就变成 <layer-list>，可以叠多层形状。")}
                    </div>
                  ) : (
                    <div className="axv-layer-list">
                      {layers
                        .map((L, i) => ({ L, i }))
                        .reverse()
                        .map(({ L, i }) => {
                          const swatch = specToCss(argbColorsForPreview(L.spec));
                          return (
                            <div key={i} className={"axv-layer-row" + (activeLayer === i ? " is-on" : "")}>
                              <button
                                type="button"
                                className="axv-layer-pick"
                                onClick={() => setActiveLayer(activeLayer === i ? null : i)}
                                title={tt("点一下编辑这层")}
                              >
                                <span className="axv-layer-idx">{i + 1}</span>
                                <span
                                  className="axv-layer-swatch"
                                  style={{
                                    background: swatch.background,
                                    borderRadius: swatch.borderRadius,
                                    border: swatch.border,
                                  }}
                                />
                                <span className="axv-layer-name">{kindLabel(L.spec.kind)}</span>
                                {L.item && (L.item.left || L.item.top || L.item.right || L.item.bottom) ? (
                                  <span className="axv-layer-off">
                                    {tt("偏移 {l}/{t}/{r}/{b}", {
                                      l: String(L.item.left ?? 0),
                                      t: String(L.item.top ?? 0),
                                      r: String(L.item.right ?? 0),
                                      b: String(L.item.bottom ?? 0),
                                    })}
                                  </span>
                                ) : null}
                              </button>
                              <div className="axv-layer-ops">
                                <button
                                  type="button"
                                  className="msr"
                                  title={tt("上移一层")}
                                  disabled={i === layers.length - 1}
                                  onClick={() => moveLayer(i, 1)}
                                >
                                  arrow_upward
                                </button>
                                <button
                                  type="button"
                                  className="msr"
                                  title={tt("下移一层")}
                                  disabled={i === 0}
                                  onClick={() => moveLayer(i, -1)}
                                >
                                  arrow_downward
                                </button>
                                <button
                                  type="button"
                                  className="msr"
                                  title={tt("删除这层")}
                                  onClick={() => removeLayer(i)}
                                >
                                  delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  <button type="button" className="axv-shape-preset" onClick={addLayer}>
                    {layers.length ? tt("再加一层") : tt("添加一层")}
                  </button>
                </div>

                {activeLayer !== null && layers[activeLayer] ? (
                  <div className="axv-shape-field">
                    <label>
                      {tt("这一层的边距")}
                      <span className="axv-shape-hint">{tt("dp，负值往外偏")}</span>
                    </label>
                    <div className="axv-shape-corners">
                      {(
                        [
                          ["left", tt("左")],
                          ["top", tt("上")],
                          ["right", tt("右")],
                          ["bottom", tt("下")],
                        ] as const
                      ).map(([k, label]) => (
                        <input
                          key={k}
                          className="axv-attr-input"
                          type="number"
                          title={label}
                          value={layers[activeLayer].item?.[k] ?? 0}
                          onChange={(e) => patchLayerItem(activeLayer, { [k]: Number(e.target.value) || undefined })}
                        />
                      ))}
                    </div>
                    <div className="axv-shape-row" style={{ marginTop: 6 }}>
                      <span className="axv-shape-hint">{tt("不透明度")}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((layers[activeLayer].item?.alpha ?? 1) * 100)}
                        onChange={(e) =>
                          patchLayerItem(activeLayer, { alpha: Number(e.target.value) / 100 })
                        }
                        aria-label={tt("图层不透明度")}
                      />
                      <b>{Math.round((layers[activeLayer].item?.alpha ?? 1) * 100)}%</b>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>
          <span className="axv-icon-page-foot-note">
            {tt("保存后生成 res/drawable/{name}.xml，导出 res 包时一并带走。", { name: name || "…" })}
          </span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={close}>
            {tt("取消")}
          </button>
          <button className="axv-btn axv-btn-primary" onClick={save} disabled={!name.trim() || nameConflicts}>
            {tt("保存并应用")}
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * M121：入口路由器。
 * 纯 <shape> 走形状面板（参数最全）；selector / layer-list / ripple / inset / <color> 走结构树编辑器。
 * 这样原来「打开一个 selector 资源结果被形状面板改坏」的问题从根上没了。
 */
export function ShapeEditor(props: Props) {
  const info = useMemo(() => rootInfo(props.existingXml), [props.existingXml]);
  // 组合类走结构树；只读类也进 DrawableEditor（会给明确说明 + 原样保存），
  // 绝不用形状面板去改一个不是 shape 的文件。
  if (info.route === "tree" || info.route === "readonly") {
    return (
      <DrawableEditor
        attrName={props.attrName}
        value={props.value}
        existingXml={props.existingXml}
        existingNames={props.existingNames}
        onClose={props.onClose}
        onSave={props.onSave}
      />
    );
  }
  return <ShapeEditorInner {...props} />;
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
