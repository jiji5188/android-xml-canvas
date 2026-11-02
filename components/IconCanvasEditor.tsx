"use client";

// components/IconCanvasEditor.tsx — M81：画布式图标编辑器（取代 M11j 的参数式 IconEditor）
//
// 布局与 svg-board 一致：左边画布（可画 / 可摆 / 可拖），右边参数面板，底部保存回 res/drawable。
// 输出仍然是标准 <vector>（lib/xml/vector-edit.ts 的 buildVectorXml），保存链路不变：
//   shapes ──shapesToModel──> VectorModel ──buildVectorXml──> drawable xml
// 打开已有图标时反向：xml ──parseVectorModel──> VectorModel ──modelToShapes──> 每条 path 一个可编辑图元。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBack } from "@/lib/overlay-back";
import { buildVectorXml, parseVectorModel, nextRotation } from "@/lib/xml/vector-edit";
import {
  isRenderableColor,
  modelToShapes,
  scalePath,
  scaleShape,
  shapeBox,
  shapeD,
  shapesToModel,
  smoothPath,
  toCss,
  translateShape,
  unionBox,
  alignShapes,
  convertShapesToPaths,
  moveInList,
  type Box,
  type CanvasMeta,
  type DrawShape,
} from "@/lib/xml/canvas-shapes";
import { IconPickerPanel } from "./IconPickerPanel";
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
  { t: "select", icon: "arrow_selector_tool", label: "选择", key: "V" },
  { t: "pen", icon: "stylus_note", label: "画笔", key: "P" },
  { t: "rect", icon: "crop_square", label: "矩形", key: "R" },
  { t: "roundRect", icon: "rounded_corner", label: "圆角矩形" },
  { t: "circle", icon: "circle", label: "圆形", key: "O" },
  { t: "ellipse", icon: "tonality", label: "椭圆" },
  { t: "line", icon: "show_chart", label: "直线", key: "L" },
  { t: "polygon", icon: "pentagon", label: "多边形" },
  { t: "star", icon: "star", label: "星形" },
  { t: "text", icon: "title", label: "文字", key: "T" },
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

export default function IconCanvasEditor({ name, xml, onClose, onSave, existingNames = [] }: Props) {
  const kind = useMemo(() => inspect(xml), [xml]);

  const initial = useMemo<Snapshot>(() => {
    const model = parseVectorModel(xml ?? "");
    if (!model) return JSON.parse(JSON.stringify(BLANK)) as Snapshot;
    return {
      meta: { w: model.w, h: model.h, vw: model.vw, vh: model.vh, group: { ...model.group } },
      shapes: modelToShapes(model),
    };
  }, [xml]);

  const [meta, setMeta] = useState<CanvasMeta>(initial.meta);
  const [shapes, setShapes] = useState<DrawShape[]>(initial.shapes);
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [resName, setResName] = useState(name);
  const [err, setErr] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [picking, setPicking] = useState(false);
  /** 插入图标（多图标拼合）：不替换现有图形，而是把选中的图标追加成新图层 */
  const [inserting, setInserting] = useState(false);
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

  /* 自适应缩放：初始 / 「复位缩放」按钮都用画布区实际高度来 fit，而不是写死 1 */
  const fitZoom = useCallback(() => {
    const el = stageRef.current;
    if (!el) return 1;
    const f = (el.clientHeight - 96) / 300; // 300 = 基准板尺寸(px)@zoom1
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
    | { kind: "move"; start: { x: number; y: number }; orig: { id: string; box: Box }[] }
    | { kind: "resize"; box0: Box; corner: number; orig: DrawShape[] }
    | { kind: "pen"; pts: { x: number; y: number }[] }
    | { kind: "marquee"; x0: number; y0: number }
  >(null);
  const [penPts, setPenPts] = useState<{ x: number; y: number }[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // M78：系统返回键也能关；必须放在任何 early return 之前
  const close = useOverlayBack(true, onClose);

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
  const selBox = useMemo<Box | null>(() => (selected.length ? unionBox(selected) : null), [selected]);

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

  const hitTest = useCallback(
    (p: { x: number; y: number }): DrawShape | null => {
      const pad = 3 / pxPerUnit();
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (s.hidden || s.locked) continue;
        const b = shapeBox(s);
        if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
          return s;
        }
      }
      return null;
    },
    [shapes, pxPerUnit],
  );

  /* ---------------- 新建图元 ---------------- */
  const nextId = useCallback(
    () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    [],
  );

  const styleOf = useCallback(() => {
    const base = selected[0];
    if (base) {
      return { fill: base.fill, stroke: base.stroke, strokeWidth: base.strokeWidth, alpha: base.alpha };
    }
    return { fill: "#1D1B20", stroke: "none", strokeWidth: 0, alpha: 1 };
  }, [selected]);

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
            round: Math.max(0.5, meta.vw * 0.1),
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
            text: "文字",
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

    // 先判选中框的角手柄
    if (selBox && selected.length) {
      const hs = handlePositions(selBox);
      /* 真·屏幕像素容差：鼠标 8px / 触摸 18px（原来按 zoom 折算，图标上角点会放大到 ~30px，
         鼠标一按在图形边缘就被判成拉伸手柄 → 拖动时图形被拉变形） */
      const tol = (e.pointerType === "touch" ? 18 : 8) / pxPerUnit();
      for (let i = 0; i < hs.length; i++) {
        if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) <= tol) {
          pushHistory();
          dragRef.current = {
            kind: "resize",
            box0: { ...selBox },
            corner: i,
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
            return sh ? { id, box: shapeBox(sh) } : null;
          })
          .filter((x): x is { id: string; box: Box } => !!x),
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
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      setShapes((list) =>
        list.map((s) => {
          const o = d.orig.find((x) => x.id === s.id);
          if (!o) return s;
          const cur = shapeBox(s);
          return translateShape(s, o.box.x + dx - cur.x, o.box.y + dy - cur.y);
        }),
      );
      return;
    }

    if (d.kind === "resize") {
      const hs = handlePositions(d.box0);
      const fixed = hs[(d.corner + 2) % 4];
      const box1: Box = {
        x: Math.min(fixed.x, p.x),
        y: Math.min(fixed.y, p.y),
        w: Math.max(0.15, Math.abs(p.x - fixed.x)),
        h: Math.max(0.15, Math.abs(p.y - fixed.y)),
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
          const b = shapeBox(s);
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

  const removeSel = () => {
    if (!sel.length) return;
    pushHistory();
    setShapes((list) => list.filter((s) => !sel.includes(s.id)));
    setSel([]);
  };

  const duplicateSel = () => {
    if (!sel.length) return;
    pushHistory();
    const copies = selected.map((s) => {
      const c = JSON.parse(JSON.stringify(s)) as DrawShape;
      c.id = nextId();
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
  /** 把选中图形整体搬到目标包围盒（也可用于改大小） */
  const setSelBox = (patch: Partial<Box>) => {
    if (!sel.length || !selBox) return;
    const to: Box = {
      x: patch.x ?? selBox.x,
      y: patch.y ?? selBox.y,
      w: Math.max(0.2, patch.w ?? selBox.w),
      h: Math.max(0.2, patch.h ?? selBox.h),
    };
    if (to.x === selBox.x && to.y === selBox.y && to.w === selBox.w && to.h === selBox.h) return;
    pushHistory();
    const from = { ...selBox };
    setShapes((list) =>
      list.map((s) =>
        sel.includes(s.id) ? scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, from, to) : s,
      ),
    );
  };

  /** 选中图层的旋转角（多选时以第一个为准显示） */
  const selRot = selected[0]?.rot ?? 0;

  const setSelRot = (deg: number) => {
    if (!sel.length) return;
    const v = Math.max(-180, Math.min(180, Math.round(deg * 10) / 10));
    pushHistory();
    setShapes((list) => list.map((s) => (sel.includes(s.id) ? { ...s, rot: v } : s)));
  };

  const nudgeRot = (step: number) => setSelRot((selRot || 0) + step);

  /** 层级：提到最前 / 沉到最后 */
  const moveSel = (dir: "front" | "back") => {
    if (!sel.length) return;
    pushHistory();
    setShapes((list) => moveInList(list, sel, dir));
  };

  /** 删除选中 */
  const deleteSel = () => {
    if (!sel.length) return;
    pushHistory();
    setShapes((list) => list.filter((s) => !sel.includes(s.id)));
    setSel([]);
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
        else close();
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
  }, [close, duplicateSel, redo, removeSel, sel, shapes, undo]);

  /* ---------------- 输出 ---------------- */
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
  /** 文字图元数量：导出时会被忽略，要提醒 */
  const textCount = useMemo(() => shapes.filter((s) => s.type === "text" && !s.hidden).length, [shapes]);
  const outXml = useMemo(() => buildVectorXml(model, resName || "ic_icon"), [model, resName]);

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
    if (!model.paths.length) {
      setErr(textCount ? "画布里只有文字：Android vector 不支持文字，请先把文字换成图形或路径" : "画布是空的，先画点东西");
      return;
    }
    onSave(safe, buildVectorXml(model, safe));
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
        ? "这是普通图片（png / jpg 等位图），不是矢量图标 —— 图标编辑器只能改 <vector> 资源。位图请直接用图片资源，或点下面的按钮从图标库重新选一个。"
        : "这个文件不是标准 <vector>，暂时只能原样查看。可以点下面的按钮改用图标库里的字形。";
    const body = (
      <div className="axv-icon-page" role="dialog" aria-label="图标编辑器">
        <div className="axv-shape-head">
          <button className="axv-icon-back" onClick={close} aria-label="返回编辑器" title="返回">
            <span className="msr" aria-hidden="true">arrow_back</span>
          </button>
          <span className="axv-shape-title">编辑图标 · {name}</span>
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
              >
                从空白画布开始
              </button>
              <button className="axv-btn axv-ghost" onClick={close}>
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

  const body = (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label="图标编辑器">
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label="返回编辑器" title="返回">
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">编辑图标 · {name}</span>
        <span className="axv-cv-head-tools">
          <button className="axv-icon-btn" onClick={undo} title="撤销 (Ctrl+Z)" aria-label="撤销">
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>undo</span>
          </button>
          <button className="axv-icon-btn" onClick={redo} title="重做 (Ctrl+Shift+Z)" aria-label="重做">
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>redo</span>
          </button>
        </span>
      </div>

      <div className="axv-icon-page-body axv-cv-body">
        {/* 左：工具条 + 画布 */}
        <div className="axv-cv-left">
          <div className="axv-cv-tools" role="toolbar" aria-label="绘制工具">
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
              title="网格"
              aria-label="网格"
              aria-pressed={showGrid}
            >
              <span className="msr" aria-hidden="true">grid_on</span>
            </button>
            <button
              className="axv-cv-tool"
              onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
              title="缩小"
              aria-label="缩小"
            >
              <span className="msr" aria-hidden="true">zoom_out</span>
            </button>
            <button
              className="axv-cv-tool"
              onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10))}
              title="放大"
              aria-label="放大"
            >
              <span className="msr" aria-hidden="true">zoom_in</span>
            </button>
            <button className="axv-cv-tool" onClick={() => setZoom(fitZoom())} title="复位缩放" aria-label="复位缩放">
              <span className="msr" aria-hidden="true">center_focus_strong</span>
            </button>
          </div>

          <div className="axv-cv-stage" ref={stageRef}>
            <div className="axv-cv-board" style={{ width: `${Math.round(300 * zoom)}px`, background: bg ? toCss(bg) : "#fff" }}>
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
                <rect x={0} y={0} width={meta.vw} height={meta.vh} fill={bg ? toCss(bg) : "#ffffff"} />
                {showGrid ? (
                  <rect x={0} y={0} width={meta.vw} height={meta.vh} fill="url(#axv-cv-grid)" />
                ) : null}
                <g ref={gRef} transform={gTransform}>
                  {shapes.map((s) =>
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
                  {selBox ? (
                    <g style={{ pointerEvents: "none" }}>
                      <rect
                        x={selBox.x}
                        y={selBox.y}
                        width={selBox.w}
                        height={selBox.h}
                        fill="none"
                        stroke="#1b6ef3"
                        strokeWidth={strokeLen}
                        vectorEffect="non-scaling-stroke"
                      />
                      {handlePositions(selBox).map((h, i) => (
                        <circle
                          key={i}
                          cx={h.x}
                          cy={h.y}
                          r={(meta.vw * 0.017) / Math.max(0.4, zoom)}
                          fill="#fff"
                          stroke="#1b6ef3"
                          strokeWidth={1.4}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
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
              {meta.w}×{meta.h}dp · viewport {meta.vw}×{meta.vh} · {shapes.length} 个图形
              {sel.length ? ` · 选中 ${sel.length}` : ""}
            </div>
          </div>
        </div>

        {/* 右：参数面板（移动端是靠右滑出的浮层，左侧带箭头开关） */}
        <button
          type="button"
          className={"axv-cv-form-toggle" + (formOpen ? "" : " is-closed")}
          onClick={() => setFormOpen((v) => !v)}
          aria-label={formOpen ? "收起参数面板" : "展开参数面板"}
          title={formOpen ? "收起参数面板" : "展开参数面板"}
        >
          <span className="msr" aria-hidden="true">
            {formOpen ? "chevron_right" : "chevron_left"}
          </span>
        </button>
        <div className={"axv-icon-ed-form axv-cv-form" + (formOpen ? "" : " is-closed")}>
          {!shapes.length ? (
            <div className="axv-icon-ed-warn">
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>info</span>
              <span>
                画布是空的：选左边工具画一个，或从图标库挑一个字形。
                <button className="axv-btn axv-ghost" style={{ marginLeft: 8 }} onClick={() => setPicking(true)}>
                  选择图标
                </button>
              </span>
            </div>
          ) : null}
          {/* 路径数据（选中 path 图元时直接手改） */}
          {pathSel ? (
            <div className="axv-set-group">
              <div className="axv-set-label">
                pathData
                <span className="axv-cv-hint">· 可直接手改</span>
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
            <button className="axv-set-btn" onClick={() => setShowRaw((v) => !v)}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
              {showRaw ? "收起 XML" : "查看生成的 XML"}
            </button>
            {showRaw ? <textarea className="axv-icon-ed-raw" readOnly value={outXml} /> : null}
          </div>
        </div>

        {/* 底部样式抽屉（移植 svg-board）：样式 / 排列 / 图层 / 画布 四个子页 */}
        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")}>
          <div className="axv-cv-sheet-head" onClick={() => setSheetOpen((v) => !v)}>
            <span className="axv-cv-grabber" aria-hidden="true" />
            <span className="axv-cv-sheet-title">样式</span>
            <div className="axv-cv-sheet-tabs" onClick={(e) => e.stopPropagation()}>
              {([["style", "样式"], ["props", "属性"], ["align", "排列"], ["layers", "图层"], ["res", "资源"], ["board", "画布"]] as const).map(([k, label]) => (
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
                外观
                {cur ? <span className="axv-cv-hint">· 选中 {sel.length} 个</span> : <span className="axv-cv-hint">· 未选中（改的是下一个新图形）</span>}
              </div>
              {/* 预设色块：有选中 → 只改选中；没选中 → 全部上色 */}
              <div className="axv-cv-presets">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="axv-cv-preset"
                    style={{ background: c }}
                    title={sel.length ? `选中图形填 ${c}` : `全部图形填 ${c}`}
                    onClick={() => {
                      pushHistory();
                      const ids = sel.length ? sel : shapes.map((s) => s.id);
                      setShapes((list) =>
                        list.map((s) =>
                          ids.includes(s.id)
                            ? ({ ...s, fill: c, alpha: 1, ...(s.type === "line" ? { stroke: c } : {}) } as typeof s)
                            : s,
                        ),
                      );
                    }}
                  />
                ))}
              </div>
              <div className="axv-icon-ed-row">
                <span>填充</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{
                    background: isRenderableColor(cur?.fill ?? "#1D1B20") ? toCss(cur?.fill ?? "#1D1B20") : "#fff",
                  }}
                  onClick={() => setColorTarget({ kind: "fill" })}
                  title="选择填充色"
                >
                  <span className="axv-cv-swatch-val">{toHex6(cur?.fill ?? "#1D1B20")}</span>
                </button>
                <button
                  className={"axv-cv-toggle" + ((cur?.fill ?? "#1D1B20") === "none" ? " on" : "")}
                  onClick={() => {
                    if (!sel.length) return;
                    pushHistory();
                    patchSel({ fill: cur?.fill === "none" ? "#1D1B20" : "none" });
                  }}
                  title="无填充"
                >
                  无
                </button>
              </div>
              <div className="axv-icon-ed-row">
                <span>描边</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{
                    background: isRenderableColor(cur?.stroke ?? "none") ? toCss(cur?.stroke ?? "none") : "#fff",
                  }}
                  onClick={() => setColorTarget({ kind: "stroke" })}
                  title="选择描边色"
                >
                  <span className="axv-cv-swatch-val">{cur?.stroke === "none" ? "无" : toHex6(cur?.stroke ?? "#1D1B20")}</span>
                </button>
                <input
                  className="axv-cv-num"
                  type="number"
                  min={0}
                  step={0.25}
                  value={cur?.strokeWidth ?? 0}
                  onChange={(e) => {
                    if (!sel.length) return;
                    patchSel({ strokeWidth: Math.max(0, Number(e.target.value) || 0) });
                  }}
                  title="描边宽度（viewport 单位）"
                />
              </div>
              <label className="axv-icon-ed-row">
                <span>不透明度</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={cur?.alpha ?? 1}
                  onChange={(e) => {
                    if (!sel.length) return;
                    patchSel({ alpha: Number(e.target.value) });
                  }}
                />
                <b className="axv-icon-ed-val">{Math.round((cur?.alpha ?? 1) * 100)}%</b>
              </label>
  
              {/* 形状专属参数 */}
              {cur && (cur.type === "roundRect" || cur.type === "polygon" || cur.type === "star") ? (
                <div className="axv-cv-extra">
                  {cur.type === "roundRect" ? (
                    <label className="axv-icon-ed-row">
                      <span>圆角</span>
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
                      <span>边数</span>
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
                      <span>内径</span>
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
                    <span>内容</span>
                    <input
                      className="axv-icon-ed-input"
                      value={cur.text}
                      onChange={(e) => patchSel({ text: e.target.value })}
                    />
                  </label>
                  <label className="axv-icon-ed-row">
                    <span>字号</span>
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
                      <option value="sans">无衬线</option>
                      <option value="serif">衬线</option>
                      <option value="kai">楷体</option>
                      <option value="mono">等宽</option>
                    </select>
                  </label>
                  <div className="axv-cv-textnote">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>warning</span>
                    文字只用于画布查看：Android vector 不支持 &lt;text&gt;，保存时会被忽略。
                  </div>
                </div>
              ) : null}
  
              {cur && cur.type !== "path" && cur.type !== "text" ? (
                <div className="axv-cv-textnote">
                  <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>info</span>
                  几何图形请直接拖拽 / 改上面的参数；想手改路径就先「转为路径」。
                  <button className="axv-cv-mini" onClick={() => convertSelToPath()}>
                    转为路径
                  </button>
                </div>
              ) : null}
            </div>
              </div>
            ) : null}
            {sheetTab === "res" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-set-group">
                  <div className="axv-set-label">
                    资源
                    <span className="axv-cv-hint">· 保存写回 drawable/{resName || "…"}.xml</span>
                  </div>
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
                    <button
                      className="axv-icon-ed-pick"
                      onClick={() => setPicking(true)}
                      title="从图标库换字形（替换整个图标）"
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>apps</span>
                      选择图标
                    </button>
                  </div>
                  {err ? <div className="axv-icon-ed-err">{err}</div> : null}
                </div>
              </div>
            ) : null}
            {sheetTab === "board" ? (
              <div className="axv-cv-sheet-pane">
            <div className="axv-set-group">
              <div className="axv-set-label">
                画布尺寸
                <span className="axv-cv-hint">· viewport {meta.vw}×{meta.vh}，改尺寸会等比缩放图形</span>
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
                <span>自定义</span>
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
              <div className="axv-set-label">
                画布
                <span className="axv-cv-hint">· 背景会导出成底层矩形</span>
              </div>
              <div className="axv-icon-ed-row">
                <span>背景</span>
                <button
                  type="button"
                  className="axv-cv-swatch"
                  style={{ background: bg ? toCss(bg) : "#fff" }}
                  onClick={() => setColorTarget({ kind: "bg" })}
                  title="选择背景色"
                >
                  <span className="axv-cv-swatch-val">{bg ? toHex6(bg) : "无"}</span>
                </button>
                <button
                  className="axv-cv-toggle"
                  onClick={() => setBg("")}
                  disabled={!bg}
                  title="透明背景"
                >
                  透明
                </button>
              </div>
              <div className="axv-icon-ed-row">
                <span>网格</span>
                <label className="axv-cv-chk">
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                  显示网格
                </label>
              </div>
            </div>
              </div>
            ) : null}
            {sheetTab === "props" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-set-group">
                  <div className="axv-set-label">
                    图层属性
                    {cur && selBox ? (
                      <span className="axv-cv-hint">· 选中 {sel.length} 个，单位 viewport</span>
                    ) : (
                      <span className="axv-cv-hint">· 先在画布或图层页选一个图形</span>
                    )}
                  </div>
                  {cur && selBox ? (
                    <>
                      <div className="axv-icon-ed-row">
                        <span>位置</span>
                        <span className="axv-icon-ed-two">
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            value={Math.round(selBox.x * 100) / 100}
                            title="X"
                            onChange={(e) => setSelBox({ x: Number(e.target.value) })}
                          />
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            value={Math.round(selBox.y * 100) / 100}
                            title="Y"
                            onChange={(e) => setSelBox({ y: Number(e.target.value) })}
                          />
                        </span>
                      </div>
                      <div className="axv-icon-ed-row">
                        <span>大小</span>
                        <span className="axv-icon-ed-two">
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            min={0.2}
                            value={Math.round(selBox.w * 100) / 100}
                            title="宽"
                            onChange={(e) => setSelBox({ w: Number(e.target.value) })}
                          />
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={0.5}
                            min={0.2}
                            value={Math.round(selBox.h * 100) / 100}
                            title="高"
                            onChange={(e) => setSelBox({ h: Number(e.target.value) })}
                          />
                        </span>
                      </div>
                      <div className="axv-icon-ed-row">
                        <span>旋转</span>
                        <span className="axv-icon-ed-two">
                          <button
                            className="axv-cv-mini"
                            onClick={() => nudgeRot(-1)}
                            title="逆时针 1°"
                            aria-label="逆时针 1 度"
                          >
                            −1°
                          </button>
                          <input
                            className="axv-icon-ed-input"
                            type="number"
                            step={1}
                            value={Math.round(selRot * 10) / 10}
                            title="旋转角度（度）"
                            onChange={(e) => setSelRot(Number(e.target.value))}
                          />
                          <button
                            className="axv-cv-mini"
                            onClick={() => nudgeRot(1)}
                            title="顺时针 1°"
                            aria-label="顺时针 1 度"
                          >
                            +1°
                          </button>
                          <button
                            className="axv-cv-mini"
                            onClick={() => setSelRot(0)}
                            title="角度归零"
                          >
                            归零
                          </button>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="axv-cv-empty">选一个图形后可精确调 X / Y、宽 / 高和旋转角度。</div>
                  )}
                </div>
              </div>
            ) : null}
            {sheetTab === "align" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-cv-set-label">
                  排列
                  <span className="axv-cv-hint">· 选中 1 个按画布对齐，≥2 个互相对齐，均分需 ≥3 个</span>
                </div>
                {sel.length >= 1 ? (
                  <div className="axv-cv-align">
                    {([
                      ["left", "align_horizontal_left", "左对齐"],
                      ["hcenter", "align_horizontal_center", "水平居中"],
                      ["right", "align_horizontal_right", "右对齐"],
                      ["top", "align_vertical_top", "顶对齐"],
                      ["vcenter", "align_vertical_center", "垂直居中"],
                      ["bottom", "align_vertical_bottom", "底对齐"],
                      ["hdist", "horizontal_distribute", "水平均分"],
                      ["vdist", "vertical_distribute", "垂直均分"],
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
                    <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>info</span>
                    先在画布上框选或用「图层」多选（Shift 点）两个以上图形。
                  </div>
                )}

                <div className="axv-set-group" style={{ marginTop: 8 }}>
                  <div className="axv-set-label">
                    整体变换
                    <span className="axv-cv-hint">· 旋转/镜像写进 &lt;group&gt;</span>
                  </div>
                  <div className="axv-icon-ed-btns">
                    <button
                      className="axv-set-btn"
                      onClick={() => setMeta((m) => ({ ...m, group: { ...m.group, rotation: nextRotation(m.group.rotation) } }))}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>rotate_90_degrees_cw</span>
                      旋转 {meta.group.rotation}°
                    </button>
                    <button
                      className={"axv-set-btn" + (meta.group.scaleX === -1 ? " on" : "")}
                      onClick={() =>
                        setMeta((m) => ({ ...m, group: { ...m.group, scaleX: m.group.scaleX === -1 ? 1 : -1 } }))
                      }
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>
                      水平镜像
                    </button>
                    <button
                      className={"axv-set-btn" + (meta.group.scaleY === -1 ? " on" : "")}
                      onClick={() =>
                        setMeta((m) => ({ ...m, group: { ...m.group, scaleY: m.group.scaleY === -1 ? 1 : -1 } }))
                      }
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>flip</span>
                      垂直镜像
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {sheetTab === "layers" ? (
              <div className="axv-cv-sheet-pane">
                <div className="axv-cv-set-label">
                  图形（{shapes.length}）
                  <span className="axv-cv-hint">· 点一行选中，Shift 多选</span>
                  <button className="axv-cv-mini" onClick={() => setInserting(true)} title="插入图标（追加成新图层）">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>add</span>
                    插入
                  </button>
                  <button className="axv-cv-mini" onClick={duplicateOne} title="复制一条（选中优先）">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>content_copy</span>
                    复制
                  </button>
                  <button className="axv-cv-mini" onClick={removeSel} title="删除选中图形 (Delete)">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 13 }}>delete</span>
                    删除
                  </button>
                </div>
            <div className="axv-cv-layers">
              {[...shapes].reverse().map((s) => {
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
                      title="拖动排序"
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
                      title="取色（这条）"
                      aria-label="取色"
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
                      title={s.hidden ? "显示" : "隐藏"}
                      aria-label={s.hidden ? "显示" : "隐藏"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFlag(s.id, "hidden");
                      }}
                    >
                      <span className="msr" aria-hidden="true">{s.hidden ? "visibility_off" : "visibility"}</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title={s.locked ? "解锁" : "锁定"}
                      aria-label={s.locked ? "解锁" : "锁定"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFlag(s.id, "locked");
                      }}
                    >
                      <span className="msr" aria-hidden="true">{s.locked ? "lock" : "lock_open"}</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title="上移一层"
                      aria-label="上移一层"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayerOne(s.id, 1);
                      }}
                    >
                      <span className="msr" aria-hidden="true">arrow_upward</span>
                    </button>
                    <button
                      className="axv-cv-layer-btn"
                      title="下移一层"
                      aria-label="下移一层"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayerOne(s.id, -1);
                      }}
                    >
                      <span className="msr" aria-hidden="true">arrow_downward</span>
                    </button>
                    <button
                      className="axv-icon-ed-del"
                      title="删除"
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
              {!shapes.length ? <div className="axv-cv-empty">画布还是空的：选个工具，在左边拖一下</div> : null}
            </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>
          <span className="axv-icon-page-foot-note">保存后立即写回 drawable/{resName || "…"}.xml，布局里所有引用同步生效。</span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={close}>
            取消
          </button>
          <button className="axv-btn axv-btn-primary" onClick={save}>
            保存
          </button>
        </span>
      </div>

      {/* M79：统一颜色选择器 */}
      {colorTarget ? (
        <ColorPicker
          label={
            colorTarget.kind === "fill"
              ? "填充颜色"
              : colorTarget.kind === "stroke"
                ? "描边颜色"
                : "画布背景色"
          }
          value={
            colorTarget.kind === "fill"
              ? cur?.fill && cur.fill !== "none"
                ? cur.fill
                : "#1D1B20"
              : colorTarget.kind === "stroke"
                ? cur?.stroke && cur.stroke !== "none"
                  ? cur.stroke
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
            if (sel.length) {
              pushHistory();
              const rgba = parseColorOr(next, "#1D1B20");
              // 透明度用 s.alpha 表达（填充/描边共用），颜色只存 #RRGGBB，避免 alpha 算两遍
              if (colorTarget.kind === "fill") {
                patchSel({ fill: toHex6(next), alpha: rgba.a });
              } else {
                patchSel({
                  stroke: toHex6(next),
                  strokeWidth: (cur?.strokeWidth ?? 0) > 0 ? cur?.strokeWidth : 1,
                  alpha: rgba.a,
                });
              }
            }
            setColorTarget(null);
          }}
        />
      ) : null}

      {/* 换字形 */}
      {picking ? (
        <IconPickerPanel
          title="选择图标"
          viewport={{ vw: meta.vw, vh: meta.vh }}
          onClose={() => setPicking(false)}
          onPick={(shapes) => applyIcon(shapes)}
        />
      ) : null}

      {/* 插入图标（多图标拼合） */}
      {inserting ? (
        <IconPickerPanel
          title="插入图标"
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
  rect: "矩形",
  roundRect: "圆角矩形",
  circle: "圆形",
  ellipse: "椭圆",
  line: "直线",
  polygon: "多边形",
  star: "星形",
  path: "路径",
  text: "文字",
};
