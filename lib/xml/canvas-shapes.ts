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
  | "path";

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

export type DrawShape =
  | RectShape
  | CircleShape
  | EllipseShape
  | LineShape
  | PolygonShape
  | PathShape;

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

/** pathData → 采样点（曲线按控制点/端点粗略取，用于包围盒与命中） */
export function pathPoints(d: string): { x: number; y: number }[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!toks) return [];
  const out: { x: number; y: number }[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "M";
  const num = () => parseFloat(toks[i++]);
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
      out.push({ x: rel ? cx + x1 : x1, y: rel ? cy + y1 : y1 });
      out.push({ x: rel ? cx + x2 : x2, y: rel ? cy + y2 : y2 });
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      out.push({ x: cx, y: cy });
    } else if (C === "S" || C === "Q") {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      out.push({ x: rel ? cx + x1 : x1, y: rel ? cy + y1 : y1 });
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      out.push({ x: cx, y: cy });
    } else if (C === "A") {
      num();
      num();
      num();
      num();
      num();
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      out.push({ x: cx, y: cy });
    } else {
      i++;
    }
  }
  return out;
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

/** 平移图元（就地修改并返回） */
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
  }
  return s;
}

/** pathData 平移：给每个绝对命令加偏移（相对命令不动，靠首个 M 的偏移带走整条路径） */
export function translatePath(d: string, dx: number, dy: number): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!toks) return d;
  let out = "";
  let i = 0;
  let cmd = "";
  let first = true;
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
    if (first && (C === "M" || C === "L") && !rel) {
      args[0] += dx;
      args[1] += dy;
      first = false;
    }
    // 首点是相对命令时，整条路径没有绝对锚点：前面补一个 M 位移
    out += args.map((v) => nstr(v)).join(" ");
  }
  if (first) {
    // 全是相对命令：在最前面插入一个绝对位移
    return `M${nstr(dx)},${nstr(dy)}${out}`;
  }
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
    out += res.map(fmt).join(" ");
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
  }
  return s;
}
