"use client";

// lib/xml/export-image.ts — M6a 预览导出（PNG / SVG）
// 思路：画布本来就是真 DOM（不是 canvas 位图），所以直接拿 DOM 序列化最准：
//   html-to-image 把节点克隆 + 内联计算样式 → SVG(foreignObject) → 再栅格化成 PNG。
// 好处：flex 布局、圆角、渐变、阴影、图标（dataURL）全部按浏览器实际渲染结果走，不用自己重算布局。
// 注意：导出期间给根节点挂 .axv-exporting，用 CSS 去掉选中虚线框 / 拖拽高亮（见 xml-canvas.css）。

import { toPng, toSvg } from "html-to-image";
import { saveDataUrlNative } from "./native-save";

/** 导出目标：手机壳元素 + 它的逻辑尺寸（CSS px，未缩放） */
export interface ExportTarget {
  el: HTMLElement | null;
  /** 逻辑宽（CSS px，= 手机壳外框宽，不含窄屏 fitRatio 缩放） */
  width: number;
  /** 逻辑高 */
  height: number;
  /** 背景色（PNG 需要，透明底会让圆角外露；一般传手机壳底色或 #FFFFFF） */
  background?: string;
}

/** 导出时挂在手机壳上的类：CSS 里用来隐掉选中框、拖拽高亮、尺寸标签等编辑态装饰 */
export const EXPORT_CLASS = "axv-exporting";

export type ExportKind = "png" | "svg";

/** 导出倍率（仅 PNG 有意义） */
export const EXPORT_RATIOS = [1, 2, 3] as const;
export type ExportRatio = (typeof EXPORT_RATIOS)[number];

/**
 * 导出文件名：preview-<设备简称>-<倍率>x.png / .svg
 * 只保留 a-z0-9_-，避免各系统文件名踩坑。
 */
export function exportFileName(kind: ExportKind, label: string, ratio: number): string {
  const safe =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device";
  return kind === "png" ? `preview-${safe}@${ratio}x.png` : `preview-${safe}.svg`;
}

/** 待两帧，让 .axv-exporting 触发的样式在克隆前落到计算样式里 */
function nextFrames(n = 2): Promise<void> {
  return new Promise<void>((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function baseOptions(t: ExportTarget) {
  return {
    width: t.width,
    height: t.height,
    // 窄屏下手机壳带 scale(fitRatio)，导出要原尺寸（1x 逻辑像素）
    style: { transform: "none", transformOrigin: "top left", margin: "0" },
    // 画布里所有静态资源（图标矢量、上传位图、shape）都已是 dataURL，不需要联网/破缓存
    cacheBust: false,
    // 字体内联 CSS 自己算：html-to-image 默认会把每张样式表里的 @font-face 全量内嵌，
    // dev 模式下同一份字体被多个 <style> 重复声明 → SVG 能涨到 16MB。这里去重后只嵌一次。
    fontEmbedCSS: collectFontEmbedCSS(document, t.el ?? undefined),
  };
}

/** 目标子树里实际用到的 font-family（小写去引号；只取每个声明的首个具体字体名也够，但全收更稳） */
export function usedFontFamilies(root: HTMLElement): Set<string> {
  const set = new Set<string>();
  const add = (ff: string) => {
    for (const part of ff.split(",")) {
      const name = part.trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (name) set.add(name);
    }
  };
  add(getComputedStyle(root).fontFamily || "");
  for (const el of Array.from(root.querySelectorAll("*"))) {
    add(getComputedStyle(el).fontFamily || "");
  }
  return set;
}

/**
 * 收集 @font-face 并去重：
 * 1. 只留导出子树实际用到的 font-family（否则会把整个站点的字体全塞进去）
 * 2. 同一份字体在 dev 模式会被多个 <style> 重复声明 → 按「family+weight+src」去重
 */
/**
 * 系统字体白名单：这些字体各平台都有近似实现，没必要把几 MB 的 woff 嵌进导出文件
 * （Roboto 有 18 个字重，全嵌能让 SVG 胀到 3.5MB+）
 */
const SYSTEM_FONTS = new Set([
  "roboto",
  "roboto mono",
  "arial",
  "helvetica",
  "helvetica neue",
  "segoe ui",
  "segoe ui emoji",
  "segoe ui symbol",
  "apple color emoji",
  "noto color emoji",
  "noto sans",
  "blinkmacsystemfont",
  "-apple-system",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "ui-monospace",
  "menlo",
  "monaco",
  "consolas",
  "liberation mono",
  "courier new",
]);

export function collectFontEmbedCSS(doc: Document = document, root?: HTMLElement): string {
  const used = root ? usedFontFamilies(root) : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表（浏览器会抛 SecurityError）
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      if (!text.startsWith("@font-face")) continue;
      const fam = /font-family:\s*([^;}]+)/.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "").toLowerCase();
      // 只嵌「用了的 + 不是系统字体的」——图标字体（Material Symbols）必须嵌，否则显示成连字名
      if (fam && SYSTEM_FONTS.has(fam)) continue;
      if (used && fam && !used.has(fam)) continue;
      const weight = /font-weight:\s*([^;}]+)/.exec(text)?.[1]?.trim() ?? "";
      const src = /src:\s*url\(([^)]+)\)/.exec(text)?.[1] ?? text.slice(0, 80);
      const key = `${fam}|${weight}|${src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out.join("\n");
}

async function withCleanStage<T>(target: ExportTarget, run: () => Promise<T>): Promise<T> {
  const el = target.el;
  if (!el) throw new Error("预览还没渲染出来，稍后再试");
  el.classList.add(EXPORT_CLASS);
  await nextFrames(2);
  try {
    return await run();
  } finally {
    el.classList.remove(EXPORT_CLASS);
  }
}

/** 导出 PNG（dataURL）。pixelRatio = 倍率，1x 即逻辑像素 */
export async function renderPng(target: ExportTarget, ratio: number = 2): Promise<string> {
  return withCleanStage(target, () =>
    toPng(target.el as HTMLElement, {
      ...baseOptions(target),
      pixelRatio: ratio,
      backgroundColor: target.background,
    }),
  );
}

/** 导出 SVG（dataURL；内含 foreignObject，浏览器/Figma 打开正常，纯矢量工具可能不支持） */
export async function renderSvg(target: ExportTarget): Promise<string> {
  return withCleanStage(target, () => toSvg(target.el as HTMLElement, baseOptions(target)));
}

/** 触发下载（dataURL 或 blobURL 都行） */
export function downloadUrl(filename: string, url: string): void {
  // 原生壳里优先走原生保存（WebView 不支持 blob:/data: 下载）
  if (saveDataUrlNative(filename, url)) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 就绪状态：手机壳元素存在且有尺寸 */
export function targetReady(t: ExportTarget | null | undefined): boolean {
  return !!(t && t.el && t.width > 0 && t.height > 0);
}
