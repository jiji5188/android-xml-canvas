// lib/xml/icon-to-shapes.ts — M88：24x24 图标 pathData → 当前画布视口的 path 图形
import { scalePath, translateShape, type DrawShape } from "@/lib/xml/canvas-shapes";
import type { IconItem } from "@/lib/xml/icon-libs";

let seq = 0;
export const nextShapeId = () => "ic" + Date.now().toString(36) + (seq++).toString(36);

/** 把 24x24 图标等比缩放到 vw×vh（留 10% 边距）并居中；描边库自动 fill none + stroke */
export function iconToShapes(it: IconItem, vw: number, vh: number): DrawShape[] {
  const st = it.st === 1;
  const k = Math.min(vw / 24, vh / 24) * 0.8;
  const ox = (vw - 24 * k) / 2;
  const oy = (vh - 24 * k) / 2;
  const base: DrawShape = {
    id: nextShapeId(),
    type: "path",
    d: scalePath(it.d, k, k, 0, 0),
    fill: st ? "none" : "#1D1B20",
    stroke: st ? "#1D1B20" : "none",
    strokeWidth: st ? Math.max(0.4, 1.6 * k) : 0,
    alpha: 1,
    /* M145：实心图标带挖孔（fill-rule=evenodd）时保留规则，否则孔会被填实 */
    ...(!st && it.fr === 1 ? { fillType: "evenOdd" as const } : {}),
  };
  return [translateShape(base, ox, oy)];
}
