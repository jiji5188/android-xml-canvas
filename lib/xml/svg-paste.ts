// lib/xml/svg-paste.ts — M88：粘贴 SVG → 可编辑矢量图形（移植自 svg-board parseSvgShapes）
// 支持 path / circle / ellipse / rect / line / polygon / polyline 七类标签，
// 输出与 DrawShape 兼容的中间结构，再由调用方补 id / 归一视口。
import type { DrawShape } from "@/lib/xml/canvas-shapes";

type DistOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type PastedShape = DistOmit<DrawShape, "id"> & {
  /** 源 SVG 视口（无 viewBox 时按 24 计） */
  vw: number;
  vh: number;
};

function attrOf(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) ||
    tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1] : null;
}
function num(v: string | null, d = 0): number {
  const x = parseFloat(v || "");
  return isFinite(x) ? x : d;
}
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 解析整段 SVG 源码；不支持的标签忽略，无有效图形时返回 null */
export function parsePastedSvg(src: string): PastedShape[] | null {
  const text = String(src || "").replace(/<!--[\s\S]*?-->/g, "");
  const vbM = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i.exec(text);
  const vw = vbM ? Math.max(1, num(vbM[3], 24)) : 24;
  const vh = vbM ? Math.max(1, num(vbM[4], 24)) : 24;

  const out: PastedShape[] = [];
  const re = /<(path|circle|ellipse|rect|line|polygon|polyline)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    const fill = attrOf(tag, "fill");
    const stroke = attrOf(tag, "stroke");
    const fillV = fill && fill !== "none" ? fill : "none";
    const strokeV = stroke && stroke !== "none" ? stroke : "#1a1f28";
    const sw = attrOf(tag, "stroke-width");
    const strokeWidth = sw ? num(sw, 1.5) : 1.5;
    /* M145：fill-rule=evenodd 的路径（带挖孔的图标）保留规则，否则孔会被填实 */
    const fr = /even-?odd/i.test(attrOf(tag, "fill-rule") || "") ? { fillType: "evenOdd" as const } : {};
    const base = { fill: fillV, stroke: strokeV, strokeWidth, alpha: 1, vw, vh };

    if (kind === "path") {
      const d = attrOf(tag, "d");
      if (d) out.push({ type: "path", d, ...base, ...fr });
    } else if (kind === "circle") {
      const r = num(attrOf(tag, "r"), 0);
      if (r > 0) out.push({ type: "circle", cx: num(attrOf(tag, "cx")), cy: num(attrOf(tag, "cy")), r, ...base });
    } else if (kind === "ellipse") {
      const rx = num(attrOf(tag, "rx"), 0);
      const ry = num(attrOf(tag, "ry"), 0);
      if (rx > 0 && ry > 0)
        out.push({ type: "ellipse", cx: num(attrOf(tag, "cx")), cy: num(attrOf(tag, "cy")), rx, ry, ...base });
    } else if (kind === "rect") {
      const w = num(attrOf(tag, "width"), 0);
      const h = num(attrOf(tag, "height"), 0);
      if (w > 0 && h > 0) {
        const round = num(attrOf(tag, "rx"), 0);
        out.push({
          type: round > 0 ? "roundRect" : "rect",
          x: num(attrOf(tag, "x")),
          y: num(attrOf(tag, "y")),
          w,
          h,
          round: round > 0 ? round : undefined,
          ...base,
        });
      }
    } else if (kind === "line") {
      out.push({ type: "line", x1: num(attrOf(tag, "x1")), y1: num(attrOf(tag, "y1")), x2: num(attrOf(tag, "x2")), y2: num(attrOf(tag, "y2")), ...base, fill: "none" });
    } else {
      // polygon / polyline → path
      const pts = String(attrOf(tag, "points") || "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(parseFloat);
      if (pts.length >= 4) {
        let d = "";
        for (let i = 0; i < pts.length - 1; i += 2) d += (i ? "L" : "M") + r2(pts[i]) + " " + r2(pts[i + 1]) + " ";
        if (kind === "polygon") d += "Z";
        out.push({ type: "path", d: d.trim(), ...base });
      }
    }
  }
  return out.length ? out : null;
}
