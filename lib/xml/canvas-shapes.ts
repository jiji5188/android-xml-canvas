// lib/xml/canvas-shapes.ts — M81：画布式图标编辑器的图形模型
//
// 目的：把「在画布上摆放/拖动画出来的图元」与主工程已有的 vector 序列化打通。
//   shapes（可编辑图元）  ⇄  VectorModel（lib/xml/vector-edit.ts）  →  buildVectorXml
//
// 只做纯数据转换，不碰 DOM，方便单测。

import type { VectorModel, VectorPath, VectorGroup } from "./vector-edit";

/** 图元类型（与 svg-board 对齐） */
export type ShapeType =
  | "rect"
  | "roundRect"
  | "circle"
  | "ellipse"
  | "line"
  | "polygon"
  | "star"
  | "path"
  /** 文字：只能画布内显示，vector drawable 不支持 <text>，保存时会被忽略 */
  | "text";

export interface BaseShape {
  id: string;
  type: ShapeType;
  /** 填充色（#RRGGBB / #AARRGGBB / "none"） */
  fill: string;
  /** 描边色（同上，"none" 表示不描边） */
  stroke: string;
  /** 描边宽度（viewport 单位） */
  strokeWidth: number;
  /** 整体不透明度 0~1 */
  alpha: number;
  /** 自身旋转角度（度，顺时针；绕自身包围盒中心）。M88l：属性面板微调用 */
  rot?: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface RectShape extends BaseShape {
  type: "rect" | "roundRect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** 圆角（仅 roundRect 用，viewport 单位） */
  round?: number;
}

export interface CircleShape extends BaseShape {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseShape extends BaseShape {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface LineShape extends BaseShape {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolygonShape extends BaseShape {
  type: "polygon" | "star";
  cx: number;
  cy: number;
  r: number;
  sides: number;
  /** 星形内径比例 0~1 */
  inner?: number;
}

export interface PathShape extends BaseShape {
  type: "path";
  d: string;
}

export interface TextShape extends BaseShape {
  type: "text";
  /** 基线起点 */
  x: number;
  y: number;
  text: string;
  /** 字号（viewport 单位） */
  size: number;
  font?: string;
  bold?: boolean;
  outline?: boolean;
}

export type DrawShape =
  | RectShape
  | CircleShape
  | EllipseShape
  | LineShape
  | PolygonShape
  | PathShape
  | TextShape;

/** 画布尺寸（单位与 viewport 一致：1 = 1 viewport 单位） */
export interface CanvasMeta {
  /** 输出宽高（dp） */
  w: number;
  h: number;
  /** 视口 */
  vw: number;
  vh: number;
  /** 整体变换（旋转/镜像），导出为 <group> */
  group: VectorGroup;
}

const TAU = Math.PI * 2;

export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function nstr(n: number): string {
  const v = r3(n);
  return String(Object.is(v, -0) ? 0 : v);
}

/* ---------------- 图元 → pathData ---------------- */

export function rectPath(x: number, y: number, w: number, h: number, round = 0): string {
  const W = Math.abs(w);
  const H = Math.abs(h);
  const X = Math.min(x, x + w);
  const Y = Math.min(y, y + h);
  const r = Math.max(0, Math.min(round, Math.min(W, H) / 2));
  if (r <= 0) {
    return `M${nstr(X)},${nstr(Y)}h${nstr(W)}v${nstr(H)}h${nstr(-W)}Z`;
  }
  return [
    `M${nstr(X + r)},${nstr(Y)}`,
    `h${nstr(W - r * 2)}`,
    `a${nstr(r)},${nstr(r)} 0 0 1 ${nstr(r)},${nstr(r)}`,
    `v${nstr(H - r * 2)}`,
    `a${nstr(r)},${nstr(r)} 0 0 1 ${nstr(-r)},${nstr(r)}`,
    `h${nstr(-(W - r * 2))}`,
    `a${nstr(r)},${nstr(r)} 0 0 1 ${nstr(-r)},${nstr(-r)}`,
    `v${nstr(-(H - r * 2))}`,
    `a${nstr(r)},${nstr(r)} 0 0 1 ${nstr(r)},${nstr(-r)}`,
    "Z",
  ].join("");
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const RX = Math.abs(rx);
  const RY = Math.abs(ry);
  if (RX <= 0 || RY <= 0) return "";
  return (
    `M${nstr(cx - RX)},${nstr(cy)}` +
    `a${nstr(RX)},${nstr(RY)} 0 1 0 ${nstr(RX * 2)},0` +
    `a${nstr(RX)},${nstr(RY)} 0 1 0 ${nstr(-RX * 2)},0Z`
  );
}

export function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M${nstr(x1)},${nstr(y1)}L${nstr(x2)},${nstr(y2)}`;
}

export function polygonPath(cx: number, cy: number, r: number, sides: number): string {
  const n = Math.max(3, Math.round(sides || 6));
  const R = Math.abs(r);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n - Math.PI / 2;
    parts.push(
      `${i ? "L" : "M"}${nstr(cx + R * Math.cos(a))},${nstr(cy + R * Math.sin(a))}`,
    );
  }
  return parts.join("") + "Z";
}

export function starPath(cx: number, cy: number, r: number, inner = 0.42, points = 5): string {
  const p = Math.max(3, Math.round(points || 5));
  const R = Math.abs(r);
  const ir = R * Math.max(0.05, Math.min(0.98, inner));
  const parts: string[] = [];
  for (let i = 0; i < p * 2; i++) {
    const a = (Math.PI * i) / p - Math.PI / 2;
    const rr = i % 2 ? ir : R;
    parts.push(
      `${i ? "L" : "M"}${nstr(cx + rr * Math.cos(a))},${nstr(cy + rr * Math.sin(a))}`,
    );
  }
  return parts.join("") + "Z";
}

/** 图元 → pathData（path 类型原样返回） */
export function shapeD(s: DrawShape): string {
  switch (s.type) {
    case "rect":
    case "roundRect":
      return rectPath(s.x, s.y, s.w, s.h, s.type === "roundRect" ? s.round ?? 0 : 0);
    case "circle":
      return ellipsePath(s.cx, s.cy, s.r, s.r);
    case "ellipse":
      return ellipsePath(s.cx, s.cy, s.rx, s.ry);
    case "line":
      return linePath(s.x1, s.y1, s.x2, s.y2);
    case "polygon":
      return polygonPath(s.cx, s.cy, s.r, s.sides);
    case "star":
      return starPath(s.cx, s.cy, s.r, s.inner ?? 0.42, s.sides);
    case "path":
      return s.d;
    case "text":
      /* vector drawable 没有文字概念，导出时跳过 */
      return "";
  }
  return "";
}

/* ---------------- 图元 ⇄ VectorModel ---------------- */

const isHexLike = (c: string) => /^#[0-9a-fA-F]{6,8}$/.test(c.trim());
const isResRef = (c: string) => /^@/.test(c.trim());

/** 图元 → 一条 vector path（颜色拆成 fillColor + fillAlpha） */
function toVectorPath(s: DrawShape): VectorPath | null {
  const d = shapeD(s);
  if (!d) return null;
  const fill = (s.fill || "").trim();
  const stroke = (s.stroke || "").trim();
  const hasFill = fill && fill !== "none";
  const hasStroke = stroke && stroke !== "none" && s.strokeWidth > 0;

  const out: VectorPath = { d, fill: "#00000000" };
  if (hasFill) {
    out.fill = fill;
    if (s.alpha !== 1) out.alpha = r3(s.alpha);
  }
  if (hasStroke) {
    out.stroke = stroke;
    out.strokeWidth = r3(s.strokeWidth);
    /* 描边自己也有透明度；整体 alpha 同时作用在填充和描边上 */
    if (s.alpha !== 1) out.strokeAlpha = r3(s.alpha);
  }
  if (!hasFill && !hasStroke) return null;
  /* M88l：单个图层的旋转，导出成各自的 <group android:rotation> */
  if (s.rot && Math.abs(s.rot) > 0.001) {
    const b = shapeBox(s);
    out.rotation = r3(s.rot);
    out.pivotX = r3(b.x + b.w / 2);
    out.pivotY = r3(b.y + b.h / 2);
  }
  return out;
}

/** 图元列表 → VectorModel（供 buildVectorXml 序列化） */
export function shapesToModel(shapes: DrawShape[], meta: CanvasMeta): VectorModel {
  const paths: VectorPath[] = [];
  for (const s of shapes) {
    if (s.hidden) continue;
    const p = toVectorPath(s);
    if (p) paths.push(p);
  }
  return {
    w: meta.w,
    h: meta.h,
    vw: meta.vw,
    vh: meta.vh,
    group: { ...meta.group },
    paths,
  };
}

/** VectorModel → 图元列表（每条 path 变成一个可编辑 path 图元） */
export function modelToShapes(model: VectorModel): DrawShape[] {
  return model.paths.map((p, i) => {
    const alpha = p.alpha ?? 1;
    return {
      id: `p${i + 1}`,
      type: "path" as const,
      d: p.d,
      fill: p.fill,
      stroke: p.stroke ?? "none",
      strokeWidth: p.strokeWidth ?? 0,
      alpha,
      rot: p.rotation ?? 0,
    } satisfies PathShape;
  });
}

/* ---------------- 颜色小工具 ---------------- */

/** "#AARRGGBB" → { hex:"#RRGGBB", a:0~1 }（也接受 #RRGGBB / rgba()） */
export function splitColor(raw: string): { hex: string; a: number } {
  const s = (raw || "").trim();
  const m8 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{6})$/.exec(s);
  if (m8) return { hex: "#" + m8[2], a: parseInt(m8[1], 16) / 255 };
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m6) return { hex: "#" + m6[1], a: 1 };
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgba) {
    const hex =
      "#" +
      [rgba[1], rgba[2], rgba[3]]
        .map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, "0"))
        .join("");
    return { hex, a: rgba[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgba[4]))) };
  }
  return { hex: s || "#000000", a: 1 };
}

/** 颜色是否可以被画布渲染（资源引用 @color/x 无法直出，画布用兜底灰） */
export function isRenderableColor(c: string): boolean {
  const s = (c || "").trim();
  if (!s || s === "none") return false;
  if (isResRef(s)) return false;
  return isHexLike(s) || /^rgba?\(/i.test(s);
}

/** 给画布/预览用的 CSS 颜色 */
export function toCss(c: string, fallback = "#000000"): string {
  const s = (c || "").trim();
  if (!s || s === "none") return "none";
  if (isResRef(s)) return fallback;
  const { hex, a } = splitColor(s);
  if (!isHexLike(hex)) return fallback;
  return a >= 0.999 ? hex.toLowerCase() : hexToRgba(hex, a);
}

export function hexToRgba(hex: string, a: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${r3(a)})`;
}

/* ---------------- 图元包围盒 ---------------- */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 解析 pathData 的包围盒（支持 M/L/H/V/C/S/Q/T/A/Z，绝对与相对）— 控制点近似（够编辑器用） */
export function pathBox(d: string): Box {
  const pts = pathPoints(d);
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: Math.max(0.001, x1 - x0), h: Math.max(0.001, y1 - y0) };
}

/** pathData → 采样点（直线取端点，曲线/圆弧按真实几何采样，用于包围盒与命中） */
export function pathPoints(d: string): { x: number; y: number }[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]\d+)?/g);
  if (!toks) return [];
  const out: { x: number; y: number }[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "M";
  const num = () => parseFloat(toks[i++]);
  /** 三次贝塞尔采样（t=0..1，12 段足够精确） */
  const cubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      out.push({
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      });
    }
  };
  /** 二次贝塞尔采样 */
  const quad = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      const u = 1 - t;
      out.push({ x: u * u * x0 + 2 * u * t * x1 + t * t * x2, y: u * u * y0 + 2 * u * t * y1 + t * t * y2 });
    }
  };
  /** SVG 端点式圆弧 → 采样点（含椭圆旋转） */
  const arc = (
    x0: number,
    y0: number,
    rxIn: number,
    ryIn: number,
    phiDeg: number,
    laf: number,
    sf: number,
    x1: number,
    y1: number,
  ) => {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (!rx || !ry || (x0 === x1 && y0 === y1)) {
      out.push({ x: x1, y: y1 });
      return;
    }
    const phi = ((phiDeg % 360) * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx2 = (x0 - x1) / 2;
    const dy2 = (y0 - y1) / 2;
    const x1p = cos * dx2 + sin * dy2;
    const y1p = -sin * dx2 + cos * dy2;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      const k = Math.sqrt(lam);
      rx *= k;
      ry *= k;
    }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den2 = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = (laf !== sf ? 1 : -1) * Math.sqrt(Math.max(0, den2 === 0 ? 0 : num2 / den2));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const ccx = cos * cxp - sin * cyp + (x0 + x1) / 2;
    const ccy = sin * cxp + cos * cyp + (y0 + y1) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
      const a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      return ux * vy - uy * vx < 0 ? -a : a;
    };
    const ux = (x1p - cxp) / rx;
    const uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx;
    const vy = (-y1p - cyp) / ry;
    const t1 = angle(1, 0, ux, uy);
    let dt = angle(ux, uy, vx, vy);
    if (!sf && dt > 0) dt -= 2 * Math.PI;
    if (sf && dt < 0) dt += 2 * Math.PI;
    const N = 24;
    for (let k = 1; k <= N; k++) {
      const t = t1 + (dt * k) / N;
      out.push({
        x: ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
        y: ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
      });
    }
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) {
      cmd = toks[i++];
      if (cmd === "Z" || cmd === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M" || C === "L" || C === "T") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      if (C === "M") {
        sx = cx;
        sy = cy;
      }
      out.push({ x: cx, y: cy });
      if (C === "M") cmd = rel ? "l" : "L";
    } else if (C === "H") {
      const x = num();
      cx = rel ? cx + x : x;
      out.push({ x: cx, y: cy });
    } else if (C === "V") {
      const y = num();
      cy = rel ? cy + y : y;
      out.push({ x: cx, y: cy });
    } else if (C === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax2 = rel ? cx + x2 : x2;
      const ay2 = rel ? cy + y2 : y2;
      const ax3 = rel ? cx + x : x;
      const ay3 = rel ? cy + y : y;
      cubic(cx, cy, ax1, ay1, ax2, ay2, ax3, ay3);
      cx = ax3;
      cy = ay3;
    } else if (C === "S" || C === "Q") {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax3 = rel ? cx + x : x;
      const ay3 = rel ? cy + y : y;
      if (C === "Q") quad(cx, cy, ax1, ay1, ax3, ay3);
      else cubic(cx, cy, cx, cy, ax1, ay1, ax3, ay3);
      cx = ax3;
      cy = ay3;
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      const laf = num();
      const sf = num();
      const x = num();
      const y = num();
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      arc(cx, cy, rx, ry, rot, laf ? 1 : 0, sf ? 1 : 0, ax, ay);
      cx = ax;
      cy = ay;
    } else {
      i++;
    }
  }
  return out.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function shapeBox(s: DrawShape): Box {
  switch (s.type) {
    case "rect":
    case "roundRect":
      return {
        x: Math.min(s.x, s.x + s.w),
        y: Math.min(s.y, s.y + s.h),
        w: Math.abs(s.w),
        h: Math.abs(s.h),
      };
    case "circle":
      return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    case "ellipse":
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case "line":
      return {
        x: Math.min(s.x1, s.x2),
        y: Math.min(s.y1, s.y2),
        w: Math.abs(s.x2 - s.x1),
        h: Math.abs(s.y2 - s.y1),
      };
    case "polygon":
    case "star":
      return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    case "path":
      return pathBox(s.d);
    case "text":
      return {
        x: s.x,
        y: s.y - s.size,
        w: Math.max(0.5, s.text.length * s.size * 0.6),
        h: s.size * 1.25,
      };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function unionBox(list: DrawShape[]): Box {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of list) {
    const b = shapeBox(s);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: Math.max(0.001, x1 - x0), h: Math.max(0.001, y1 - y0) };
}

/* ---------------------------------------------------------------- */
/* 对齐 / 均分 / 层级 / 转路径（纯函数，画布编辑器 UI 用）               */
/* ---------------------------------------------------------------- */

export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "hdist"
  | "vdist";

/** 对 shapes 里 id ∈ ids 的图形执行对齐/均分；对齐需 ≥2 个，均分需 ≥3 个。返回新数组。 */
export function alignShapes(
  list: DrawShape[],
  ids: string[],
  mode: AlignMode,
  /** 选中单个图形时的对齐基准（通常是画布 0,0,vw,vh） */
  frame?: { x: number; y: number; w: number; h: number },
): DrawShape[] {
  const picked = list.filter((s) => ids.includes(s.id));
  const single = picked.length === 1 && !!frame;
  if (picked.length < 2 && !single) return list;
  const arr = [...list];
  const at = (id: string) => arr.findIndex((s) => s.id === id);

  if (mode === "hdist" || mode === "vdist") {
    if (picked.length < 3) return list;
    const horiz = mode === "hdist";
    const box = unionBox(picked);
    const items = [...picked].sort((a, b) => {
      const ba = shapeBox(a);
      const bb = shapeBox(b);
      return horiz ? ba.x - bb.x : ba.y - bb.y;
    });
    const total = horiz ? box.w : box.h;
    const sum = items.reduce((n, s) => {
      const b = shapeBox(s);
      return n + (horiz ? b.w : b.h);
    }, 0);
    const gap = (total - sum) / (items.length - 1);
    let cursor = horiz ? box.x : box.y;
    for (const s of items) {
      const b = shapeBox(s);
      const delta = cursor - (horiz ? b.x : b.y);
      const i = at(s.id);
      if (i >= 0) arr[i] = translateShape({ ...arr[i] }, horiz ? delta : 0, horiz ? 0 : delta);
      cursor += (horiz ? b.w : b.h) + gap;
    }
    return arr;
  }

  const box = single && frame ? frame : unionBox(picked);
  for (const s of picked) {
    const b = shapeBox(s);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = box.x - b.x;
    else if (mode === "hcenter") dx = box.x + box.w / 2 - (b.x + b.w / 2);
    else if (mode === "right") dx = box.x + box.w - (b.x + b.w);
    else if (mode === "top") dy = box.y - b.y;
    else if (mode === "vcenter") dy = box.y + box.h / 2 - (b.y + b.h / 2);
    else if (mode === "bottom") dy = box.y + box.h - (b.y + b.h);
    if (!dx && !dy) continue;
    const i = at(s.id);
    if (i >= 0) arr[i] = translateShape({ ...arr[i] }, dx, dy);
  }
  return arr;
}

/** 选中图形提到最前（列表尾 = 视觉最上）/ 沉到最后（列表头 = 视觉最下）。 */
export function moveInList(list: DrawShape[], ids: string[], dir: "front" | "back"): DrawShape[] {
  const moving = list.filter((s) => ids.includes(s.id));
  const rest = list.filter((s) => !ids.includes(s.id));
  if (!moving.length) return list;
  return dir === "front" ? [...rest, ...moving] : [...moving, ...rest];
}

/** 几何图元（rect/roundRect/circle/ellipse/line/polygon/star）→ 等价 path（pathData 可手改）；path/text 原样保留。 */
export function convertShapesToPaths(list: DrawShape[], ids: string[]): DrawShape[] {
  return list.map((s) => {
    if (!ids.includes(s.id) || s.type === "path" || s.type === "text") return s;
    const d = shapeD(s);
    if (!d) return s;
    return {
      id: s.id,
      type: "path" as const,
      d,
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      alpha: s.alpha,
      hidden: s.hidden,
      locked: s.locked,
    };
  });
}
export function translateShape(s: DrawShape, dx: number, dy: number): DrawShape {
  switch (s.type) {
    case "rect":
    case "roundRect":
      s.x += dx;
      s.y += dy;
      break;
    case "circle":
    case "ellipse":
    case "polygon":
    case "star":
      s.cx += dx;
      s.cy += dy;
      break;
    case "line":
      s.x1 += dx;
      s.y1 += dy;
      s.x2 += dx;
      s.y2 += dy;
      break;
    case "path":
      s.d = translatePath(s.d, dx, dy);
      break;
    case "text":
      s.x += dx;
      s.y += dy;
      break;
  }
  return s;
}

/** pathData 平移：绝对命令（M/L/H/V/C/S/Q/T/A）的坐标全部加偏移；相对命令不动（跟随前面的锚点移动）。 */
export function translatePath(d: string, dx: number, dy: number): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!toks) return d;
  let out = "";
  let i = 0;
  let cmd = "";
  let sawAbs = false;
  while (i < toks.length) {
    const t = toks[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      out += t;
      i++;
      continue;
    }
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    const need = argCount(C);
    if (need === 0) {
      i++;
      continue;
    }
    const args = toks.slice(i, i + need).map(Number);
    i += need;
    /* 参数不完整（pathData 本身坏 / 被别处写坏）时别硬算，原样返回，避免 NaN 传染到包围盒 */
    if (args.length < need || !args.every((v) => Number.isFinite(v))) return d;
    if (!rel) {
      sawAbs = true;
      switch (C) {
        case "M":
        case "L":
        case "T":
          args[0] += dx;
          args[1] += dy;
          break;
        case "H":
          args[0] += dx;
          break;
        case "V":
          args[0] += dy;
          break;
        case "C":
          args[0] += dx;
          args[1] += dy;
          args[2] += dx;
          args[3] += dy;
          args[4] += dx;
          args[5] += dy;
          break;
        case "S":
        case "Q":
          args[0] += dx;
          args[1] += dy;
          args[2] += dx;
          args[3] += dy;
          break;
        case "A":
          // rx ry rot large-arc sweep x y → 只挪最后的终点
          args[5] += dx;
          args[6] += dy;
          break;
      }
    }
    /* 相邻参数组之间必须补空格：否则 "l-8,8 8,8" 会拼成 "-8 88" 直接把路径写坏 */
    out += (out && !/[a-zA-Z]$/.test(out) ? " " : "") + args.map((v) => nstr(v)).join(" ");
  }
  // 整条路径全是相对命令 → 没有绝对锚点，前面补一个 M 位移
  if (!sawAbs) return `M${nstr(dx)},${nstr(dy)}${out}`;
  return out;
}

function argCount(C: string): number {
  switch (C) {
    case "M":
    case "L":
    case "T":
      return 2;
    case "H":
    case "V":
      return 1;
    case "C":
      return 6;
    case "S":
    case "Q":
      return 4;
    case "A":
      return 7;
    default:
      return 0;
  }
}

/** 平滑自由线（画笔）：点序列 → pathData */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${nstr(pts[0].x)},${nstr(pts[0].y)}l0.01,0`;
  let d = `M${nstr(pts[0].x)},${nstr(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${nstr(pts[i].x)},${nstr(pts[i].y)} ${nstr(mx)},${nstr(my)}`;
  }
  const last = pts[pts.length - 1];
  d += `L${nstr(last.x)},${nstr(last.y)}`;
  return d;
}

/** 旋转点 */
export function rotatePoint(
  p: { x: number; y: number },
  c: { x: number; y: number },
  deg: number,
): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** pathData 缩放（围绕 (ox,oy) 做 sx/sy 缩放；支持绝对/相对命令与弧线近似） */
export function scalePath(d: string, sx: number, sy: number, ox = 0, oy = 0): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!toks) return d;
  let out = "";
  let i = 0;
  let cmd = "";
  const ax = (v: number) => r3(ox + (v - ox) * sx);
  const ay = (v: number) => r3(oy + (v - oy) * sy);
  while (i < toks.length) {
    const t = toks[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      out += t;
      i++;
      continue;
    }
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    const need = argCount(C);
    if (need === 0) {
      i++;
      continue;
    }
    const a = toks.slice(i, i + need).map(Number);
    i += need;
    if (a.length < need || !a.every((v) => Number.isFinite(v))) return d;
    const fmt = (v: number) => nstr(v).replace(/^([^.\d])/, "$1");
    let res: number[];
    if (C === "H") {
      res = [rel ? r3(a[0] * sx) : ax(a[0])];
    } else if (C === "V") {
      res = [rel ? r3(a[0] * sy) : ay(a[0])];
    } else if (C === "A") {
      res = [
        r3(a[0] * Math.abs(sx)),
        r3(a[1] * Math.abs(sy)),
        a[2],
        a[3],
        a[4],
        rel ? r3(a[5] * sx) : ax(a[5]),
        rel ? r3(a[6] * sy) : ay(a[6]),
      ];
    } else {
      res = [];
      for (let k = 0; k < a.length; k += 2) {
        res.push(rel ? r3(a[k] * sx) : ax(a[k]));
        res.push(rel ? r3(a[k + 1] * sy) : ay(a[k + 1]));
      }
    }
    out += (out && !/[a-zA-Z]$/.test(out) ? " " : "") + res.map(fmt).join(" ");
  }
  return out;
}

/** 按旧包围盒 → 新包围盒缩放图元 */
export function scaleShape(s: DrawShape, from: Box, to: Box): DrawShape {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  switch (s.type) {
    case "rect":
    case "roundRect": {
      const x0 = Math.min(s.x, s.x + s.w);
      const y0 = Math.min(s.y, s.y + s.h);
      const x1 = mx(x0);
      const y1 = my(y0);
      s.x = Math.min(x1, x1 + Math.abs(s.w) * sx);
      s.y = Math.min(y1, y1 + Math.abs(s.h) * sy);
      s.w = Math.abs(s.w) * sx;
      s.h = Math.abs(s.h) * sy;
      if (s.round) s.round = r3(s.round * Math.min(sx, sy));
      break;
    }
    case "circle":
      s.cx = mx(s.cx);
      s.cy = my(s.cy);
      s.r = r3(s.r * Math.min(sx, sy));
      break;
    case "ellipse":
      s.cx = mx(s.cx);
      s.cy = my(s.cy);
      s.rx = r3(s.rx * sx);
      s.ry = r3(s.ry * sy);
      break;
    case "line":
      s.x1 = mx(s.x1);
      s.y1 = my(s.y1);
      s.x2 = mx(s.x2);
      s.y2 = my(s.y2);
      break;
    case "polygon":
    case "star":
      s.cx = mx(s.cx);
      s.cy = my(s.cy);
      s.r = r3(s.r * Math.min(sx, sy));
      break;
    case "path": {
      const nd = scalePath(s.d, sx, sy, from.x, from.y);
      /* 缩放后再整体平移到目标位置（scalePath 只围绕 from 原点缩放） */
      const dx = r3(to.x - from.x);
      const dy = r3(to.y - from.y);
      s.d = nd;
      if (dx || dy) s.d = translatePath(nd, dx, dy);
      break;
    }
    case "text":
      s.x = mx(s.x);
      s.y = my(s.y);
      s.size = r3(s.size * Math.min(Math.abs(sx), Math.abs(sy)));
      break;
  }
  return s;
}
