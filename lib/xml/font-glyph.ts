// lib/xml/font-glyph.ts — M4y：用「列表同款渲染」的浏览器字形轮廓生成图标
//
// 背景：Material Symbols TTF 是可变字体，opentype.js 只能读到 glyf 默认轮廓
// （= FILL 1 实心），而列表文字按 FILL 0 渲染（= 描边）。两者轮廓不同，
// 导致「选的跟生成的不一样」。
//
// 修法：在浏览器里把字形画进画布（跟列表同一套字体渲染），取像素 mask →
// 沿像素边链追踪出多边形轮廓 → 拼成 SVG pathData。生成结果 = 列表所见。
// Node 环境没有 canvas/字体渲染，返回 null，由调用方退回 opentype glyf 路径。
//
// 关键约定：沿边链走时「填充区域在右手边」→ 外轮廓顺时针、内孔逆时针，
// 用 Android 默认的 nonZero 填充规则即可正确挖空，无需 fillType。
import { getIconVector } from "./icon-vectors";

type Ctx2D = CanvasRenderingContext2D;

/** 采样边长（像素）；96 = 24dp × 4，足够平滑 */
export const SIZE = 96;

function hasCanvas(): boolean {
  return typeof document !== "undefined";
}

/** 确保字体已加载（与列表同款：Material Symbols Rounded，400） */
async function ensureFont(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    await document.fonts.load('400 96px "Material Symbols Rounded"');
    await document.fonts.ready;
    return true;
  } catch {
    return false;
  }
}

/** 把字形画进画布 → alpha 二值化 mask；返回 null 表示环境/字体不可用 */
export function glyphMask(text: string, S = SIZE): Uint8Array | null {
  if (!hasCanvas()) return null;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d") as Ctx2D | null;
  if (!g) return null;
  g.clearRect(0, 0, S, S);
  // 与列表 .msr 一致的字体与字号（1em = S px）
  g.font = '400 ' + S + 'px "Material Symbols Rounded"';
  g.textBaseline = "top";
  g.fillText(text, 0, 0);
  const d = g.getImageData(0, 0, S, S).data;
  const mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) mask[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  return mask;
}

/**
 * ===== 纯几何核心（无 canvas 依赖，Node 可测）=====
 * mask：S×S 像素格，左上原点。像素 (x,y) 占方形 [x,x+1]×[y,y+1]。
 */

type Edge = { from: [number, number]; to: [number, number] };

/** 收集所有「填充像素 ↔ 背景」之间的有向边，填充区恒在右手边 */
export function boundaryEdges(mask: Uint8Array, S: number): Edge[] {
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < S && y < S && mask[y * S + x] === 1;
  const edges: Edge[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!on(x, y)) continue;
      // 上邻为背景：顶边，向右走（右手边 = 下方 = 填充）
      if (!on(x, y - 1)) edges.push({ from: [x, y], to: [x + 1, y] });
      // 右邻为背景：右边，向下走
      if (!on(x + 1, y)) edges.push({ from: [x + 1, y], to: [x + 1, y + 1] });
      // 下邻为背景：底边，向左走
      if (!on(x, y + 1)) edges.push({ from: [x + 1, y + 1], to: [x, y + 1] });
      // 左邻为背景：左边，向上走
      if (!on(x - 1, y)) edges.push({ from: [x, y + 1], to: [x, y] });
    }
  }
  return edges;
}

const key = (p: [number, number]) => p[0] + "," + p[1];

/** 把有向边串成闭合多边形（每个连通域一条；内孔自然反向） */
export function chainEdges(edges: Edge[]): number[][][] {
  const byStart = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = key(e.from);
    const arr = byStart.get(k);
    if (arr) arr.push(e);
    else byStart.set(k, [e]);
  }
  const polys: number[][][] = [];
  const used = new Set<Edge>();
  for (const e0 of edges) {
    if (used.has(e0)) continue;
    const poly: number[][] = [];
    let cur: Edge | undefined = e0;
    let guard = 0;
    while (cur !== undefined && !used.has(cur) && guard++ < edges.length + 8) {
      const edge: Edge = cur;
      used.add(edge);
      poly.push(edge.from);
      const dx: number = edge.to[0] - edge.from[0];
      const dy: number = edge.to[1] - edge.from[1];
      const cands: Edge[] = (byStart.get(key(edge.to)) ?? []).filter((n: Edge) => !used.has(n));
      // 优先直行（同方向），避免在 4 像素交汇点拐错
      const straight: Edge | undefined = cands.find(
        (n: Edge) => n.to[0] - n.from[0] === dx && n.to[1] - n.from[1] === dy
      );
      cur = straight ?? cands[0];
    }
    if (poly.length >= 4) polys.push(poly);
  }
  return polys;
}

/** 去掉共线冗余点（用叉积） */
export function simplifyPoly(poly: number[][]): number[][] {
  if (poly.length < 3) return poly;
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const cross = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    if (cross !== 0) out.push(p);
  }
  return out.length >= 3 ? out : poly;
}

/** 多边形 → pathData 片段（换算到 24 视口） */
export function polyToPathData(poly: number[][], S = SIZE, view = 24): string {
  const s = simplifyPoly(poly);
  if (s.length < 3) return "";
  const f = (n: number) => Math.round((n / S) * view * 100) / 100;
  return "M" + s.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L") + " Z";
}

/** mask → 完整 pathData（所有轮廓串起来，nonZero 填充即可正确挖孔） */
export function maskToPathData(mask: Uint8Array, S = SIZE, view = 24): string | null {
  const edges = boundaryEdges(mask, S);
  if (edges.length === 0) return null;
  const segs = chainEdges(edges)
    .map((p) => polyToPathData(p, S, view))
    .filter(Boolean);
  if (segs.length === 0) return null;
  return segs.join(" ");
}

/** M4y 公开接口：取「列表同款渲染」的字形 pathData；取不到返回 null（调用方退 glyf） */
export async function fontGlyphPathData(name: string): Promise<string | null> {
  if (!hasCanvas()) return null;
  if (!(await ensureFont())) return null;
  const mask = glyphMask(name);
  if (!mask) return null;
  return maskToPathData(mask);
}

/**
 * 判断一个已存的 vector 是不是旧版 opentype glyf 直出（带 Q/C 曲线命令）。
 * 新的画布追踪结果是纯 M/L/Z 折线，所以带 Q/C 的一定是旧样式，需要重建。
 */
export function looksLikeGlyfVector(xml: string): boolean {
  const m = /pathData="([^"]*)"/.exec(xml);
  if (!m) return false;
  return /[QC]/.test(m[1]);
}

export async function getIconVectorWysiwyg(
  name: string,
  fillColor = "#1D1B20"
): Promise<string | null> {
  // 优先走画布字形轮廓（与列表一致），取不到再退 opentype glyf
  const d = await fontGlyphPathData(name);
  if (!d) return getIconVector(name, fillColor);
  return [
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"`,
    `    android:width="24dp"`,
    `    android:height="24dp"`,
    `    android:viewportWidth="24"`,
    `    android:viewportHeight="24">`,
    `    <path`,
    `        android:fillColor="${fillColor}"`,
    `        android:pathData="${d}"/>`,
    `</vector>`,
  ].join("\n");
}

/**
 * 生成 PNG（data URL）：同一套画布渲染，按目标像素尺寸出图。
 * 用于「按列表原样式导出位图」——素材库 drawable-*dpi 用。
 */
export async function renderIconPng(name: string, px: number, color = "#1D1B20"): Promise<string | null> {
  if (!hasCanvas()) return null;
  if (!(await ensureFont())) return null;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const g = c.getContext("2d") as Ctx2D | null;
  if (!g) return null;
  g.clearRect(0, 0, px, px);
  g.fillStyle = color;
  g.font = '400 ' + px + 'px "Material Symbols Rounded"';
  g.textBaseline = "top";
  g.fillText(name, 0, 0);
  return c.toDataURL("image/png");
}
