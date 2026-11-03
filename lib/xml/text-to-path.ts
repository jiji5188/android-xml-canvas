// lib/xml/text-to-path.ts — 文字图层 → Android vector 的 pathData
// 做法：用 canvas 把文字按目标字号画进离屏画布（超大比例渲染）→ 追踪 alpha 轮廓 → 换算回图形坐标。
// 好处：不依赖字体文件（中文也能转），结果和画布上看到的字形一致。
// 只能在浏览器里调用（要 canvas）；Node 环境返回 null。
import { contoursToPathData, traceAlphaField } from "./text-trace";

export interface TextPathResult {
  /** 以「文字原点 = 基线左端」为 (0,0) 的 pathData */
  d: string;
  /** 文字宽度（与描入字号同单位） */
  width: number;
  ascent: number;
  descent: number;
  /** 轮廓数量（调试用） */
  loops: number;
}

export interface TextToPathOpts {
  /** 字号（viewport 单位，和 TextShape.size 一致） */
  size: number;
  bold?: boolean;
  /** 追踪精度：目标字形高度（像素），越大越准也越慢 */
  targetPx?: number;
}

export function textToPathData(text: string, fontStack: string, opt: TextToPathOpts): TextPathResult | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;
  if (typeof document === "undefined") return null;

  const size = opt.size > 0 ? opt.size : 12;
  // 渲染倍数：让字形高度落在 targetPx 左右（太小锯齿多，太大慢）
  const target = Math.min(420, Math.max(120, opt.targetPx ?? 300));
  const ss = Math.min(20, Math.max(2, Math.round(target / size)));
  const weight = opt.bold ? 700 : 400;
  const font = `${weight} ${size * ss}px ${fontStack}`;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!ctx) return null;

  ctx.font = font;
  const m = ctx.measureText(raw);
  const asc = Math.ceil(m.actualBoundingBoxAscent ?? size * ss * 0.8);
  const desc = Math.ceil(m.actualBoundingBoxDescent ?? size * ss * 0.25);
  const pad = Math.max(2, Math.ceil(ss));
  const w = Math.max(1, Math.ceil(m.width) + pad * 2);
  const h = Math.max(1, asc + desc + pad * 2);

  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#000";
  ctx.fillText(raw, pad, pad + asc);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // 画布被污染（跨域字体等）
    return null;
  }

  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];

  const loops = traceAlphaField(alpha, w, h, 128);
  if (!loops.length) return null;

  // 像素 → 图形坐标：x 去掉左边距，y 以基线为 0 往上为负（和 SVG <text> 一致）
  // 简化容差按渲染倍数缩放：目标约 0.05 个图形单位，避免小字号产生上千个点
  const tol = Math.max(0.5, ss * 0.05);
  const d = contoursToPathData(
    loops,
    (p) => ({ x: (p.x - pad) / ss, y: (p.y - pad - asc) / ss }),
    { tol, smooth: true, digits: 2 },
  );
  if (!d) return null;

  return { d, width: m.width / ss, ascent: asc / ss, descent: desc / ss, loops: loops.length };
}
