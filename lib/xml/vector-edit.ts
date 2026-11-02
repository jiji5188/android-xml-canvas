// lib/xml/vector-edit.ts — M11j：vector 图标的可编辑模型（解析 → 编辑 → 重新序列化）
// 只覆盖编辑器自己生成的图标形态：单个 <vector>，可选一层 <group>（旋转/镜像），若干 <path>。

export interface VectorPath {
  /** pathData */
  d: string;
  /** 填充色（#RRGGBB / #AARRGGBB / @color/x 原样保留） */
  fill: string;
  /** fillAlpha 0~1 */
  alpha?: number;
  stroke?: string;
  strokeWidth?: number;
  /** 描边不透明度 0~1（M81：画布编辑器用；旧数据没有则视为 1） */
  strokeAlpha?: number;
  /** 单条 path 的旋转（度）与其旋转中心；M88l：非 0 时导出为独立 <group> */
  rotation?: number;
  pivotX?: number;
  pivotY?: number;
}

export interface VectorGroup {
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
}

export interface VectorModel {
  /** 输出尺寸（dp） */
  w: number;
  h: number;
  /** 视口 */
  vw: number;
  vh: number;
  /** 变换（恒等时序列化会省略 group） */
  group: VectorGroup;
  paths: VectorPath[];
}

const DEFAULT_GROUP: VectorGroup = { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };

function num(v: string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function attrOf(head: string, name: string): string | undefined {
  const re = new RegExp(`(?:android:)?${name}\\s*=\\s*"([^"]*)"`, "m");
  return re.exec(head)?.[1];
}

/** 解析 vector xml → 可编辑模型；不是 vector 返回 null */
export function parseVectorModel(xml: string): VectorModel | null {
  if (!/<vector[\s>]/.test(xml)) return null;
  const vwMatch = /<vector\b[^>]*>/.exec(xml);
  const head = vwMatch ? vwMatch[0] : xml;
  const vw = num(attrOf(head, "viewportWidth"), 24);
  const vh = num(attrOf(head, "viewportHeight"), 24);
  const w = num((attrOf(head, "width") || "").replace(/dp$/, ""), vw);
  const h = num((attrOf(head, "height") || "").replace(/dp$/, ""), vh);

  const gm = /<group\b([^>]*)>/.exec(xml);
  const group: VectorGroup = gm
    ? {
        rotation: num(attrOf(gm[1], "rotation"), 0),
        scaleX: num(attrOf(gm[1], "scaleX"), 1),
        scaleY: num(attrOf(gm[1], "scaleY"), 1),
        pivotX: num(attrOf(gm[1], "pivotX"), vw / 2),
        pivotY: num(attrOf(gm[1], "pivotY"), vh / 2),
      }
    : { ...DEFAULT_GROUP, pivotX: vw / 2, pivotY: vh / 2 };

  const paths: VectorPath[] = [];
  const re = /<path\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const d = attrOf(m[1], "pathData");
    if (!d) continue;
    const alphaRaw = attrOf(m[1], "fillAlpha");
    const swRaw = attrOf(m[1], "strokeWidth");
    const saRaw = attrOf(m[1], "strokeAlpha");
    paths.push({
      d,
      fill: attrOf(m[1], "fillColor") || "#1D1B20",
      alpha: alphaRaw == null ? undefined : num(alphaRaw, 1),
      stroke: attrOf(m[1], "strokeColor") || undefined,
      strokeWidth: swRaw == null ? undefined : num(swRaw, 1),
      strokeAlpha: saRaw == null ? undefined : num(saRaw, 1),
    });
  }
  if (!paths.length) return null;
  return { w, h, vw, vh, group, paths };
}

const IDENTITY = (g: VectorGroup) =>
  g.rotation === 0 &&
  g.scaleX === 1 &&
  g.scaleY === 1;

/** 模型 → vector xml（能被 aapt 直接吃） */
export function buildVectorXml(m: VectorModel, name = "ic_icon"): string {
  const lines: string[] = [];
  lines.push(`<vector xmlns:android="http://schemas.android.com/apk/res/android"`);
  lines.push(`    android:width="${round(m.w)}dp"`);
  lines.push(`    android:height="${round(m.h)}dp"`);
  lines.push(`    android:viewportWidth="${round(m.vw)}"`);
  lines.push(`    android:viewportHeight="${round(m.vh)}"`);
  // 名字写进 tools:ignore 之外没地方放，这里用注释保留可读性
  if (name) lines.push(`    android:name="${name}"`);
  const withGroup = !IDENTITY(m.group);
  lines[lines.length - 1] = lines[lines.length - 1] + (withGroup ? ">" : ">");
  if (withGroup) {
    const g = m.group;
    lines.push(`    <group`);
    if (g.rotation) lines.push(`        android:rotation="${round(g.rotation)}"`);
    if (g.scaleX !== 1) lines.push(`        android:scaleX="${round(g.scaleX)}"`);
    if (g.scaleY !== 1) lines.push(`        android:scaleY="${round(g.scaleY)}"`);
    lines.push(`        android:pivotX="${round(g.pivotX)}"`);
    lines.push(`        android:pivotY="${round(g.pivotY)}">`);
  }
  const pad = withGroup ? "        " : "    ";
  for (const p of m.paths) {
    /* M88l：单条 path 自己带旋转 → 再包一层 <group> */
    const rotated = p.rotation != null && Math.abs(p.rotation) > 0.001;
    const q = rotated ? pad + "    " : pad;
    if (rotated) {
      const attrs = [`android:rotation="${round(p.rotation!)}"`];
      if (p.pivotX != null) attrs.push(`android:pivotX="${round(p.pivotX)}"`);
      if (p.pivotY != null) attrs.push(`android:pivotY="${round(p.pivotY)}"`);
      lines.push(`${pad}<group`);
      attrs.forEach((a, i) => {
        lines.push(`${pad}    ${a}${i === attrs.length - 1 ? ">" : ""}`);
      });
    }
    lines.push(`${q}<path`);
    lines.push(`${q}    android:fillColor="${p.fill}"`);
    if (p.alpha != null && p.alpha !== 1) lines.push(`${q}    android:fillAlpha="${round(p.alpha)}"`);
    if (p.stroke) lines.push(`${q}    android:strokeColor="${p.stroke}"`);
    if (p.strokeWidth != null) lines.push(`${q}    android:strokeWidth="${round(p.strokeWidth)}"`);
    if (p.strokeAlpha != null && p.strokeAlpha !== 1) lines.push(`${q}    android:strokeAlpha="${round(p.strokeAlpha)}"`);
    lines.push(`${q}    android:pathData="${p.d}"/>`);
    if (rotated) lines.push(`${pad}</group>`);
  }
  if (withGroup) lines.push(`    </group>`);
  lines.push(`</vector>`);
  return lines.join("\n");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 旋转 90° 一档（0/90/180/270 循环） */
export function nextRotation(r: number): number {
  return (Math.round(r / 90) * 90 + 90) % 360;
}
