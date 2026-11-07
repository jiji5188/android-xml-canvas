"use client";

// components/IconCanvasEditor.tsx — M81：画布式图标编辑器（取代 M11j 的参数式 IconEditor）
//
// 布局与 svg-board 一致：左边画布（可画 / 可摆 / 可拖），右边参数面板，底部保存回 res/drawable。
// 输出仍然是标准 <vector>（lib/xml/vector-edit.ts 的 buildVectorXml），保存链路不变：
//   shapes ──shapesToModel──> VectorModel ──buildVectorXml──> drawable xml
// 打开已有图标时反向：xml ──parseVectorModel──> VectorModel ──modelToShapes──> 每条 path 一个可编辑图元。

import { t as tt } from "@/lib/i18n-src";
import { cleanResNameInput, sanitizeResName, applyResNamePrefix } from "@/lib/xml/resname";
import { hasRealRender, renderReal } from "@/lib/xml/native-render";
import { buildResourcePreviewFiles } from "@/lib/xml/res-preview";
import { buildAppIcon } from "@/lib/xml/app-icon";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBack } from "@/lib/overlay-back";
import { buildVectorXml, parseVectorModel, nextRotation } from "@/lib/xml/vector-edit";
import {
  bakeGroupTransform,
  groupMatrix,
  groupTransform,
  groupsFromModel,
  invertMat,
  isRenderableColor,
  scaleShape,
  shapeBox,
  shapeD,
  shapesToModel,
  smoothPath,
  toCss,
  translatePath,
  translateShape,
  unionBox,
  alignShapes,
  convertShapesToPaths,
  defaultRoundFor,
  modelToShapes,
  type Box,
  type CanvasMeta,
  type DrawShape,
  type GroupSpec,
  type Mat,
} from "@/lib/xml/canvas-shapes";
import { IconPickerPanel } from "./IconPickerPanel";
import { useUnsavedGuard } from "./UnsavedGuard";
import { textToPathData } from "@/lib/xml/text-to-path";
import { ColorPicker } from "./ColorPicker";
import { parseColorOr } from "@/lib/xml/color-argb";

interface Props {
  /** 资源名（保存时用） */
  name: string;
  /** 现有 vector xml（空 = 新建） */
  xml?: string;
  onClose: () => void;
  onSave: (name: string, xml: string) => void;
  existingNames?: string[];
  /** M171：把当前图标设为应用图标（前景 vector + 背景色）→ 父组件落盘 mipmap/ */
  onAppIcon?: (payload: {
    files: { path: string; text: string }[];
    bgColor: string;
    contentDp: number;
    sourceName: string;
  }) => void;
  /** M174：「设为应用图标」面板初始值（上次的参数 或 从项目 res 读回的） */
  initialAppIcon?: { bgColor: string; contentDp: number };
}

type Tool =
  | "select"
  | "pen"
  | "rect"
  | "roundRect"
  | "circle"
  | "ellipse"
  | "line"
  | "polygon"
  | "star"
  | "text";

const PRESET_COLORS = ["#1D1B20", "#04409F", "#B3261E", "#1F7A3D", "#F5A524", "#6B7280"];

/** 字体栈（画布渲染与 SVG 输出一致） */
const FONT_STACKS: Record<string, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', SimSun, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  kai: "'Kaiti SC', KaiTi, STKaiti, serif",
};

const TOOLS: { t: Tool; icon: string; label: string; key?: string }[] = [
  { t: "select", icon: "arrow_selector_tool", label: tt("选择"), key: "V" },
  { t: "pen", icon: "stylus_note", label: tt("画笔"), key: "P" },
  { t: "rect", icon: "crop_square", label: tt("矩形"), key: "R" },
  { t: "roundRect", icon: "rounded_corner", label: tt("圆角矩形") },
  { t: "circle", icon: "circle", label: tt("圆形"), key: "O" },
  { t: "ellipse", icon: "tonality", label: tt("椭圆") },
  { t: "line", icon: "show_chart", label: tt("直线"), key: "L" },
  { t: "polygon", icon: "pentagon", label: tt("多边形") },
  { t: "star", icon: "star", label: tt("星形") },
  { t: "text", icon: "title", label: tt("文字"), key: "T" },
];

const BLANK: Snapshot = {
  meta: {
    w: 24,
    h: 24,
    vw: 24,
    vh: 24,
    group: { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 12, pivotY: 12 },
  },
  shapes: [],
};

type Snapshot = { meta: CanvasMeta; shapes: DrawShape[] };

/** M88l：图层的旋转 transform（绕自身包围盒中心） */
function shapeRot(s: DrawShape): string | undefined {
  if (!s.rot || Math.abs(s.rot) < 0.001) return undefined;
  const b = shapeBox(s);
  const n = (v: number) => Math.round(v * 100) / 100;
  return `rotate(${n(s.rot)} ${n(b.x + b.w / 2)} ${n(b.y + b.h / 2)})`;
}

/** 选中框四角（左上、右上、右下、左下） */
function handlePositions(b: Box) {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** #AARRGGBB / #RRGGBB → #rrggbb（input[type=color] 只认 6 位） */
function toHex6(v: string): string {
  const s = (v || "").trim();
  const m8 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{6})$/.exec(s);
  if (m8) return "#" + m8[2].toLowerCase();
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m6) return "#" + m6[1].toLowerCase();
  return "#1d1b20";
}

/**
 * M11p：判断传进来的内容到底是什么，防止把普通图片当图标改。
 */
function inspect(xml?: string): "vector" | "bitmap" | "other-xml" | "empty" {
  const s = (xml ?? "").trim();
  if (!s) return "empty";
  if (/^data:image\//i.test(s) || /^\/9j\//.test(s) || /^iVBOR/.test(s)) return "bitmap";
  if (/<vector[\s>]/.test(s)) return "vector";
  if (!s.startsWith("<")) return "bitmap";
  return "other-xml";
}

export default function IconCanvasEditor({ name, xml, onClose, onSave, existingNames = [], onAppIcon, initialAppIcon }: Props) {
  const kind = useMemo(() => inspect(xml), [xml]);

  const initial = useMemo<Snapshot>(() => {
    const model = parseVectorModel(xml ?? "");
    if (!model) return JSON.parse(JSON.stringify(BLANK)) as Snapshot;
    return {
      meta: {
        w: model.w,
        h: model.h,
        vw: model.vw,
        vh: model.vh,
        group: { ...model.group },
        groups: groupsFromModel(model),
      },
      shapes: modelToShapes(model),
    };
  }, [xml]);

  const [meta, setMeta] = useState<CanvasMeta>(initial.meta);
  const [shapes, setShapes] = useState<DrawShape[]>(initial.shapes);
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [resName, setResName] = useState(name);
  const [err, setErr] = useState("");
  /** M158：aapt2 真预览进行中 / 结果 */
  const [realBusy, setRealBusy] = useState(false);
  const [realNote, setRealNote] = useState("");
  /** M135：XML 代码框默认一直展开 */
  const showRaw = true;
  const [picking, setPicking] = useState(false);
  /** 插入图标（多图标拼合）：不替换现有图形，而是把选中的图标追加成新图层 */
  const [inserting, setInserting] = useState(false);
  /** M171：设为应用图标（前景 + 背景色 + 安全区尺寸）；M174：初始值从 props 或默认取 */
  const [appIconOpen, setAppIconOpen] = useState(false);
  const [appIconBg, setAppIconBg] = useState(initialAppIcon?.bgColor || "#3FBFA0");
  const [appIconDp, setAppIconDp] = useState(initialAppIcon?.contentDp ?? 72);
  const [appIconErr, setAppIconErr] = useState("");
  const [colorTarget, setColorTarget] = useState<{ kind: "fill" | "stroke" | "bg" } | null>(null);
  const [zoom, setZoom] = useState(1);
  /** 网格 / 背景（背景会导出成最底层矩形） */
  const [showGrid, setShowGrid] = useState(true);
  const [bg, setBg] = useState("");
  /** 底部样式抽屉（移植 svg-board）：4 个 tab 子页 + 折叠 */
  const [sheetTab, setSheetTab] = useState<"style" | "props" | "align" | "layers" | "res" | "board">("style");
  const [sheetOpen, setSheetOpen] = useState(true);
  /** M88d：移动端右栏滑面板的开关（桌面端不显示这个按钮） */
  const [formOpen, setFormOpen] = useState(true);

  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const [, setHistVer] = useState(0);
  const bumpHist = () => setHistVer((v) => v + 1);

  const gRef = useRef<SVGGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  /* 自适应缩放：初始 / 「复位缩放」都按画布区可用宽高取较小者 fit（不是写死 1）
     宽扣左右 padding 32、高扣上下 padding 40 + gap 10 + 顶部 meta 行，留 96 */
  const fitZoom = useCallback(() => {
    const el = stageRef.current;
    if (!el) return 1;
    const availW = el.clientWidth - 32;
    const availH = el.clientHeight - 96;
    const f = Math.min(availW, availH) / 300; // 300 = 基准板尺寸(px)@zoom1
    return Math.round(Math.max(0.4, Math.min(2.5, f)) * 10) / 10;
  }, []);

  useEffect(() => {
    setZoom(fitZoom());
  }, [fitZoom]);

  /* 移动端：底部样式抽屉默认收起，否则会把下面那块参数面板盖住 */
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(max-width: 840px)").matches) setSheetOpen(false);
  }, []);
  /** M88f：移动端右栏默认隐藏，点左缘箭头展开 */
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(max-width: 840px)").matches) setFormOpen(false);
  }, []);
  const dragRef = useRef<
    | null
    | { kind: "draw"; id: string; start: { x: number; y: number } }
    | {
        kind: "move";
        start: { x: number; y: number };
        orig: { id: string; box: Box; shape: DrawShape }[];
      }
    | { kind: "resize"; box0: Box; corner: number; mat: Mat | null; orig: DrawShape[] }
    | { kind: "pen"; pts: { x: number; y: number }[] }
    | { kind: "marquee"; x0: number; y0: number }
  >(null);
  const [penPts, setPenPts] = useState<{ x: number; y: number }[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // M78：系统返回键也能关；必须放在任何 early return 之前
  // M141：返回前过一遍未保存提示（closeRef 在拿到 guard 之后回填）
  const closeRef = useRef<() => void>(() => {});
  useOverlayBack(true, () => closeRef.current());

  /* ---------------- 历史 ---------------- */
  const snapshot = useCallback((): Snapshot => ({ meta, shapes }), [meta, shapes]);

  const pushHistory = useCallback(() => {
    undoRef.current.push(JSON.parse(JSON.stringify(snapshot())) as Snapshot);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    bumpHist();
  }, [snapshot]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(JSON.parse(JSON.stringify({ meta, shapes })) as Snapshot);
    setMeta(prev.meta);
    setShapes(prev.shapes);
    bumpHist();
  }, [meta, shapes]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(JSON.parse(JSON.stringify({ meta, shapes })) as Snapshot);
    setMeta(next.meta);
    setShapes(next.shapes);
    bumpHist();
  }, [meta, shapes]);

  /* ---------------- 选中 ---------------- */
  const selected = useMemo(() => shapes.filter((s) => sel.includes(s.id)), [shapes, sel]);
  /* ---------------- 分组（M89b） ---------------- */
  const groups = useMemo<GroupSpec[]>(() => meta.groups ?? [], [meta.groups]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const specOf = useCallback(
    (s: DrawShape): GroupSpec | undefined => (s.group ? groupById.get(s.group) : undefined),
    [groupById],
  );
  const matOf = useCallback(
    (s: DrawShape): Mat | null => {
      const g = specOf(s);
      return g ? groupMatrix(g) : null;
    },
    [specOf],
  );
  /** 选中项若全在同一组 → 返回那个组（选中框/手柄按局部坐标处理） */
  const selGroup = useMemo<GroupSpec | null>(() => {
    if (!selected.length) return null;
    const first = selected[0].group;
    if (!first) return null;
    if (!selected.every((s) => s.group === first)) return null;
    return groupById.get(first) ?? null;
  }, [selected, groupById]);
  const selGroupMat = useMemo(() => (selGroup ? groupMatrix(selGroup) : null), [selGroup]);

  const selBox = useMemo<Box | null>(() => (selected.length ? unionBox(selected) : null), [selected]);
  /** 选中框在「视口坐标」里的包围盒（组内图形要把四角变换出去） */
  const selBoxView = useMemo<Box | null>(() => {
    if (!selected.length) return null;
    if (selGroup || !shapes.some((s) => sel.includes(s.id) && s.group)) return selBox;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of selected) {
      const b = shapeBox(s);
      const m = matOf(s);
      const pts = m
        ? [
            { x: b.x, y: b.y },
            { x: b.x + b.w, y: b.y },
            { x: b.x + b.w, y: b.y + b.h },
            { x: b.x, y: b.y + b.h },
          ].map((q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }))
        : [
            { x: b.x, y: b.y },
            { x: b.x + b.w, y: b.y },
            { x: b.x + b.w, y: b.y + b.h },
            { x: b.x, y: b.y + b.h },
          ];
      for (const q of pts) {
        x0 = Math.min(x0, q.x);
        y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x);
        y1 = Math.max(y1, q.y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [selected, selBox, selGroup, sel, shapes, matOf]);

  const localPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const g = gRef.current;
    if (!g) return { x: 0, y: 0 };
    const ctm = g.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  /** 1 viewport 单位 = 多少屏幕像素（getScreenCTM 的真实缩放） */
  const pxPerUnit = useCallback(() => {
    const m = gRef.current?.getScreenCTM?.();
    const a = m ? Math.hypot(m.a, m.b) : 0;
    return a > 0.01 ? a : 1;
  }, []);

  /** 图形在视口坐标里的包围盒（组内图形要过一遍组变换） */
  const boxView = useCallback(
    (s: DrawShape): Box => {
      const b = shapeBox(s);
      const m = matOf(s);
      if (!m) return b;
      const pts = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ].map((q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }));
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
    },
    [matOf],
  );

  const hitTest = useCallback(
    (pView: { x: number; y: number }): DrawShape | null => {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (s.hidden || s.locked) continue;
        const m = matOf(s);
        const p = m ? invertMat(m, pView) : pView;
        /* 3 屏幕像素的容差，按「屏幕→局部」双重换算（组缩放也要算进去） */
        const sc = m ? Math.max(0.05, Math.hypot(m.a, m.b)) : 1;
        const pad = 3 / pxPerUnit() / sc;
        const b = shapeBox(s);
        if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
          return s;
        }
      }
      return null;
    },
    [shapes, pxPerUnit, matOf],
  );

  /* ---------------- 新建图元 ---------------- */
  const nextId = useCallback(
    () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    [],
  );

  /** M88o：未选中时的「新图形默认样式」（样式 tab 改的就是它，不再是死值） */
  const [defStyle, setDefStyle] = useState({ fill: "#1D1B20", stroke: "none", strokeWidth: 0, alpha: 1 });

  const styleOf = useCallback(() => {
    const base = selected[0];
    if (base) {
      return { fill: base.fill, stroke: base.stroke, strokeWidth: base.strokeWidth, alpha: base.alpha };
    }
    return { ...defStyle };
  }, [selected, defStyle]);

  const makeShape = useCallback(
    (t: Tool, p: { x: number; y: number }): DrawShape => {
      const st = styleOf();
      const id = nextId();
      const defStroke = Math.max(0.5, meta.vw / 24);
      switch (t) {
        case "rect":
        case "roundRect":
          return {
            id,
            type: t,
            x: p.x,
            y: p.y,
            w: 0.01,
            h: 0.01,
            // M91b：只有「圆角矩形」工具才带默认圆角，直角矩形必须是 0，
            // 否则画出来是圆角（旧代码两种工具共用这一行，直角矩形被强行 10% 圆角）
            round: defaultRoundFor(t, meta.vw),
            fill: st.fill,
            stroke: st.stroke,
            strokeWidth: st.strokeWidth,
            alpha: st.alpha,
          };
        case "circle":
          return { id, type: "circle", cx: p.x, cy: p.y, r: 0.01, ...st };
        case "ellipse":
          return { id, type: "ellipse", cx: p.x, cy: p.y, rx: 0.01, ry: 0.01, ...st };
        case "line":
          return {
            id,
            type: "line",
            x1: p.x,
            y1: p.y,
            x2: p.x,
            y2: p.y,
            fill: "none",
            stroke: st.stroke === "none" ? st.fill : st.stroke,
            strokeWidth: st.strokeWidth || defStroke,
            alpha: st.alpha,
          };
        case "polygon":
          return { id, type: "polygon", cx: p.x, cy: p.y, r: 0.01, sides: 6, ...st };
        case "star":
          return { id, type: "star", cx: p.x, cy: p.y, r: 0.01, sides: 5, inner: 0.42, ...st };
        case "text":
          return {
            id,
            type: "text",
            x: p.x,
            y: p.y,
            text: tt("文字"),
            size: Math.max(2, meta.vw / 3),
            font: "sans",
            bold: false,
            outline: false,
            fill: st.fill === "none" ? "#1D1B20" : st.fill,
            stroke: "none",
            strokeWidth: 0,
            alpha: st.alpha,
          };
        default:
          return {
            id,
            type: "path",
            d: "",
            fill: "none",
            stroke: st.stroke === "none" ? st.fill : st.stroke,
            strokeWidth: st.strokeWidth || defStroke,
            alpha: st.alpha,
          };
      }
    },
    [meta.vw, nextId, styleOf],
  );

  /* ---------------- 指针 ---------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = localPoint(e);
    // WebView / 合成事件里 setPointerCapture 可能抛 NotFoundError，别让它中断拖拽
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }

    if (tool === "pen") {
      dragRef.current = { kind: "pen", pts: [p] };
      setPenPts([p]);
      return;
    }

    if (tool === "text") {
      const s = makeShape("text", p);
      pushHistory();
      setShapes((list) => [...list, s]);
      setSel([s.id]);
      return;
    }

    if (tool !== "select") {
      const s = makeShape(tool, p);
      pushHistory();
      setShapes((list) => [...list, s]);
      setSel([s.id]);
      dragRef.current = { kind: "draw", id: s.id, start: p };
      return;
    }

    // 先判选中框的角手柄（选中项在同一组里时，pg 是组局部坐标）
    if (selBox && selected.length) {
      const pg = selGroupMat ? invertMat(selGroupMat, p) : p;
      const hs = handlePositions(selBox);
      /* 真·屏幕像素容差：鼠标 8px / 触摸 18px（原来按 zoom 折算，图标上角点会放大到 ~30px，
         鼠标一按在图形边缘就被判成拉伸手柄 → 拖动时图形被拉变形） */
      const gsc = selGroupMat ? Math.max(0.05, Math.hypot(selGroupMat.a, selGroupMat.b)) : 1;
      const tol = (e.pointerType === "touch" ? 18 : 8) / pxPerUnit() / gsc;
      for (let i = 0; i < hs.length; i++) {
        if (Math.hypot(pg.x - hs[i].x, pg.y - hs[i].y) <= tol) {
          pushHistory();
          dragRef.current = {
            kind: "resize",
            box0: { ...selBox },
            corner: i,
            mat: selGroupMat,
            orig: JSON.parse(JSON.stringify(selected)) as DrawShape[],
          };
          return;
        }
      }
    }

    const hit = hitTest(p);
    if (hit) {
      const nextSel = e.shiftKey
        ? sel.includes(hit.id)
          ? sel.filter((x) => x !== hit.id)
          : [...sel, hit.id]
        : sel.includes(hit.id)
          ? sel
          : [hit.id];
      setSel(nextSel);
      pushHistory();
      dragRef.current = {
        kind: "move",
        start: p,
        orig: nextSel
          .map((id) => {
            const sh = shapes.find((x) => x.id === id);
            /* 存整份原始图形：每帧都从「原始 + 总位移」重算，避免逐帧增量累积误差/变形 */
            return sh
              ? { id, box: shapeBox(sh), shape: JSON.parse(JSON.stringify(sh)) as DrawShape }
              : null;
          })
          .filter((x): x is { id: string; box: Box; shape: DrawShape } => !!x),
      };
      return;
    }

    if (!e.shiftKey) setSel([]);
    dragRef.current = { kind: "marquee", x0: p.x, y0: p.y };
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = localPoint(e);

    if (d.kind === "pen") {
      const last = d.pts[d.pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.1) {
        d.pts.push(p);
        setPenPts([...d.pts]);
      }
      return;
    }

    if (d.kind === "marquee") {
      setMarquee({ x0: d.x0, y0: d.y0, x1: p.x, y1: p.y });
      return;
    }

    if (d.kind === "draw") {
      setShapes((list) =>
        list.map((s) => {
          if (s.id !== d.id) return s;
          const a = d.start;
          switch (s.type) {
            case "rect":
            case "roundRect":
              return {
                ...s,
                x: Math.min(a.x, p.x),
                y: Math.min(a.y, p.y),
                w: Math.abs(p.x - a.x),
                h: Math.abs(p.y - a.y),
              };
            case "circle":
              return { ...s, cx: a.x, cy: a.y, r: Math.hypot(p.x - a.x, p.y - a.y) };
            case "ellipse":
              return { ...s, cx: a.x, cy: a.y, rx: Math.abs(p.x - a.x), ry: Math.abs(p.y - a.y) };
            case "line":
              return { ...s, x2: p.x, y2: p.y };
            case "polygon":
            case "star":
              return { ...s, cx: a.x, cy: a.y, r: Math.hypot(p.x - a.x, p.y - a.y) };
            default:
              return s;
          }
        }),
      );
      return;
    }

    if (d.kind === "move") {
      setShapes((list) =>
        list.map((s) => {
          const o = d.orig.find((x) => x.id === s.id);
          if (!o) return s;
          /* 组内图形：把视口位移换算成组内位移（旋转/缩放后方向也跟着对） */
          const m = matOf(s);
          let dx = p.x - d.start.x;
          let dy = p.y - d.start.y;
          if (m) {
            const a = invertMat(m, d.start);
            const b = invertMat(m, p);
            dx = b.x - a.x;
            dy = b.y - a.y;
          }
          /* 永远以原始图形为基准平移，形状本身绝不会被拉伸 */
          return translateShape(JSON.parse(JSON.stringify(o.shape)) as DrawShape, dx, dy);
        }),
      );
      return;
    }

    if (d.kind === "resize") {
      const pr = d.mat ? invertMat(d.mat, p) : p;
      const hs = handlePositions(d.box0);
      const fixed = hs[(d.corner + 2) % 4];
      const box1: Box = {
        x: Math.min(fixed.x, pr.x),
        y: Math.min(fixed.y, pr.y),
        w: Math.max(0.15, Math.abs(pr.x - fixed.x)),
        h: Math.max(0.15, Math.abs(pr.y - fixed.y)),
      };
      setShapes((list) =>
        list.map((s) => {
          const i = d.orig.findIndex((x) => x.id === s.id);
          if (i < 0) return s;
          const copy = JSON.parse(JSON.stringify(d.orig[i])) as DrawShape;
          return scaleShape(copy, d.box0, box1);
        }),
      );
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;

    if (d && d.kind === "pen") {
      const pts = d.pts;
      setPenPts([]);
      if (pts.length < 2) return;
      const st = styleOf();
      const shape: DrawShape = {
        id: nextId(),
        type: "path",
        d: smoothPath(pts),
        fill: "none",
        stroke: st.stroke === "none" ? st.fill : st.stroke,
        strokeWidth: st.strokeWidth || Math.max(0.5, meta.vw / 24),
        alpha: st.alpha,
      };
      pushHistory();
      setShapes((list) => [...list, shape]);
      setSel([shape.id]);
      return;
    }

    if (d && d.kind === "draw") {
      setShapes((list) => {
        const s = list.find((x) => x.id === d.id);
        if (!s) return list;
        const b = shapeBox(s);
        if (b.w >= 0.5 || b.h >= 0.5) return list;
        // 点了一下没拖：给个默认大小，别让「一点就没」
        const size = Math.min(meta.vw, meta.vh) * 0.4;
        const c = { x: meta.vw / 2, y: meta.vh / 2 };
        const set = (patch: Record<string, unknown>) =>
          list.map((x) => (x.id === s.id ? ({ ...x, ...patch } as DrawShape) : x));
        switch (s.type) {
          case "rect":
          case "roundRect":
            return set({ x: c.x - size / 2, y: c.y - size / 2, w: size, h: size });
          case "circle":
            return set({ cx: c.x, cy: c.y, r: size / 2 });
          case "ellipse":
            return set({ cx: c.x, cy: c.y, rx: size / 2, ry: size / 2 });
          case "line":
            return set({ x1: c.x - size / 2, y1: c.y, x2: c.x + size / 2, y2: c.y });
          case "polygon":
          case "star":
            return set({ cx: c.x, cy: c.y, r: size / 2 });
          default:
            return list;
        }
      });
      return;
    }

    if (d && d.kind === "marquee" && marquee) {
      const box: Box = {
        x: Math.min(marquee.x0, marquee.x1),
        y: Math.min(marquee.y0, marquee.y1),
        w: Math.abs(marquee.x1 - marquee.x0),
        h: Math.abs(marquee.y1 - marquee.y0),
      };
      if (box.w > 0.4 || box.h > 0.4) {
        const picked = shapes.filter((s) => {
          if (s.hidden || s.locked) return false;
          const b = boxView(s);
          return !(b.x + b.w < box.x || box.x + box.w < b.x || b.y + b.h < box.y || box.y + box.h < b.y);
        });
        setSel(picked.map((s) => s.id));
      }
      setMarquee(null);
    }
  };

  /* ---------------- 属性 ---------------- */
  const patchSel = (p: Record<string, unknown>) => {
    if (!sel.length) return;
    setShapes((list) => list.map((s) => (sel.includes(s.id) ? ({ ...s, ...p } as DrawShape) : s)));
  };

  /** M88o：样式面板的读写目标——选中时是选中图形，未选中时是「新图形默认样式」 */
  const styleTarget = {
    fill: selected[0]?.fill ?? defStyle.fill,
    stroke: selected[0]?.stroke ?? defStyle.stroke,
    strokeWidth: selected[0]?.strokeWidth ?? defStyle.strokeWidth,
    alpha: selected[0]?.alpha ?? defStyle.alpha,
  };
  const patchStyle = (patch: Partial<typeof defStyle>) => {
    if (selected.length) {
      pushHistory();
      patchSel(patch);
      return;
    }
    setDefStyle((d) => ({ ...d, ...patch }));
  };
  /** 描边粗细滑杆上限：随 viewport 走（24 基准 → 6） */
  const strokeMax = Math.max(2, Math.round(meta.vw / 4));

  const removeSel = () => {
    if (!sel.length) return;
    pushHistory();
    const left = shapes.filter((s) => !sel.includes(s.id));
    setShapes(left);
    /* 删空的组一起清掉，别在图层里留一个空文件夹 */
    const alive = new Set(left.map((s) => s.group).filter(Boolean));
    setMeta((m) => ({ ...m, groups: (m.groups ?? []).filter((g) => alive.has(g.id)) }));
    setSel([]);
  };

  /* ---------------- 分组操作（M89b） ---------------- */
  const nextGroupName = useCallback(() => {
    const used = new Set(groups.map((g) => g.name ?? g.id));
    let i = groups.length + 1;
    while (used.has(`g${i}`)) i += 1;
    return `g${i}`;
  }, [groups]);

  const groupSel = useCallback(() => {
    if (!sel.length) return;
    if (sel.length === 1 && selected[0]?.group) return;
    pushHistory();
    const box = unionBox(selected);
    const gid = `g${Date.now().toString(36)}`;
    const spec: GroupSpec = {
      id: gid,
      name: nextGroupName(),
      tx: 0,
      ty: 0,
      rot: 0,
      sx: 1,
      sy: 1,
      px: box.x + box.w / 2,
      py: box.y + box.h / 2,
    };
    setMeta((m) => ({ ...m, groups: [...(m.groups ?? []), spec] }));
    setShapes((list) => {
      const ids = new Set(sel);
      const idxs = list.map((x, i) => (ids.has(x.id) ? i : -1)).filter((i) => i >= 0);
      const contiguous = idxs.length > 0 && idxs[idxs.length - 1] - idxs[0] === idxs.length - 1;
      if (contiguous) return list.map((x) => (ids.has(x.id) ? { ...x, group: gid } : x));
      /* 不连续：把成员搬到最上面，保证组内相邻（导出才能包进同一个 <group>） */
      const members = list.filter((x) => ids.has(x.id)).map((x) => ({ ...x, group: gid }));
      const rest = list.filter((x) => !ids.has(x.id));
      return [...rest, ...members];
    });
  }, [sel, selected, nextGroupName]);

  const ungroupIds = useCallback((ids: string[]) => {
    const gids = new Set(ids);
    if (!gids.size) return;
    const hasRot = [...gids].some((id) => Math.abs(groupById.get(id)?.rot ?? 0) > 0.001);
    if (hasRot) {
      setErr(tt("组里有旋转：解组没法把旋转烘回图形，请先把「旋转」调回 0°"));
      return;
    }
    pushHistory();
    setShapes((list) =>
      list.map((x) => {
        if (!x.group || !gids.has(x.group)) return x;
        const g = groupById.get(x.group);
        if (!g) return { ...x, group: undefined };
        const baked = bakeGroupTransform(JSON.parse(JSON.stringify(x)) as DrawShape, g);
        const { group: _drop, ...rest } = baked;
        return rest as DrawShape;
      }),
    );
    setMeta((m) => ({ ...m, groups: (m.groups ?? []).filter((g) => !gids.has(g.id)) }));
  }, [groupById]);

  const ungroupSel = useCallback(() => {
    ungroupIds(selected.map((x) => x.group).filter(Boolean) as string[]);
  }, [selected, ungroupIds]);

  const patchGroup = (id: string, patch: Partial<GroupSpec>) => {
    pushHistory();
    setMeta((m) => ({
      ...m,
      groups: (m.groups ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  };

  const selectGroup = (id: string) => setSel(shapes.filter((s) => s.group === id).map((s) => s.id));

  const duplicateSel = () => {
    if (!sel.length) return;
    pushHistory();
    const copies = selected.map((s) => {
      const c = JSON.parse(JSON.stringify(s)) as DrawShape;
      c.id = nextId();
      /* 复制出来的图元不再属于原组，否则同名 <group> 会被拆成两段 */
      delete c.group;
      return translateShape(c, meta.vw * 0.04, meta.vh * 0.04);
    });
    setShapes((list) => [...list, ...copies]);
    setSel(copies.map((c) => c.id));
  };

  const moveLayerOne = (id: string, dir: -1 | 1) => {
    pushHistory();
    setShapes((list) => {
      const arr = [...list];
      const i = arr.findIndex((s) => s.id === id);
      if (i < 0) return list;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return list;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  /** 画布尺寸：改 viewport，并把所有图形等比缩放，画面看起来不变 */
  const resizeViewport = (size: number) => {
    const n = Math.max(1, Math.min(2048, Math.round(size)));
    if (n === meta.vw && n === meta.vh) return;
    pushHistory();
    const from = { x: 0, y: 0, w: meta.vw, h: meta.vh };
    const to = { x: 0, y: 0, w: n, h: n };
    setShapes((list) =>
      // scaleShape 会就地改对象，先深拷贝：否则 StrictMode 双跑 updater 会缩两次
      list.map((s) => scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, from, to)),
    );
    setMeta((m) => ({ ...m, vw: n, vh: n }));
  };

  /** 图层拖拽排序 */
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const layerDragRef = useRef<string | null>(null);
  const layerOverRef = useRef<string | null>(null);

  const onGripDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    layerDragRef.current = id;
    layerOverRef.current = id;
    setDragLayerId(id);
    setDragOverId(id);
  };

  /* 拖拽期间的 move / up 挂在 window 上：指针跑到行外（或 capture 失败）也能收尾 */
  useEffect(() => {
    if (!dragLayerId) return;
    const onMove = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
        "[data-layer-id]",
      ) as HTMLElement | null;
      const id = el?.dataset.layerId ?? null;
      if (id !== layerOverRef.current) {
        layerOverRef.current = id;
        setDragOverId(id);
      }
    };
    const onUp = () => {
      const from = layerDragRef.current;
      const to = layerOverRef.current;
      layerDragRef.current = null;
      layerOverRef.current = null;
      setDragLayerId(null);
      setDragOverId(null);
      if (!from || !to || from === to) return;
      pushHistory();
      setShapes((list) => {
        const arr = [...list];
        const i = arr.findIndex((s) => s.id === from);
        const j = arr.findIndex((s) => s.id === to);
        if (i < 0 || j < 0) return list;
        const [moved] = arr.splice(i, 1);
        arr.splice(j, 0, moved);
        return arr;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragLayerId, pushHistory]);

  /** 几何图元 → 等价 path（手改 pathData 用） */
  const convertSelToPath = () => {
    if (!sel.length) return;
    pushHistory();
    setShapes((list) => convertShapesToPaths(list, sel));
  };

  /** 对齐 / 均分（需 ≥2 选中；均分需 ≥3） */
  /** 对齐：选中 1 个时以画布为基准，≥2 个时以选中包围盒为基准 */
  const alignSel = (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdist" | "vdist") => {
    if (!sel.length) return;
    pushHistory();
    setShapes((list) => alignShapes(list, sel, mode, { x: 0, y: 0, w: meta.vw, h: meta.vh }));
  };

  /* ---------------- M88l：属性面板（位置 / 大小 / 旋转微调） ---------------- */
  /** 选中图层的旋转角（多选时以第一个为准显示） */
  const selRot = selected[0]?.rot ?? 0;

  /** 整体平移选中图形：用 translate，不碰几何尺寸 → 永远不会变形 */
  const nudgeSel = (dx: number, dy: number) => {
    if (!sel.length || (!dx && !dy)) return;
    pushHistory();
    setShapes((list) =>
      list.map((s) =>
        sel.includes(s.id)
          ? translateShape(JSON.parse(JSON.stringify(s)) as DrawShape, dx, dy)
          : s,
      ),
    );
  };

  /** 整体缩放到目标包围盒（只在提交时调用一次） */
  const resizeSelTo = (to: Box) => {
    if (!sel.length || !selBox) return;
    const from = { ...selBox };
    const box: Box = {
      x: to.x,
      y: to.y,
      w: Math.max(0.2, to.w),
      h: Math.max(0.2, to.h),
    };
    if (box.w === from.w && box.h === from.h && box.x === from.x && box.y === from.y) return;
    pushHistory();
    setShapes((list) =>
      list.map((s) =>
        sel.includes(s.id)
          ? scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, from, box)
          : s,
      ),
    );
  };

  const setSelRot = (deg: number) => {
    if (!sel.length) return;
    const v = Math.max(-180, Math.min(180, Math.round(deg * 10) / 10));
    pushHistory();
    setShapes((list) => list.map((s) => (sel.includes(s.id) ? { ...s, rot: v } : s)));
  };

  const nudgeRot = (step: number) => setSelRot((selRot || 0) + step);

  /* 输入框先写草稿，回车/失焦才真正生效：
     否则边打字边缩放（输入 "12" 时先变成 1）会把图形反复压扁拉长 → 看起来「变形」 */
  type PropDraft = { x: string; y: string; w: string; h: string; rot: string };
  const [propDraft, setPropDraft] = useState<PropDraft | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const r2 = (v: number) => Math.round(v * 100) / 100;

  useEffect(() => {
    if (!selBox) {
      setPropDraft(null);
      return;
    }
    setPropDraft({
      x: String(r2(selBox.x)),
      y: String(r2(selBox.y)),
      w: String(r2(selBox.w)),
      h: String(r2(selBox.h)),
      rot: String(r2(selRot)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.length, selBox?.x, selBox?.y, selBox?.w, selBox?.h, selRot]);

  const commitProp = (key: keyof PropDraft) => {
    if (!propDraft || !selBox || !sel.length) return;
    const n = Number(propDraft[key]);
    if (!Number.isFinite(n)) {
      setPropDraft({ ...propDraft });
      return;
    }
    if (key === "x") {
      nudgeSel(n - selBox.x, 0);
    } else if (key === "y") {
      nudgeSel(0, n - selBox.y);
    } else if (key === "w") {
      const w = Math.max(0.2, n);
      const h = lockAspect && selBox.w > 0 ? Math.max(0.2, (selBox.h * w) / selBox.w) : selBox.h;
      resizeSelTo({ ...selBox, w, h });
    } else if (key === "h") {
      const h = Math.max(0.2, n);
      const w = lockAspect && selBox.h > 0 ? Math.max(0.2, (selBox.w * h) / selBox.h) : selBox.w;
      resizeSelTo({ ...selBox, w, h });
    } else if (key === "rot") {
      setSelRot(n);
    }
  };

  /** 图层显示 / 锁定 */
  const toggleFlag = (id: string, key: "hidden" | "locked") => {
    pushHistory();
    setShapes((list) =>
      list.map((s) => (s.id === id ? { ...s, [key]: !s[key] } : s)),
    );
    if (key === "hidden") setSel((cur2) => cur2.filter((x) => x !== id));
  };

  /** 复制一条（选中优先，否则复制最后一个） */
  const duplicateOne = () => {
    const base = shapes.find((s) => sel.includes(s.id)) ?? shapes[shapes.length - 1];
    if (!base) return;
    pushHistory();
    const copy = { ...base, id: nextId() } as DrawShape;
    // 偏移一点，避免完全重叠看不出来
    const off = Math.max(0.5, meta.vw / 48);
    translateShape(copy, off, off);
    setShapes((list) => [...list, copy]);
    setSel([copy.id]);
  };

  /* ---------------- 键盘 ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement | null)?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (sel.length) setSel([]);
        else closeRef.current();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSel();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSel();
        else groupSel();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel(shapes.map((s) => s.id));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSel();
        return;
      }
      const map: Record<string, Tool> = { v: "select", p: "pen", r: "rect", o: "circle", l: "line", t: "text" };
      if (map[e.key.toLowerCase()]) {
        setTool(map[e.key.toLowerCase()]);
        return;
      }
      if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.25;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushHistory();
        setShapes((list) =>
          list.map((s) =>
            sel.includes(s.id) && !s.locked
              ? translateShape({ ...s } as DrawShape, dx, dy)
              : s,
          ),
        );
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [duplicateSel, groupSel, redo, removeSel, sel, shapes, undo, ungroupSel]);

  /* ---------------- 输出 ---------------- */
  /** 文字图层 → path 图层：用 canvas 追踪字形轮廓（vector 不支持 <text>）；失败返回 null */
  const textShapeToPath = useCallback(
    (s: DrawShape): DrawShape | null => {
      if (s.type !== "text") return null;
      const r = textToPathData(s.text, FONT_STACKS[s.font ?? "sans"] ?? FONT_STACKS.sans, {
        size: s.size,
        bold: s.bold,
      });
      if (!r) return null;
      return {
        id: s.id,
        type: "path",
        d: translatePath(r.d, s.x, s.y),
        fill: s.fill,
        stroke: s.outline ? s.stroke : "none",
        strokeWidth: s.outline ? s.strokeWidth : 0,
        alpha: s.alpha,
        rot: s.rot,
        locked: s.locked,
        hidden: s.hidden,
        group: s.group,
      } as DrawShape;
    },
    [],
  );

  /** 把指定文字图层就地换成 path（保持图层顺序与 id，可撤销） */
  const convertText = (ids: string[]) => {
    const target = new Set(ids);
    let done = 0;
    let failed = 0;
    const next: DrawShape[] = [];
    for (const s of shapes) {
      if (s.type === "text" && target.has(s.id)) {
        const p = textShapeToPath(s);
        if (p) {
          next.push(p);
          done += 1;
        } else {
          next.push(s);
          failed += 1;
        }
      } else {
        next.push(s);
      }
    }
    if (!done) {
      setErr(tt("文字转 path 失败（画布不可用或内容为空）"));
      return;
    }
    pushHistory();
    setShapes(next);
    setSel((list) => list.filter((id) => next.some((s) => s.id === id)));
    setErr(failed ? tt("{done} 个文字已转成 path，{failed} 个转换失败", { done, failed }) : "");
  };

  const model = useMemo(() => {
    /* 背景色：导出成铺满视口的底层矩形（vector 没有背景属性） */
    const withBg: DrawShape[] = bg
      ? [
          {
            id: "__bg",
            type: "rect",
            x: 0,
            y: 0,
            w: meta.vw,
            h: meta.vh,
            fill: bg,
            stroke: "none",
            strokeWidth: 0,
            alpha: 1,
          },
          ...shapes,
        ]
      : shapes;
    return shapesToModel(withBg, meta);
  }, [bg, shapes, meta]);
  const outXml = useMemo(() => buildVectorXml(model, resName || "ic_icon"), [model, resName]);

  /** M141：未保存提示 —— 画布动过（或改过资源名）就算脏，和初始快照比内容，不拿引用比 */
  const baseJson = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify({ meta, shapes }) !== baseJson.current || resName !== name;
  const guard = useUnsavedGuard({
    dirty,
    onSave: () => save(),
    canSave: Boolean(resName.trim()) && !err,
    hint: tt("这个图标"),
  });
  const close = () => guard.requestClose(onClose);
  closeRef.current = () => guard.requestClose(onClose);

  const save = () => {
    // M158：图标资源统一带 ic_ 前缀（已有 ic_xxx 不重复叠加）
    const safe = sanitizeResName(applyResNamePrefix(resName, "vector"), "ic");
    if (!safe) {
      setErr(tt("资源名不能为空"));
      return;
    }
    if (safe !== name && existingNames.includes(safe)) {
      setErr(tt("已存在同名资源 {name}", { name: safe }));
      return;
    }

    /* 文字图层：vector 不支持 <text>，保存前自动追踪成 path */
    let converted = 0;
    let textLeft = 0;
    const finalShapes: DrawShape[] = [];
    for (const s of shapes) {
      if (s.type === "text") {
        const p = textShapeToPath(s);
        if (p) {
          finalShapes.push(p);
          converted += 1;
          continue;
        }
        textLeft += 1;
      }
      finalShapes.push(s);
    }
    if (converted) setShapes(finalShapes);

    const withBg: DrawShape[] = bg
      ? [
          {
            id: "__bg",
            type: "rect",
            x: 0,
            y: 0,
            w: meta.vw,
            h: meta.vh,
            fill: bg,
            stroke: "none",
            strokeWidth: 0,
            alpha: 1,
          },
          ...finalShapes,
        ]
      : finalShapes;
    const finalModel = converted ? shapesToModel(withBg, meta) : model;

    if (!finalModel.paths.length) {
      setErr(textLeft ? tt("画布里只有文字，而且转换失败：先改成图形再保存") : tt("画布是空的，先画点东西"));
      return;
    }
    onSave(safe, buildVectorXml(finalModel, safe));
  };

  /* ===== M158：aapt2 真预览（图标 = 24/48/96dp 三档 ImageView） ===== */
  const doRealPreview = () => {
    if (realBusy) return;
    const safe = sanitizeResName(applyResNamePrefix(resName, "vector"), "ic");
    const preview = buildResourcePreviewFiles(safe, outXml, "icon");
    setRealBusy(true);
    setRealNote(tt("正在用设备上的 aapt2 编译…"));
    void renderReal(preview.layoutName, preview.files)
      .then((r) => {
        setRealBusy(false);
        setRealNote(
          r.ok
            ? tt("真机预览：资源包 {kb} KB（编译 {ms} ms），已打开真控件页", {
                kb: Math.round((r.bytes ?? 0) / 1024),
                ms: r.ms ?? 0,
              })
            : tt("真机预览失败（{stage}）：{log}", {
                stage: r.stage || tt("未知"),
                log: (r.log || "").slice(0, 260),
              }),
        );
      })
      .catch((e) => {
        setRealBusy(false);
        setRealNote(tt("真机预览失败：{reason}", { reason: String(e) }));
      });
  };

  /* ===== M171：设为应用图标 =====
     前景 = 当前画布的 vector（不含画布背景色），背景 = 单独选的颜色。
     生成 4 个文件：drawable/ic_launcher_foreground、drawable/ic_launcher_background、
     mipmap-anydpi-v26/ic_launcher(.round)。 */
  const appIconPreviewUrl = useMemo(() => vectorToDataUrl(outXml), [outXml]);
  const openAppIcon = () => {
    setAppIconErr("");
    if (bg && /^#[0-9a-fA-F]{3,8}$/.test(bg)) setAppIconBg(bg);
    setAppIconOpen(true);
  };
  const confirmAppIcon = () => {
    if (!onAppIcon) return;
    const safe = sanitizeResName(applyResNamePrefix(resName, "vector"), "ic");
    const r = buildAppIcon({ fgSourceXml: outXml, bgColor: appIconBg, contentDp: appIconDp });
    if (r.error) {
      setAppIconErr(r.error);
      return;
    }
    onAppIcon({ files: r.files, bgColor: r.bgColor, contentDp: appIconDp, sourceName: safe });
    setAppIconOpen(false);
  };

  /* ---------------- 从图标库换字形（M88：图标库直接给已换算好的 shapes） ---------------- */
  const applyIcon = (next: DrawShape[]) => {
    setPicking(false);
    if (!next.length) return;
    pushHistory();
    setShapes(next);
    setSel([]);
  };

  /** 把图标追加到当前画布（图标库已等比缩放居中），支持一张图标里拼多个字形 */
  const insertIcon = (next: DrawShape[]) => {
    setInserting(false);
    if (!next.length) return;
    const add = next.map((s) => ({ ...s, id: nextId() }) as DrawShape);
    pushHistory();
    setShapes((list) => [...list, ...add]);
    setSel(add.map((s) => s.id));
  };

  /** 按分组把图形切成连续的块（组内图形必须相邻才能包进同一个 <g>） */
  const shapeRuns = useMemo(() => {
    const runs: { key: string; g?: GroupSpec; shapes: DrawShape[] }[] = [];
    for (const s of shapes) {
      const spec = s.group ? groupById.get(s.group) : undefined;
      const last = runs[runs.length - 1];
      if (spec && last?.g?.id === spec.id) last.shapes.push(s);
      else if (spec) runs.push({ key: `g-${spec.id}-${runs.length}`, g: spec, shapes: [s] });
      else runs.push({ key: `s-${s.id}`, shapes: [s] });
    }
    return runs;
  }, [shapes, groupById]);

  /** 单个图形 → SVG（组变换由外层 <g> 负责，这里只管本地坐标） */
  const drawShapeEl = (s: DrawShape) =>
    s.type === "text" ? (
      <text
        key={s.id}
        x={s.x}
        y={s.y}
        fontSize={s.size}
        fontFamily={FONT_STACKS[s.font ?? "sans"] ?? FONT_STACKS.sans}
        fontWeight={s.bold ? 700 : 400}
        fill={isRenderableColor(s.fill) ? toCss(s.fill) : "none"}
        fillOpacity={s.alpha}
        stroke={s.outline && s.strokeWidth > 0 && isRenderableColor(s.stroke) ? toCss(s.stroke) : "none"}
        strokeWidth={(s.strokeWidth || 0) * 2}
        strokeLinejoin="round"
        paintOrder="stroke"
        opacity={s.hidden ? 0.25 : 1}
        transform={shapeRot(s)}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {s.text}
      </text>
    ) : (
      <path
        key={s.id}
        d={shapeD(s)}
        fillRule={s.type === "path" && s.fillType === "evenOdd" ? "evenodd" : undefined}
        fill={isRenderableColor(s.fill) ? toCss(s.fill) : "none"}
        fillOpacity={s.alpha}
        stroke={isRenderableColor(s.stroke) ? toCss(s.stroke) : "none"}
        strokeWidth={s.strokeWidth || 0}
        strokeOpacity={s.alpha}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={s.hidden ? 0.25 : 1}
        transform={shapeRot(s)}
        style={{ pointerEvents: "none" }}
      />
    );

  /** 选中项能否用四角手柄缩放（跨组多选时禁用，避免坐标系混乱） */
  const canResize = useMemo(() => {
    if (!selected.length) return false;
    const gids = new Set(selected.map((s) => s.group ?? ""));
    return gids.size === 1;
  }, [selected]);

  /** 图层列表行（倒序 = 上面的在最上层；组头放在它成员上方） */
  const layerRows = useMemo(() => {
    const rows: { key: string; g?: GroupSpec; s?: DrawShape }[] = [];
    for (let i = shapeRuns.length - 1; i >= 0; i--) {
      const run = shapeRuns[i];
      if (run.g) {
        rows.push({ key: `gh-${run.g.id}`, g: run.g });
        if (!run.g.collapsed) {
          for (let j = run.shapes.length - 1; j >= 0; j--) rows.push({ key: run.shapes[j].id, s: run.shapes[j] });
        }
      } else {
        for (let j = run.shapes.length - 1; j >= 0; j--) rows.push({ key: run.shapes[j].id, s: run.shapes[j] });
      }
    }
    return rows;
  }, [shapeRuns]);

  const gTransform =
    `translate(${meta.group.pivotX} ${meta.group.pivotY}) ` +
    `rotate(${meta.group.rotation}) ` +
    `scale(${meta.group.scaleX} ${meta.group.scaleY}) ` +
    `translate(${-meta.group.pivotX} ${-meta.group.pivotY})`;

  const cur = selected[0];
  /** 右侧 pathData 面板：选中里第一个 path 图元（多选时只编辑它） */
  const pathSel = useMemo(
    () => (selected.find((s) => s.type === "path") as Extract<DrawShape, { type: "path" }> | undefined) ?? null,
    [selected],
  );
  const strokeLen = 1 / Math.max(0.4, zoom);

  /* ---------------- 解析失败（普通图片 / 非 vector） ---------------- */
  if (kind === "bitmap" || kind === "other-xml") {
    const msg =
      kind === "bitmap"
        ? tt("这是普通图片（png / jpg 等位图），不是矢量图标 —— 图标编辑器只能改 <vector> 资源。位图请直接用图片资源，或点下面的按钮从图标库重新选一个。")
        : tt("这个文件不是标准 <vector>，暂时只能原样查看。可以点下面的按钮改用图标库里的字形。");
    const body = (
      <div className="axv-icon-page" role="dialog" aria-label={tt("图标编辑器")}>
        <div className="axv-shape-head">
          <button className="axv-icon-back" onClick={close} aria-label={tt("返回编辑器")} title={tt("返回")}>
            <span className="msr" aria-hidden="true">arrow_back</span>
          </button>
          <span className="axv-shape-title">{tt("编辑图标")} · {name}</span>
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
                  setMeta(BLANK.meta);
                  setShapes([]);
                  setSel([]);
                }}
              >{tt("从空白画布开始")}</button>
              <button className="axv-btn axv-ghost" onClick={close}>{tt("关闭")}</button>
            </div>
            {xml ? <textarea className="axv-icon-ed-raw" readOnly value={xml} /> : null}
          </div>
        </div>
      </div>
    );
    return typeof document === "undefined" ? body : createPortal(body, document.body);
  }

  const body = (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label={tt("图标编辑器")}>
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label={tt("返回编辑器")} title={tt("返回")}>
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">{tt("编辑图标")} · {name}</span>
        <span className="axv-cv-head-tools">
          <button className="axv-icon-btn" onClick={undo} title={tt("撤销 (Ctrl+Z)")} aria-label={tt("撤销")}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>undo</span>
          </button>
          <button className="axv-icon-btn" onClick={redo} title={tt("重做 (Ctrl+Shift+Z)")} aria-label={tt("重做")}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>redo</span>
          </button>
        </span>
      </div>

      <div className="axv-icon-page-body axv-cv-body">
        {/* 左：工具条 + 画布 */}
        <div className="axv-cv-left">
          <div className="axv-cv-tools" role="toolbar" aria-label={tt("绘制工具")}>
            {TOOLS.map((t) => (
              <button
                key={t.t}
                className={"axv-cv-tool" + (tool === t.t ? " on" : "")}
                onClick={() => setTool(t.t)}
                title={t.label + (t.key ? ` (${t.key})` : "")}
                aria-label={t.label}
                aria-pressed={tool === t.t}
              >
                <span className="msr" aria-hidden="true">{t.icon}</span>
              </button>
            ))}
            <span className="axv-cv-tool-sep" />
            <button
              className={"axv-cv-tool" + (showGrid ? " on" : "")}
              onClick={() => setShowGrid((v) => !v)}
              title={tt("网格")}
              aria-label={tt("网格")}
              aria-pressed={showGrid}
            >
              <span className="msr" aria-hidden="true">grid_on</span>
            </button>
            <button
              className="axv-cv-tool"
              onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
              title={tt("缩小")}
              aria-label={tt("缩小")}
            >
              <span className="msr" aria-hidden="true">zoom_out</span>
            </button>
            <button
              className="axv-cv-tool"
              onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10))}
              title={tt("放大")}
              aria-label={tt("放大")}
            >
              <span className="msr" aria-hidden="true">zoom_in</span>
            </button>
            <button className="axv-cv-tool" onClick={() => setZoom(fitZoom())} title={tt("复位缩放")} aria-label={tt("复位缩放")}>
              <span className="msr" aria-hidden="true">center_focus_strong</span>
            </button>
          </div>

          <div className="axv-cv-stage" ref={stageRef}>
            <div className="axv-cv-board" style={{ width: `${Math.round(300 * zoom)}px`, background: bg ? toCss(bg) : undefined }}>
              <svg
                viewBox={`0 0 ${meta.vw} ${meta.vh}`}
                className={"axv-cv-svg" + (tool === "select" ? " is-select" : "")}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <defs>
                  <pattern id="axv-cv-grid" width="2" height="2" patternUnits="userSpaceOnUse">
                    <path d="M2 0H0V2" fill="none" stroke="#00000012" strokeWidth="0.08" />
                  </pattern>
                </defs>
                {showGrid ? (
                  <rect x={0} y={0} width={meta.vw} height={meta.vh} fill="url(#axv-cv-grid)" />
                ) : null}
                <g ref={gRef} transform={gTransform}>
                  {shapeRuns.map((run) =>
                    run.g ? (
                      <g key={run.key} data-group={run.g.id} transform={groupTransform(run.g)}>
                        {run.shapes.map((s) => drawShapeEl(s))}
                      </g>
                    ) : (
                      <Fragment key={run.key}>{run.shapes.map((s) => drawShapeEl(s))}</Fragment>
                    ),
                  )}

                  {/* 画笔实时预览 */}
                  {penPts.length > 1 ? (
                    <path
                      d={smoothPath(penPts)}
                      fill="none"
                      stroke="#1b6ef3"
                      strokeWidth={Math.max(0.3, meta.vw / 80)}
                      strokeLinecap="round"
                      style={{ pointerEvents: "none" }}
                    />
                  ) : null}

                  {/* 选中框 + 四角手柄 */}
                  {selBox && selBoxView ? (
                    <g
                      style={{ pointerEvents: "none" }}
                      transform={selGroup ? groupTransform(selGroup) : undefined}
                      data-sel-frame={selGroup ? "group" : "canvas"}
                    >
                      <rect
                        x={selGroup ? selBox.x : selBoxView.x}
                        y={selGroup ? selBox.y : selBoxView.y}
                        width={selGroup ? selBox.w : selBoxView.w}
                        height={selGroup ? selBox.h : selBoxView.h}
                        fill="none"
                        stroke="#1b6ef3"
                        strokeWidth={strokeLen}
                        vectorEffect="non-scaling-stroke"
                      />
                      {canResize
                        ? handlePositions(selGroup ? selBox : selBoxView).map((h, i) => (
                            <circle
                              key={i}
                              cx={h.x}
                              cy={h.y}
                              r={
                                (meta.vw * 0.017) /
                                Math.max(0.4, zoom) /
                                (selGroupMat ? Math.max(0.05, Math.hypot(selGroupMat.a, selGroupMat.b)) : 1)
                              }
                              fill="#fff"
                              stroke="#1b6ef3"
                              strokeWidth={1.4}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))
                        : null}
                    </g>
                  ) : null}

                  {/* 框选 */}
                  {marquee ? (
                    <rect
                      x={Math.min(marquee.x0, marquee.x1)}
                      y={Math.min(marquee.y0, marquee.y1)}
                      width={Math.abs(marquee.x1 - marquee.x0)}
                      height={Math.abs(marquee.y1 - marquee.y0)}
                      fill="rgba(27,110,243,.08)"
                      stroke="rgba(27,110,243,.7)"
                      strokeWidth={strokeLen}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }}
                    />
                  ) : null}
                </g>
              </svg>
            </div>
            <div className="axv-cv-meta">
              {meta.w}×{meta.h}dp · viewport {meta.vw}×{meta.vh} · {shapes.length} {tt("个图形")}
              {sel.length ? tt(" · 选中 {n}", { n: sel.length }) : ""}
            </div>
          </div>
        </div>

        {/* 右：参数面板（移动端是靠右滑出的浮层，左侧带箭头开关） */}
        {formOpen ? (
          <div
            className="axv-cv-form-mask"
            onClick={() => setFormOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <button
          type="button"
          className={"axv-cv-form-toggle" + (formOpen ? "" : " is-closed")}
          onClick={() => setFormOpen((v) => !v)}
          aria-label={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
          title={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
        >
          <span className="msr" aria-hidden="true">
            {formOpen ? "chevron_right" : "chevron_left"}
          </span>
        </button>
        <div className={"axv-icon-ed-form axv-cv-form" + (formOpen ? "" : " is-closed")}>
          {!shapes.length ? (
            <div className="axv-icon-ed-warn">
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>info</span>
              <span>{tt("画布是空的：选左边工具画一个，或从图标库挑一个字形。")}<button className="axv-btn axv-ghost" style={{ marginLeft: 8 }} onClick={() => setPicking(true)}>{tt("选择图标")}</button>
              </span>
            </div>
          ) : null}
          {/* 路径数据（选中 path 图元时直接手改） */}
          {pathSel ? (
            <div className="axv-set-group">
              <div className="axv-set-label">
                pathData
                <span className="axv-cv-hint">{tt("· 可直接手改")}</span>
              </div>
              <textarea
                className="axv-icon-ed-pathdata"
                value={pathSel.d}
                spellCheck={false}
                onChange={(e) => patchSel({ d: e.target.value })}
                placeholder="M12 2 L22 20 H2 Z"
              />
            </div>
          ) : null}

          <div className="axv-set-group">
            {/* M135：XML 代码框默认一直展开，不再有收起按钮 */}
            <textarea className="axv-icon-ed-raw" readOnly value={outXml} />
          </div>
        </div>

        {/* 底部样式抽屉（移植 svg-board）：样式 / 排列 / 图层 / 画布 四个子页 */}
        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")}>
          <div className="axv-cv-sheet-head" onClick={() => setSheetOpen((v) => !v)}>
            <span className="axv-cv-grabber" aria-hidden="true" />
            <span className="axv-cv-sheet-title">{tt("样式")}</span>
            <div className="axv-cv-sheet-tabs" onClick={(e) => e.stopPropagation()}>
              {([["style", tt("样式")], ["props", tt("属性")], ["align", tt("排列")], ["layers", tt("图层")], ["res", tt("资源")], ["board", tt("画布")]] as const).map(([k, label]) => (
                <button
                  key={k}
                  className={"axv-cv-sheet-tab" + (sheetTab === k ? " on" : "")}
                  onClick={() => { setSheetTab(k); setSheetOpen(true); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="axv-cv-sheet-chev msr" aria-hidden="true">expand_more</span>
          </div>
          <div className="axv-cv-sheet-body">
            {sheetTab === "style" ? (
              <div className="axv-cv-sheet-pane">
            <div className="axv-set-group">
              <div className="axv-set-label">
                {cur ? tt("外观") : tt("新图形默认样式")}
                {cur ? (
                  <span className="axv-cv-hint">{tt("· 选中 {n} 个", { n: sel.length })}</span>
                ) : (
                  <span className="axv-cv-hint">{tt("· 未选中：这里改的是下一个新图形的初值")}</span>
                )}
              </div>
              {/* 预设色块：有选中 → 只改选中；没选中 → 全部上色 */}
              <div className="axv-cv-presets">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="axv-cv-preset"
                    style={{ background: c }}
                    title={sel.length ? tt("选中图形填 {c}", { c }) : tt("新图形默认填充 {c}", { c })}
                    onClick={() => {
                      /* 未选中时预设色改的是「新图形默认样式」，不再偷偷给全部图形上色 */
                      if (!sel.length) {
                        setDefStyle((d) => ({ ...d, fill: c, alpha: 1 }));
                        return;
                      }
                      pushHistory();
                      setShapes((list) =>
                        list.map((s) =>
                          sel.includes(s.id)
                            ? ({ ...s, fill: c, alpha: 1, ...(s.type === "line" ? { stroke: c } : {}) } as typeof s)
                            : s,
                        ),
                      );
                    }}
                  />
                ))}
              </div>
              <div className="axv-icon-ed-row">
                <span>{tt("填充")}</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{
                    background: isRenderableColor(styleTarget.fill) ? toCss(styleTarget.fill) : "#fff",
                  }}
                  onClick={() => setColorTarget({ kind: "fill" })}
                  title={tt("选择填充色")}
                >
                  <span className="axv-cv-swatch-val">{toHex6(styleTarget.fill)}</span>
                </button>
                <button
                  className={"axv-cv-toggle" + (styleTarget.fill === "none" ? " on" : "")}
                  onClick={() => patchStyle({ fill: styleTarget.fill === "none" ? "#1D1B20" : "none" })}
                  title={tt("无填充")}
                >{tt("无")}</button>
              </div>
              <div className="axv-icon-ed-row">
                <span>{tt("描边")}</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{
                    background: isRenderableColor(styleTarget.stroke) ? toCss(styleTarget.stroke) : "#fff",
                  }}
                  onClick={() => setColorTarget({ kind: "stroke" })}
                  title={tt("选择描边色")}
                >
                  <span className="axv-cv-swatch-val">{styleTarget.stroke === "none" ? tt("无") : toHex6(styleTarget.stroke)}</span>
                </button>
                <button
                  className={"axv-cv-toggle" + (styleTarget.stroke === "none" ? " on" : "")}
                  onClick={() => patchStyle({ stroke: styleTarget.stroke === "none" ? "#1D1B20" : "none" })}
                  title={tt("无描边")}
                >{tt("无")}</button>
              </div>
              <label className="axv-icon-ed-row">
                <span title={tt("描边粗细（viewport 单位）")}>{tt("粗细")}</span>
                <input
                  type="range"
                  min={0}
                  max={strokeMax}
                  step={0.05}
                  value={Math.min(strokeMax, styleTarget.strokeWidth || 0)}
                  onChange={(e) => patchStyle({ strokeWidth: Math.max(0, Number(e.target.value)) })}
                  title={tt("描边粗细（viewport 单位，0 = 无）")}
                />
                <b className="axv-icon-ed-val">{Math.round((styleTarget.strokeWidth || 0) * 100) / 100}</b>
              </label>
              <label className="axv-icon-ed-row">
                <span>{tt("不透明度")}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={styleTarget.alpha ?? 1}
                  onChange={(e) => patchStyle({ alpha: Number(e.target.value) })}
                />
                <b className="axv-icon-ed-val">{Math.round((styleTarget.alpha ?? 1) * 100)}%</b>
              </label>
  
              {/* 形状专属参数 */}
              {cur && (cur.type === "roundRect" || cur.type === "polygon" || cur.type === "star") ? (
                <div className="axv-cv-extra">
                  {cur.type === "roundRect" ? (
                    <label className="axv-icon-ed-row">
                      <span>{tt("圆角")}</span>
                      <input
                        className="axv-cv-num"
                        type="number"
                        min={0}
                        step={0.5}
                        value={cur.round ?? 0}
                        onChange={(e) => patchSel({ round: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                  ) : null}
                  {cur.type === "polygon" || cur.type === "star" ? (
                    <label className="axv-icon-ed-row">
                      <span>{tt("边数")}</span>
                      <input
                        className="axv-cv-num"
                        type="number"
                        min={3}
                        max={24}
                        value={cur.sides}
                        onChange={(e) => patchSel({ sides: Math.max(3, Math.min(24, Math.round(Number(e.target.value) || 3))) })}
                      />
                    </label>
                  ) : null}
                  {cur.type === "star" ? (
                    <label className="axv-icon-ed-row">
                      <span>{tt("内径")}</span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.95}
                        step={0.01}
                        value={cur.inner ?? 0.42}
                        onChange={(e) => patchSel({ inner: Number(e.target.value) })}
                      />
                      <b className="axv-icon-ed-val">{Math.round((cur.inner ?? 0.42) * 100)}%</b>
                    </label>
                  ) : null}
                </div>
              ) : null}
  
              {/* 文字参数（vector 不支持文字，导出会跳过） */}
              {cur && cur.type === "text" ? (
                <div className="axv-cv-extra">
                  <label className="axv-icon-ed-row">
                    <span>{tt("内容")}</span>
                    <input
                      className="axv-icon-ed-input"
                      value={cur.text}
                      onChange={(e) => patchSel({ text: e.target.value })}
                    />
                  </label>
                  <label className="axv-icon-ed-row">
                    <span>{tt("字号")}</span>
                    <input
                      className="axv-cv-num"
                      type="number"
                      min={1}
                      step={0.5}
                      value={cur.size}
                      onChange={(e) => patchSel({ size: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <select
                      className="sel axv-cv-num"
                      value={cur.font ?? "sans"}
                      onChange={(e) => patchSel({ font: e.target.value })}
                    >
                      <option value="sans">{tt("无衬线")}</option>
                      <option value="serif">{tt("衬线")}</option>
                      <option value="kai">{tt("楷体")}</option>
                      <option value="mono">{tt("等宽")}</option>
                    </select>
                  </label>
                  <div className="axv-cv-textnote">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>warning</span>
                    {tt("Android vector 不支持 <text>：保存时会自动把文字追踪成 path（可撤销），也可以现在手动转。")}
                    <button className="axv-cv-mini" onClick={() => convertText(sel.length ? sel : [cur.id])}>{tt("文字转 path")}</button>
                  </div>
                </div>
              ) : null}
  
              {cur && cur.type !== "path" && cur.type !== "text" ? (
                <div className="axv-cv-textnote">
                  <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>info</span>{tt("几何图形请直接拖拽 / 改上面的参数；想手改路径就先「转为路径」。")}<button className="axv-cv-mini" onClick={() => convertSelToPath()}>{tt("转为路径")}</button>
                </div>
              ) : null}
            </div>
              </div>
            ) : null}
            {sheetTab === "res" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-set-group">
                  <div className="axv-set-label">{tt("资源")}<span className="axv-cv-hint">{tt("· 保存写回 drawable/{name}.xml", { name: resName || "…" })}</span>
                  </div>
                  <div className="axv-icon-ed-row">
                    <span>{tt("名称")}</span>
                    <input
                      className="axv-icon-ed-input"
                      value={resName}
                      spellCheck={false}
                      onChange={(e) => {
                        setResName(cleanResNameInput(e.target.value));
                        setErr("");
                      }}
                    />
                    <button
                      className="axv-icon-ed-pick"
                      onClick={() => setPicking(true)}
                      title={tt("从图标库换字形（替换整个图标）")}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>apps</span>{tt("选择图标")}</button>
                  </div>
                  {err ? <div className="axv-icon-ed-err">{err}</div> : null}
                </div>
              </div>
            ) : null}
            {sheetTab === "board" ? (
              <div className="axv-cv-sheet-pane">
            <div className="axv-set-group">
              <div className="axv-set-label">{tt("画布尺寸")}<span className="axv-cv-hint">{tt("· viewport {w}×{h}，改尺寸会等比缩放图形", { w: meta.vw, h: meta.vh })}</span>
              </div>
              <div className="axv-cv-sizes">
                {[24, 48, 96, 240, 512].map((n) => (
                  <button
                    key={n}
                    className={"axv-cv-size" + (meta.vw === n && meta.vh === n ? " on" : "")}
                    onClick={() => resizeViewport(n)}
                    title={`viewport ${n}×${n}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="axv-icon-ed-row">
                <span>{tt("自定义")}</span>
                <span className="axv-icon-ed-two">
                  <input
                    className="axv-icon-ed-input"
                    type="number"
                    min={1}
                    max={2048}
                    value={Math.round(meta.vw)}
                    onChange={(e) => resizeViewport(Number(e.target.value) || 24)}
                  />
                  <input
                    className="axv-icon-ed-input"
                    type="number"
                    min={1}
                    max={2048}
                    value={Math.round(meta.vh)}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(2048, Math.round(Number(e.target.value) || 24)));
                      if (v === meta.vh) return;
                      pushHistory();
                      const from = { x: 0, y: 0, w: meta.vw, h: meta.vh };
                      const to = { x: 0, y: 0, w: meta.vw, h: v };
                      setShapes((list) =>
                        list.map((s) =>
                          scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, from, to),
                        ),
                      );
                      setMeta((m) => ({ ...m, vh: v }));
                    }}
                  />
                </span>
              </div>
            </div>
            <div className="axv-set-group">
              <div className="axv-set-label">{tt("画布")}<span className="axv-cv-hint">{tt("· 背景会导出成底层矩形")}</span>
              </div>
              <div className="axv-icon-ed-row">
                <span>{tt("背景")}</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{ background: bg ? toCss(bg) : "#fff" }}
                  onClick={() => setColorTarget({ kind: "bg" })}
                  title={tt("选择背景色")}
                >
                  <span className="axv-cv-swatch-val">{bg ? toHex6(bg) : tt("无")}</span>
                </button>
                <button
                  className="axv-cv-toggle"
                  onClick={() => setBg("")}
                  disabled={!bg}
                  title={tt("透明背景")}
                >{tt("透明")}</button>
              </div>
              <div className="axv-icon-ed-row">
                <span>{tt("网格")}</span>
                <label className="axv-cv-chk">
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />{tt("显示网格")}</label>
              </div>
            </div>
              </div>
            ) : null}
            {sheetTab === "props" ? (
              <div className="axv-cv-sheet-pane">
                {selGroup ? (
                  <div className="axv-set-group axv-cv-grp-panel" data-group-panel={selGroup.id}>
                    <div className="axv-set-label">{tt("分组变换")}<span className="axv-cv-hint">{tt("· {name}（导出为 <group>）", { name: selGroup.name || selGroup.id })}</span>
                    </div>
                    <div className="axv-icon-ed-row">
                      <span>{tt("旋转")}</span>
                      <input
                        className="axv-cv-slider"
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={Math.round(selGroup.rot)}
                        onChange={(e) => patchGroup(selGroup.id, { rot: Number(e.target.value) })}
                      />
                      <span className="axv-cv-val">{Math.round(selGroup.rot)}°</span>
                    </div>
                    <div className="axv-icon-ed-row">
                      <span>{tt("缩放")}</span>
                      <input
                        className="axv-cv-slider"
                        type="range"
                        min={0.1}
                        max={3}
                        step={0.05}
                        value={selGroup.sx}
                        onChange={(e) =>
                          patchGroup(selGroup.id, { sx: Number(e.target.value), sy: Number(e.target.value) })
                        }
                      />
                      <span className="axv-cv-val">{Math.round(selGroup.sx * 100)}%</span>
                    </div>
                    <div className="axv-icon-ed-row">
                      <span>{tt("平移")}</span>
                      <span className="axv-icon-ed-two">
                        <input
                          className="axv-icon-ed-input"
                          type="number"
                          step={0.5}
                          value={Math.round(selGroup.tx * 100) / 100}
                          title="translateX"
                          onChange={(e) => patchGroup(selGroup.id, { tx: Number(e.target.value) || 0 })}
                        />
                        <input
                          className="axv-icon-ed-input"
                          type="number"
                          step={0.5}
                          value={Math.round(selGroup.ty * 100) / 100}
                          title="translateY"
                          onChange={(e) => patchGroup(selGroup.id, { ty: Number(e.target.value) || 0 })}
                        />
                      </span>
                    </div>
                  </div>
                ) : null}
                <div className="axv-set-group">
                  <div className="axv-set-label">
                    {tt("图层属性")}
                    {cur && selBox ? (
                      <span className="axv-cv-hint">{tt("· 选中 {n} 个，单位 viewport", { n: sel.length })}</span>
                    ) : (
                      <span className="axv-cv-hint">{tt("· 先在画布或图层页选一个图形")}</span>
                    )}
                  </div>
                  {cur && selBox ? (
                    <>
                      <div className="axv-icon-ed-row">
                        <span>{tt("位置")}</span>
                        <span className="axv-icon-ed-two">
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            value={propDraft?.x ?? ""}
                            title="X"
                            onChange={(e) => setPropDraft((d) => (d ? { ...d, x: e.target.value } : d))}
                            onBlur={() => commitProp("x")}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            value={propDraft?.y ?? ""}
                            title="Y"
                            onChange={(e) => setPropDraft((d) => (d ? { ...d, y: e.target.value } : d))}
                            onBlur={() => commitProp("y")}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                        </span>
                      </div>
                      <div className="axv-icon-ed-row">
                        <span>{tt("大小")}</span>
                        <span className="axv-icon-ed-two">
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            min={0.2}
                            value={propDraft?.w ?? ""}
                            title={tt("宽")}
                            onChange={(e) => setPropDraft((d) => (d ? { ...d, w: e.target.value } : d))}
                            onBlur={() => commitProp("w")}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            min={0.2}
                            value={propDraft?.h ?? ""}
                            title={tt("高")}
                            onChange={(e) => setPropDraft((d) => (d ? { ...d, h: e.target.value } : d))}
                            onBlur={() => commitProp("h")}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                        </span>
                      </div>
                      <div className="axv-icon-ed-row">
                        <span>{tt("比例")}</span>
                        <label className="axv-cv-chk">
                          <input
                            type="checkbox"
                            checked={lockAspect}
                            onChange={(e) => setLockAspect(e.target.checked)}
                          />{tt("锁定宽高比（取消后会拉伸）")}</label>
                      </div>
                      <div className="axv-icon-ed-row">
                        <span>{tt("旋转")}</span>
                        <span className="axv-icon-ed-two">
                          <button
                            className="axv-cv-mini"
                            onClick={() => nudgeRot(-1)}
                            title={tt("逆时针 1°")}
                            aria-label={tt("逆时针 1 度")}
                          >
                            −1°
                          </button>
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={1}
                            value={propDraft?.rot ?? ""}
                            title={tt("旋转角度（度）")}
                            onChange={(e) => setPropDraft((d) => (d ? { ...d, rot: e.target.value } : d))}
                            onBlur={() => commitProp("rot")}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                          <button
                            className="axv-cv-mini"
                            onClick={() => nudgeRot(1)}
                            title={tt("顺时针 1°")}
                            aria-label={tt("顺时针 1 度")}
                          >
                            +1°
                          </button>
                          <button
                            className="axv-cv-mini"
                            onClick={() => setSelRot(0)}
                            title={tt("角度归零")}
                          >{tt("归零")}</button>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="axv-cv-empty">{tt("选一个图形后可精确调 X / Y、宽 / 高和旋转角度。")}</div>
                  )}
                </div>
              </div>
            ) : null}
            {sheetTab === "align" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-cv-set-label">{tt("排列")}<span className="axv-cv-hint">{tt("· 选中 1 个按画布对齐，≥2 个互相对齐，均分需 ≥3 个")}</span>
                </div>
                {sel.length >= 1 ? (
                  <div className="axv-cv-align">
                    {([
                      ["left", "align_horizontal_left", tt("左对齐")],
                      ["hcenter", "align_horizontal_center", tt("水平居中")],
                      ["right", "align_horizontal_right", tt("右对齐")],
                      ["top", "align_vertical_top", tt("顶对齐")],
                      ["vcenter", "align_vertical_center", tt("垂直居中")],
                      ["bottom", "align_vertical_bottom", tt("底对齐")],
                      ["hdist", "horizontal_distribute", tt("水平均分")],
                      ["vdist", "vertical_distribute", tt("垂直均分")],
                    ] as const).map(([mode, icon, label]) => (
                      <button
                        key={mode}
                        className="axv-cv-align-btn"
                        onClick={() => alignSel(mode)}
                        title={label}
                        aria-label={label}
                        disabled={(mode === "hdist" || mode === "vdist") && sel.length < 3}
                      >
                        <span className="msr" aria-hidden="true">{icon}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="axv-cv-textnote">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>info</span>{tt("先在画布上框选或用「图层」多选（Shift 点）两个以上图形。")}</div>
                )}

                <div className="axv-set-group" style={{ marginTop: 8 }}>
                  <div className="axv-set-label">{tt("整体变换")}<span className="axv-cv-hint">{tt("· 旋转/镜像写进 &lt;group&gt;")}</span>
                  </div>
                  <div className="axv-icon-ed-btns">
                    <button
                      className="axv-set-btn"
                      onClick={() => setMeta((m) => ({ ...m, group: { ...m.group, rotation: nextRotation(m.group.rotation) } }))}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>rotate_90_degrees_cw</span>
                      {tt("旋转 {deg}°", { deg: meta.group.rotation })}
                    </button>
                    <button
                      className={"axv-set-btn" + (meta.group.scaleX === -1 ? " on" : "")}
                      onClick={() =>
                        setMeta((m) => ({ ...m, group: { ...m.group, scaleX: m.group.scaleX === -1 ? 1 : -1 } }))
                      }
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>{tt("水平镜像")}</button>
                    <button
                      className={"axv-set-btn" + (meta.group.scaleY === -1 ? " on" : "")}
                      onClick={() =>
                        setMeta((m) => ({ ...m, group: { ...m.group, scaleY: m.group.scaleY === -1 ? 1 : -1 } }))
                      }
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>{tt("垂直镜像")}</button>
                  </div>
                </div>
              </div>
            ) : null}
            {sheetTab === "layers" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-cv-set-label">
                  {tt("图形（{n}）", { n: shapes.length })}
                  <span className="axv-cv-hint">{tt("· 点一行选中，Shift 多选")}</span>
                  <button className="axv-cv-mini" onClick={() => setInserting(true)} title={tt("插入图标（追加成新图层）")}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>add</span>{tt("插入")}</button>
                  <button className="axv-cv-mini" onClick={duplicateOne} title={tt("复制一条（选中优先）")}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>content_copy</span>{tt("复制")}</button>
                  <button className="axv-cv-mini" onClick={groupSel} title={tt("编组 (Ctrl+G)")}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>folder_shared</span>{tt("编组")}</button>
                  <button className="axv-cv-mini" onClick={ungroupSel} title={tt("解组 (Ctrl+Shift+G)")}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>folder_off</span>{tt("解组")}</button>
                  <button className="axv-cv-mini" onClick={removeSel} title={tt("删除选中图形 (Delete)")}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>delete</span>{tt("删除")}</button>
                </div>
            <div className="axv-cv-layers">
              {layerRows.map((row) => {
                if (row.g) {
                  const g = row.g;
                  const n = shapes.filter((x) => x.group === g.id).length;
                  const on = shapes.some((x) => x.group === g.id && sel.includes(x.id));
                  return (
                    <div key={row.key} className={"axv-cv-grp" + (on ? " on" : "")} data-group-row={g.id}>
                      <button
                        className="axv-cv-layer-btn"
                        title={g.collapsed ? tt("展开组") : tt("折叠组")}
                        aria-label={g.collapsed ? tt("展开组") : tt("折叠组")}
                        onClick={(e) => {
                          e.stopPropagation();
                          patchGroup(g.id, { collapsed: !g.collapsed });
                        }}
                      >
                        <span className="msr" aria-hidden="true">{g.collapsed ? "chevron_right" : "expand_more"}</span>
                      </button>
                      <span className="msr axv-cv-grp-ico" aria-hidden="true">folder</span>
                      <input
                        className="axv-cv-grp-name"
                        value={g.name ?? g.id}
                        title={tt("组名（导出为 android:name）")}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectGroup(g.id);
                        }}
                        onChange={(e) => patchGroup(g.id, { name: e.target.value })}
                      />
                      <span className="axv-cv-hint">{n}</span>
                      <button
                        className="axv-cv-layer-btn"
                        title={tt("选中整组")}
                        aria-label={tt("选中整组")}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectGroup(g.id);
                        }}
                      >
                        <span className="msr" aria-hidden="true">select_all</span>
                      </button>
                      <button
                        className="axv-cv-layer-btn"
                        title={tt("解组")}
                        aria-label={tt("解组")}
                        onClick={(e) => {
                          e.stopPropagation();
                          ungroupIds([g.id]);
                        }}
                      >
                        <span className="msr" aria-hidden="true">folder_off</span>
                      </button>
                    </div>
                  );
                }
                const s = row.s!;
                const idx = shapes.findIndex((x) => x.id === s.id);
                return (
                  <div
                    key={s.id}
                    data-layer-id={s.id}
                    className={
                      "axv-cv-layer" +
                      (sel.includes(s.id) ? " on" : "") +
                      (s.hidden ? " is-hidden" : "") +
                      (s.locked ? " is-locked" : "") +
                      (dragLayerId === s.id ? " is-dragging" : "") +
                      (dragOverId === s.id && dragLayerId !== s.id ? " is-drop" : "")
                    }
                    onClick={(e) =>
                      setSel((cur2) =>
                        e.shiftKey
                          ? cur2.includes(s.id)
                            ? cur2.filter((x) => x !== s.id)
                            : [...cur2, s.id]
                          : [s.id],
                      )
                    }
                  >
                    <span
                      className="axv-cv-layer-grip msr"
                      title={tt("拖动排序")}
                      aria-hidden="true"
                      onPointerDown={(e) => onGripDown(e, s.id)}
                    >
                      drag_indicator
                    </span>
                    <span
                      className="axv-cv-layer-dot"
                      style={{ background: isRenderableColor(s.fill) ? toCss(s.fill) : "transparent" }}
                    />
                    <span className="axv-cv-layer-name">
                      {LAYER_LABEL[s.type]} {idx + 1}
                    </span>
                    <span className="axv-cv-layer-d" title={s.type === "text" ? s.text : s.type === "path" ? s.d : shapeD(s)}>
                      {s.type === "text" ? s.text : (s.type === "path" ? s.d : shapeD(s)).slice(0, 18)}
                    </span>
                    <button
                      className="axv-cv-layer-btn"
                      title={tt("取色（这条）")}
                      aria-label={tt("取色")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel([s.id]);
                        setColorTarget({ kind: "fill" });
                      }}
                    >
                      <span className="msr" aria-hidden="true">palette</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title={s.hidden ? tt("显示") : tt("隐藏")}
                      aria-label={s.hidden ? tt("显示") : tt("隐藏")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFlag(s.id, "hidden");
                      }}
                    >
                      <span className="msr" aria-hidden="true">{s.hidden ? "visibility_off" : "visibility"}</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title={s.locked ? tt("解锁") : tt("锁定")}
                      aria-label={s.locked ? tt("解锁") : tt("锁定")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFlag(s.id, "locked");
                      }}
                    >
                      <span className="msr" aria-hidden="true">{s.locked ? "lock" : "lock_open"}</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title={tt("上移一层")}
                      aria-label={tt("上移一层")}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayerOne(s.id, 1);
                      }}
                    >
                      <span className="msr" aria-hidden="true">arrow_upward</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title={tt("下移一层")}
                      aria-label={tt("下移一层")}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayerOne(s.id, -1);
                      }}
                    >
                      <span className="msr" aria-hidden="true">arrow_downward</span>
                    </button>
                    <button
                      className="axv-icon-ed-del"
                      title={tt("删除")}
                      onClick={(e) => {
                        e.stopPropagation();
                        pushHistory();
                        setShapes((list) => list.filter((x) => x.id !== s.id));
                        setSel((c) => c.filter((x) => x !== s.id));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {!shapes.length ? <div className="axv-cv-empty">{tt("画布还是空的：选个工具，在左边拖一下")}</div> : null}
            </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>
          <span className="axv-icon-page-foot-note">{realNote || tt("保存后立即写回 drawable/{name}.xml，布局里所有引用同步生效。", { name: resName || "…" })}</span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {onAppIcon ? (
            <button
              className="axv-btn axv-ghost"
              onClick={openAppIcon}
              title={tt("把当前图形做成桌面图标（前景 + 背景色 + 自适应裁剪）")}
            >
              {tt("设为应用图标")}
            </button>
          ) : null}
          {hasRealRender() ? (
            <button
              className="axv-btn axv-ghost"
              onClick={doRealPreview}
              disabled={realBusy}
              title={tt("用设备上的 aapt2 真编译这个图标，再用系统 ImageView 渲染")}
            >
              {realBusy ? tt("编译中…") : tt("真机预览")}
            </button>
          ) : null}
          <button className="axv-btn axv-ghost" onClick={close}>{tt("取消")}</button>
          <button className="axv-btn axv-btn-primary" onClick={save}>{tt("保存")}</button>
        </span>
      </div>

      {/* M79：统一颜色选择器 */}
      {colorTarget ? (
        <ColorPicker
          label={
            colorTarget.kind === "fill"
              ? tt("填充颜色")
              : colorTarget.kind === "stroke"
                ? tt("描边颜色")
                : tt("画布背景色")
          }
          value={
            colorTarget.kind === "fill"
              ? styleTarget.fill && styleTarget.fill !== "none"
                ? styleTarget.fill
                : "#1D1B20"
              : colorTarget.kind === "stroke"
                ? styleTarget.stroke && styleTarget.stroke !== "none"
                  ? styleTarget.stroke
                  : "#1D1B20"
                : bg || "#ffffff"
          }
          presets={PRESET_COLORS}
          abovePage
          onClose={() => setColorTarget(null)}
          onConfirm={(next) => {
            if (colorTarget.kind === "bg") {
              setBg(toHex6(next));
              setColorTarget(null);
              return;
            }
            {
              const rgba = parseColorOr(next, "#1D1B20");
              // 透明度用 s.alpha 表达（填充/描边共用），颜色只存 #RRGGBB，避免 alpha 算两遍
              if (colorTarget.kind === "fill") {
                patchStyle({ fill: toHex6(next), alpha: rgba.a });
              } else {
                patchStyle({
                  stroke: toHex6(next),
                  strokeWidth: (styleTarget.strokeWidth ?? 0) > 0 ? styleTarget.strokeWidth : 1,
                  alpha: rgba.a,
                });
              }
            }
            setColorTarget(null);
          }}
        />
      ) : null}

      {/* M171：应用图标设置 */}
      {appIconOpen ? (
        <div className="axv-ai-check" role="dialog" aria-label={tt("设为应用图标")}>
          <div className="axv-ai-check-card">
            <div className="axv-ai-check-head">
              <span className="axv-shape-title">{tt("设为应用图标")}</span>
              <button className="axv-icon-btn" onClick={() => setAppIconOpen(false)} aria-label={tt("关闭")}>
                <span className="msr" aria-hidden="true">close</span>
              </button>
            </div>

            <div className="axv-ai-masks">
              {([
                { key: "circle", label: tt("圆形"), radius: "50%" },
                { key: "squircle", label: tt("方圆"), radius: "28%" },
                { key: "square", label: tt("方形"), radius: "10%" },
              ] as const).map((m) => (
                <div key={m.key} className="axv-ai-mask">
                  <div
                    className="axv-ai-mask-view"
                    style={{ background: appIconBg, borderRadius: m.radius, overflow: "hidden" }}
                  >
                    {appIconPreviewUrl ? (
                      <img
                        src={appIconPreviewUrl}
                        alt=""
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          width: `${(appIconDp / 108) * 100}%`,
                          height: `${(appIconDp / 108) * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    ) : null}
                  </div>
                  <span className="axv-ai-mask-name">{m.label}</span>
                </div>
              ))}
            </div>

            <div className="axv-ai-row">
              <span className="axv-set-label">{tt("背景色")}</span>
              <div className="axv-ai-swatches">
                {["#3FBFA0", "#2F6BFF", "#7C4DFF", "#F2542D", "#111827", "#FFFFFF"].map((c) => (
                  <button
                    key={c}
                    className="axv-ai-swatch"
                    style={{ background: c, outline: appIconBg.toLowerCase() === c.toLowerCase() ? "2px solid #2F6BFF" : "1px solid rgba(0,0,0,.15)" }}
                    onClick={() => setAppIconBg(c)}
                    aria-label={c}
                  />
                ))}
                <input
                  className="axv-ai-color"
                  value={appIconBg}
                  onChange={(e) => setAppIconBg(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="axv-ai-row">
              <span className="axv-set-label">{tt("前景尺寸 {dp}dp", { dp: appIconDp })}</span>
              <input
                type="range"
                min={40}
                max={108}
                step={2}
                value={appIconDp}
                onChange={(e) => setAppIconDp(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
            <div className="axv-ai-hint">
              {tt("安全区 72dp：系统按厂商遮罩裁切，超出部分可能被切掉。画布底色不会进前景，底色请在上面的背景色里选。")}
            </div>
            <div className="axv-ai-hint">
              {tt("将生成：drawable/ic_launcher_foreground.xml、drawable/ic_launcher_background.xml、mipmap-anydpi-v26/ic_launcher.xml、mipmap-anydpi-v26/ic_launcher_round.xml")}
            </div>
            {appIconErr ? <div className="axv-ai-err">{appIconErr}</div> : null}

            <div className="axv-ai-btns">
              <button className="axv-btn axv-ghost" onClick={() => setAppIconOpen(false)}>{tt("取消")}</button>
              <button className="axv-btn axv-btn-primary" onClick={confirmAppIcon}>{tt("生成应用图标")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 换字形 */}
      {picking ? (
        <IconPickerPanel
          title={tt("选择图标")}
          viewport={{ vw: meta.vw, vh: meta.vh }}
          onClose={() => setPicking(false)}
          onPick={(shapes) => applyIcon(shapes)}
        />
      ) : null}

      {/* 插入图标（多图标拼合） */}
      {inserting ? (
        <IconPickerPanel
          title={tt("插入图标")}
          viewport={{ vw: meta.vw, vh: meta.vh }}
          onClose={() => setInserting(false)}
          mode="insert"
          onPick={(shapes) => insertIcon(shapes)}
        />
      ) : null}
    </div>
  );

  return typeof document === "undefined" ? body : createPortal(body, document.body);
}

const LAYER_LABEL: Record<DrawShape["type"], string> = {
  rect: tt("矩形"),
  roundRect: tt("圆角矩形"),
  circle: tt("圆形"),
  ellipse: tt("椭圆"),
  line: tt("直线"),
  polygon: tt("多边形"),
  star: tt("星形"),
  path: tt("路径"),
  text: tt("文字"),
};
