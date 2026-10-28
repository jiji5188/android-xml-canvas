// lib/xml/vector-svg.ts — Android vector drawable XML → SVG（data URL），用于画布真实渲染图标
// 只处理 vector 的核心子集：viewportWidth/Height + <path pathData/fillColor/fillAlpha>。
// 纯文本解析，浏览器/Node 都能跑（没有 DOM 依赖）。

export interface VectorSpec {
  /** 视口宽高（Android viewport，通常 24） */
  vw: number;
  vh: number;
  paths: { d: string; fill: string; alpha?: number; stroke?: string; strokeWidth?: number }[];
  /** M11j：<group> 的旋转 / 缩放（镜像）；没有 group 时为 undefined */
  group?: { rotation: number; scaleX: number; scaleY: number; pivotX: number; pivotY: number };
}

/** 从 vector xml 文本里抽 viewport + path 列表；不是 vector 返回 null */
export function parseVectorXml(xml: string): VectorSpec | null {
  if (!/<vector[\s>]/.test(xml)) return null;
  const vw = num(attr(xml, "viewportWidth")) ?? 24;
  const vh = num(attr(xml, "viewportHeight")) ?? 24;
  const paths: VectorSpec["paths"] = [];
  const re = /<path\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const head = m[1];
    const d = attrFrom(head, "pathData");
    if (!d) continue;
    const fill = attrFrom(head, "fillColor") || "#000000";
    const alphaRaw = num(attrFrom(head, "fillAlpha"));
    const stroke = attrFrom(head, "strokeColor");
    const sw = num(attrFrom(head, "strokeWidth"));
    paths.push({
      d,
      fill,
      alpha: alphaRaw == null ? undefined : alphaRaw,
      stroke: stroke || undefined,
      strokeWidth: sw == null ? undefined : sw,
    });
  }
  if (paths.length === 0) return null;
  return { vw, vh, paths, group: parseGroup(xml, vw, vh) };
}

/** M11j：抽 <group> 的变换（只处理编辑器生成的一层 group） */
function parseGroup(
  xml: string,
  vw: number,
  vh: number
): { rotation: number; scaleX: number; scaleY: number; pivotX: number; pivotY: number } | undefined {
  const m = /<group\b([^>]*)>/.exec(xml);
  if (!m) return undefined;
  const head = m[1];
  const g = {
    rotation: num(attrFrom(head, "rotation")) ?? 0,
    scaleX: num(attrFrom(head, "scaleX")) ?? 1,
    scaleY: num(attrFrom(head, "scaleY")) ?? 1,
    pivotX: num(attrFrom(head, "pivotX")) ?? vw / 2,
    pivotY: num(attrFrom(head, "pivotY")) ?? vh / 2,
  };
  if (g.rotation === 0 && g.scaleX === 1 && g.scaleY === 1) return undefined;
  return g;
}

/** vector xml → SVG 字符串（viewBox 用 viewport，尺寸 100% 自适应） */
export function vectorToSvg(xml: string): string | null {
  const spec = parseVectorXml(xml);
  if (!spec) return null;
  const body = spec.paths
    .map((p) => {
      const parts = [`d="${esc(p.d)}"`, `fill="${esc(p.fill)}"`];
      if (p.alpha != null) parts.push(`fill-opacity="${p.alpha}"`);
      if (p.stroke) parts.push(`stroke="${esc(p.stroke)}"`);
      if (p.strokeWidth != null) parts.push(`stroke-width="${p.strokeWidth}"`);
      return `<path ${parts.join(" ")}/>`;
    })
    .join("");
  // M11j：group 的旋转 / 镜像（Android 是 缩放→旋转→绕 pivot 平移，SVG 等价写法如下）
  const g = spec.group;
  const wrapped = g
    ? `<g transform="translate(${g.pivotX} ${g.pivotY}) rotate(${g.rotation}) scale(${g.scaleX} ${g.scaleY}) translate(${-g.pivotX} ${-g.pivotY})">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.vw} ${spec.vh}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${wrapped}</svg>`;
}

/** vector xml → data URL（直接给 CSS background-image 用） */
export function vectorToDataUrl(xml: string): string | null {
  const svg = vectorToSvg(xml);
  if (!svg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attr(xml: string, name: string): string | undefined {
  // android:name="..." 或 name="..."
  const re = new RegExp(`(?:android:)?${name}\\s*=\\s*"([^"]*)"`);
  return re.exec(xml)?.[1];
}

function attrFrom(head: string, name: string): string | undefined {
  return attr(head, name);
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
