"use client";

// lib/xml/export-svg.ts — M7b 真矢量 SVG 导出
// 和 M6a 的 SVG（html-to-image → foreignObject 包 HTML）不同：这里把画布 DOM 逐个元素翻译成
// 原生 SVG 图元（rect / text / image / gradient / filter），丢进 Figma、Illustrator、Inkscape
// 都是可编辑矢量，也能无损放大。
//
// 取舍（有意为之）：
// - 文本按浏览器实际断行拆成多行 <text>（用 Range 逐字测量），不自己实现换行算法
// - 复杂效果（多层阴影、conic-gradient、clip-path: path）只做近似或跳过，避免导出崩
// - 图标字体（.msr 连字）导出成 <text font-family="Material Symbols Rounded">，
//   本机没装该字体的工具里会显示成连字名 —— 这是字体矢量化的固有限制
// - 位图 / 矢量图标都以 dataURL 形式内嵌，文件自包含

import { EXPORT_CLASS } from "./export-image";

export interface VectorTarget {
  el: HTMLElement;
  /** 逻辑宽高（CSS px，不含 fitRatio 缩放） */
  width: number;
  height: number;
  /** 底色（svg 背景矩形）；不传则透明 */
  background?: string;
}

/* ---------------------------------------------------------------- 纯函数（可单测） */

export interface GradientStop {
  color: string;
  offset: number;
}

export interface ParsedGradient {
  type: "linear" | "radial";
  /** 线性的方向角（度，0 = 向上，90 = 向右；按 CSS 语义换算） */
  angle: number;
  stops: GradientStop[];
}

/** 把 `linear-gradient(180deg, #fff 0%, #000 100%)` 解析成结构；解析不了返回 null */
export function parseGradient(css: string): ParsedGradient | null {
  const s = (css || "").trim();
  const m = /^(linear|radial)-gradient\(([\s\S]*)\)$/.exec(s);
  if (!m) return null;
  const type = m[1] as "linear" | "radial";
  const parts = splitTopLevel(m[2]);
  if (parts.length < 2) return null;

  let angle = 180; // CSS 默认 to bottom
  let idx = 0;
  const head = parts[0].trim();
  if (!/%|px|#|rgb|hsl|var\(/.test(head)) {
    idx = 1;
    if (type === "linear") {
      const deg = /(-?[\d.]+)deg/.exec(head);
      const turn = /([\d.]+)turn/.exec(head);
      if (deg) angle = parseFloat(deg[1]);
      else if (turn) angle = parseFloat(turn[1]) * 360;
      else if (/to\s+right/.test(head)) angle = 90;
      else if (/to\s+left/.test(head)) angle = 270;
      else if (/to\s+top/.test(head)) angle = 0;
      else if (/to\s+bottom/.test(head)) angle = 180;
    }
  }

  const stops: GradientStop[] = [];
  const rest = parts.slice(idx);
  rest.forEach((raw, i) => {
    const p = raw.trim();
    const pct = /(-?[\d.]+)%\s*$/.exec(p);
    let offset = pct ? parseFloat(pct[1]) : (i / Math.max(1, rest.length - 1)) * 100;
    if (Number.isNaN(offset)) offset = 0;
    const color = (pct ? p.slice(0, pct.index) : p).trim();
    if (color) stops.push({ color, offset: Math.max(0, Math.min(100, offset)) });
  });
  if (stops.length < 2) return null;
  return { type, angle, stops };
}

/** 按顶层逗号切（忽略括号内的逗号，rgb(0,0,0) 不会被切碎） */
export function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** CSS 颜色 → SVG 可用值 + 透明度。只吃 hex / rgb() / rgba() / 常见关键字 */
export function svgColor(css: string): { color: string; opacity: number } | null {
  const s = (css || "").trim();
  if (!s || s === "transparent") return s === "transparent" ? { color: "#000000", opacity: 0 } : null;
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgba) {
    const parts = rgba[1].split(/[,/\s]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map((v) => Math.round(parseFloat(v)));
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { color: `rgb(${r},${g},${b})`, opacity: Number.isNaN(a) ? 1 : Math.max(0, Math.min(1, a)) };
  }
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^[a-z]+$/i.test(s)) return { color: s, opacity: 1 };
  return null;
}

/** `8px 8px 8px 8px` / `8px` → 四角半径（px）；解析不了返回 null */
export function parseRadius(css: string): number[] | null {
  const s = (css || "").trim();
  if (!s) return null;
  const nums = s.split(/\s+/).map((v) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN));
  if (!nums.length || nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 1) return [nums[0], nums[0], nums[0], nums[0]];
  if (nums.length === 2) return [nums[0], nums[1], nums[0], nums[1]];
  if (nums.length === 3) return [nums[0], nums[1], nums[2], nums[1]];
  return [nums[0], nums[1], nums[2], nums[3]];
}

export interface ParsedShadow {
  dx: number;
  dy: number;
  blur: number;
  color: string;
  opacity: number;
}

/** `rgba(0,0,0,0.2) 0px 2px 6px 0px` → 结构；多层只取第一层 */
export function parseShadow(css: string): ParsedShadow | null {
  const s = (css || "").trim();
  if (!s || s === "none") return null;
  const first = splitTopLevel(s)[0]?.trim();
  if (!first) return null;
  const colorPart = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|\b(?:black|white|transparent)\b)/i.exec(first)?.[0];
  const nums = (colorPart ? first.replace(colorPart, "") : first)
    .match(/-?[\d.]+px/g)
    ?.map((v) => parseFloat(v));
  if (!nums || nums.length < 3) return null;
  const c = svgColor(colorPart ?? "rgba(0,0,0,0.25)") ?? { color: "#000000", opacity: 0.25 };
  return { dx: nums[0], dy: nums[1], blur: nums[2], color: c.color, opacity: c.opacity };
}

/** 圆角矩形路径（四角可不同）；全部相等时调用方可用 rect + rx 简化 */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number[]): string {
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, Math.min(w, h) / 2)));
  return [
    `M${x + tl},${y}`,
    `H${x + w - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : "",
    `V${y + h - br}`,
    br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : "",
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : "",
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const num = (n: number): string => (Math.round(n * 100) / 100).toString();

/* ---------------------------------------------------------------- DOM 遍历 */

interface Ctx {
  /** 目标坐标系缩放（fitRatio / 缩放倍数） */
  scale: number;
  ox: number;
  oy: number;
  defs: string[];
  counter: { n: number };
  /** 根元素（用于 font-family 继承兜底） */
  root: HTMLElement;
}

function relRect(el: Element, ctx: Ctx): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - ctx.ox) / ctx.scale,
    y: (r.top - ctx.oy) / ctx.scale,
    w: r.width / ctx.scale,
    h: r.height / ctx.scale,
  };
}

function visible(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (parseFloat(cs.opacity || "1") === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0.5 && r.height > 0.5;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

/** 把一个元素的「框」（背景 / 圆角 / 边框 / 阴影 / 背景图）转成 SVG 片段 */
function shapeOf(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx): string {
  const { x, y, w, h } = relRect(el, ctx);
  const radius = parseRadius(cs.borderTopLeftRadius + " " + cs.borderTopRightRadius + " " + cs.borderBottomRightRadius + " " + cs.borderBottomLeftRadius) ?? [0, 0, 0, 0];
  const uniform = radius.every((r) => Math.abs(r - radius[0]) < 0.01);
  const parts: string[] = [];
  let gradFill = "";

  const bg = svgColor(cs.backgroundColor);
  const bgImage = cs.backgroundImage;
  const hasGradient = bgImage && bgImage.includes("gradient(");
  const hasUrl = bgImage && bgImage.includes("url(");

  if (hasGradient) {
    const g = parseGradient(bgImage);
    if (g) {
      const id = `g${ctx.counter.n++}`;
      const stops = g.stops
        .map((s) => {
          const c = svgColor(s.color) ?? { color: "#000000", opacity: 1 };
          return `<stop offset="${num(s.offset / 100)}" stop-color="${c.color}" stop-opacity="${num(c.opacity)}"/>`;
        })
        .join("");
      if (g.type === "linear") {
        // CSS 角度：0deg = 向上、顺时针；换算出两端点（归一化到 0..1）
        const rad = ((g.angle - 90) * Math.PI) / 180;
        const dx = Math.cos(rad) / 2;
        const dy = Math.sin(rad) / 2;
        ctx.defs.push(
          `<linearGradient id="${id}" x1="${num(0.5 - dx)}" y1="${num(0.5 - dy)}" x2="${num(0.5 + dx)}" y2="${num(0.5 + dy)}">${stops}</linearGradient>`,
        );
      } else {
        ctx.defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`);
      }
      gradFill = `url(#${id})`;
    }
  }

  if (hasUrl) {
    const url = /url\(["']?([^"')]+)["']?\)/.exec(bgImage)?.[1];
    if (url) {
      // 背景图铺满（cover / contain 都按 cover 近似）
      const clipId = uniform && radius[0] > 0 ? clipFor(ctx, x, y, w, h, radius[0]) : "";
      parts.push(
        `<image href="${esc(url)}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="xMidYMid slice"${clipId ? ` clip-path="url(#${clipId})"` : ""}/>`,
      );
    }
  }

  if (gradFill) {
    parts.unshift(
      uniform && radius[0] > 0
        ? `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(radius[0])}" fill="${gradFill}"/>`
        : `<path d="${roundedRectPath(x, y, w, h, radius)}" fill="${gradFill}"/>`,
    );
  } else if (bg && bg.opacity > 0) {
    const fillAttrs = `fill="${bg.color}"${bg.opacity < 1 ? ` fill-opacity="${num(bg.opacity)}"` : ""}`;
    parts.unshift(
      uniform && radius[0] > 0
        ? `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(radius[0])}" ${fillAttrs}/>`
        : `<path d="${roundedRectPath(x, y, w, h, radius)}" ${fillAttrs}/>`,
    );
  }

  // 边框：四边同宽同色同线型才画（否则跳过，记在注释里）
  const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) => parseFloat(v) || 0);
  const bStyle = cs.borderTopStyle;
  const bc = svgColor(cs.borderTopColor);
  if (bw.every((v) => v > 0) && bw.every((v) => Math.abs(v - bw[0]) < 0.01) && bStyle !== "none" && bc) {
    const dash = bStyle === "dashed" ? ` stroke-dasharray="${num(bw[0] * 3)} ${num(bw[0] * 2)}"` : bStyle === "dotted" ? ` stroke-dasharray="${num(bw[0])} ${num(bw[0] * 1.6)}"` : "";
    parts.push(
      `<path d="${roundedRectPath(x + bw[0] / 2, y + bw[0] / 2, w - bw[0], h - bw[0], radius.map((r) => Math.max(0, r - bw[0] / 2)))}" fill="none" stroke="${bc.color}" stroke-opacity="${num(bc.opacity)}" stroke-width="${num(bw[0])}"${dash}/>`,
    );
  }

  // 阴影：只取第一层，用 drop-shadow 滤镜
  const shadow = parseShadow(cs.boxShadow);
  let groupOpen = "";
  let groupClose = "";
  if (shadow && (shadow.dx || shadow.dy || shadow.blur)) {
    const id = `s${ctx.counter.n++}`;
    // stdDeviation ≈ blur/2（CSS blur 半径语义接近高斯 σ*2）
    ctx.defs.push(
      `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="${num(shadow.dx / ctx.scale)}" dy="${num(shadow.dy / ctx.scale)}" stdDeviation="${num(shadow.blur / (2 * ctx.scale))}" flood-color="${shadow.color}" flood-opacity="${num(shadow.opacity)}"/></filter>`,
    );
    groupOpen = `<g filter="url(#${id})">`;
    groupClose = "</g>";
  }

  return groupOpen + parts.join("") + groupClose;
}

function idOfLast(ctx: Ctx): string {
  // （保留：从 defs 末尾取 id，调试/兜底用）
  const last = ctx.defs[ctx.defs.length - 1] ?? "";
  return /id="([^"]+)"/.exec(last)?.[1] ?? "";
}
void idOfLast;

/** 圆角裁剪（背景图出血时用） */
function clipFor(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): string {
  const id = `c${ctx.counter.n++}`;
  ctx.defs.push(
    `<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}"/></clipPath>`,
  );
  return id;
}

/** 一个文本节点的可视行：逐字测量，按 top 分组 → 行文本 + 行框 */
export function measureTextLines(node: Text, ctx: { scale: number; ox: number; oy: number }): { text: string; x: number; y: number; w: number; h: number }[] {
  const raw = node.textContent ?? "";
  if (!raw.trim()) return [];
  const range = document.createRange();
  const lines: { text: string; x: number; y: number; w: number; h: number }[] = [];
  let cur: { text: string; x: number; y: number; w: number; h: number } | null = null;
  let lastTop: number | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      // 空白字符没有独立矩形，挂到当前行上
      if (cur) cur.text += raw[i];
      continue;
    }
    const top = Math.round((r.top - ctx.oy) / ctx.scale);
    const left = (r.left - ctx.ox) / ctx.scale;
    const w = r.width / ctx.scale;
    const h = r.height / ctx.scale;
    const yTop = top;
    if (lastTop === null || Math.abs(top - lastTop) > 1) {
      if (cur) lines.push(cur);
      cur = { text: raw[i], x: left, y: yTop, w, h };
      lastTop = top;
    } else if (cur) {
      cur.text += raw[i];
      cur.w = Math.max(cur.w, left + w - cur.x);
      cur.h = Math.max(cur.h, h);
    }
  }
  if (cur) lines.push(cur);
  return lines.filter((l) => l.text.trim().length > 0);
}

function textOf(node: Text, cs: CSSStyleDeclaration, ctx: Ctx): string {
  const family = cs.fontFamily || "Roboto, system-ui, sans-serif";
  // 图标字体（Material Symbols 连字）在没装字体的查看器里会变成 "signal_cellular_alt" 这种词
  // → 导出时直接跳过，宁可留白也不碎字
  if (/material\s*(symbols|icons)/i.test(family)) return "";
  const lines = measureTextLines(node, ctx);
  if (!lines.length) return "";
  const fs = parseFloat(cs.fontSize) || 14;
  const weight = cs.fontWeight || "400";
  const c = svgColor(cs.color) ?? { color: "#000000", opacity: 1 };
  const anchor = cs.textAlign === "center" ? "middle" : cs.textAlign === "right" || cs.textAlign === "end" ? "end" : "start";
  const deco = cs.textDecorationLine?.includes("underline") ? ` text-decoration="underline"` : "";
  const spacing = parseFloat(cs.letterSpacing);
  return lines
    .map((l) => {
      // 用 central 基线 + 行框中心，比「顶部 + 0.8 行高」稳
      const baseY = l.y + l.h / 2;
      const x = anchor === "middle" ? l.x + l.w / 2 : anchor === "end" ? l.x + l.w : l.x;
      const sp = Number.isFinite(spacing) ? ` letter-spacing="${num(spacing / ctx.scale)}"` : "";
      return `<text x="${num(x)}" y="${num(baseY)}" font-family="${esc(family)}" font-size="${num(fs / ctx.scale)}" font-weight="${esc(weight)}" fill="${c.color}"${c.opacity < 1 ? ` fill-opacity="${num(c.opacity)}"` : ""}${anchor !== "start" ? ` text-anchor="${anchor}"` : ""} dominant-baseline="central"${sp}${deco} xml:space="preserve">${esc(l.text)}</text>`;
    })
    .join("");
}

/** 矢量掩膜图标：mask-image 里是 data:image/svg+xml 时，把形状用当前背景色画出来 */
function maskShape(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx): string | null {
  const raw = (cs as unknown as Record<string, string>).maskImage || (cs as unknown as Record<string, string>).webkitMaskImage || "";
  if (!raw.includes("data:image/svg+xml")) return null;
  const m = /url\(["']?([^"')]+)["']?\)/.exec(raw);
  if (!m) return null;
  const comma = m[1].indexOf(",");
  if (comma < 0) return null;
  let svg = "";
  try {
    svg = decodeURIComponent(m[1].slice(comma + 1));
  } catch {
    return null;
  }
  const bg = svgColor(cs.backgroundColor);
  if (!bg || bg.opacity === 0) return null;
  const { x, y, w, h } = relRect(el, ctx);
  // 根 svg 上写死尺寸 + 填充色（mask 内部的 path 通常不带 fill，靠继承）
  svg = svg
    .replace(/\s(width|height)="[^"]*"/g, "")
    .replace(/\sfill="[^"]*"/g, "")
    .replace(/<svg\b/, `<svg x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${bg.color}"${bg.opacity < 1 ? ` fill-opacity="${num(bg.opacity)}"` : ""}`);
  return svg.replace(/currentColor/g, bg.color);
}

function walk(el: Element, ctx: Ctx, out: string[]): void {
  if (SKIP_TAGS.has(el.tagName)) return;
  const cs = getComputedStyle(el);
  if (!visible(el, cs)) return;

  // 内联矢量图（vector drawable → <svg>）：整体嵌入，保住矢量，不下探
  if (el.namespaceURI === "http://www.w3.org/2000/svg" && el.tagName.toLowerCase() === "svg") {
    const { x, y, w, h } = relRect(el, ctx);
    const clone = el.cloneNode(true) as SVGElement;
    clone.setAttribute("x", num(x));
    clone.setAttribute("y", num(y));
    clone.setAttribute("width", num(w));
    clone.setAttribute("height", num(h));
    clone.removeAttribute("class");
    // 脱离文档后 currentColor 会变成黑色：提前把计算色写死到每个子孙上
    const color = cs.color || "#000000";
    for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attr of ["fill", "stroke"]) {
        if ((node.getAttribute(attr) || "").includes("currentColor")) {
          node.setAttribute(attr, (node.getAttribute(attr) as string).replace(/currentColor/g, color));
        }
      }
    }
    out.push(clone.outerHTML);
    return;
  }

  if (el.tagName === "IMG") {
    const { x, y, w, h } = relRect(el, ctx);
    const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
    if (src) {
      out.push(
        `<image href="${esc(src)}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="xMidYMid ${cs.objectFit === "contain" ? "meet" : "slice"}"/>`,
      );
    }
    return;
  }

  if (el instanceof HTMLElement) {
    const masked = maskShape(el, cs, ctx);
    if (masked) {
      out.push(masked);
      return; // 图标已按掩膜画完，不下探（内部通常只有装饰 span）
    }
    const shape = shapeOf(el, cs, ctx);
    if (shape) out.push(shape);
  }

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = textOf(child as Text, cs, ctx);
      if (t) out.push(t);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child as Element, ctx, out);
    }
  }
}

/** 把画布 DOM 转成原生矢量 SVG 字符串 */
export function buildVectorSvg(target: VectorTarget): string {
  const root = target.el;
  const r = root.getBoundingClientRect();
  const scale = target.width > 0 ? r.width / target.width : 1;
  const ctx: Ctx = { scale: scale || 1, ox: r.left, oy: r.top, defs: [], counter: { n: 0 }, root };

  const body: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = textOf(child as Text, getComputedStyle(root), ctx);
      if (t) body.push(t);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child as Element, ctx, body);
    }
  }

  const w = target.width;
  const h = target.height;
  const bg = target.background ? svgColor(target.background) : null;
  const bgRect = bg && bg.opacity > 0 ? `<rect width="${num(w)}" height="${num(h)}" fill="${bg.color}"/>` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">` +
    (ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "") +
    bgRect +
    body.join("") +
    "</svg>"
  );
}

/** 导出成 dataURL（和 PNG/SVG 走同一个 downloadUrl） */
export async function renderVectorSvg(target: VectorTarget): Promise<string> {
  const el = target.el;
  if (!el) throw new Error("预览还没渲染出来，稍后再试");
  el.classList.add(EXPORT_CLASS);
  await new Promise<void>((resolve) => {
    let left = 2;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  try {
    const svg = buildVectorSvg(target);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } finally {
    el.classList.remove(EXPORT_CLASS);
  }
}
