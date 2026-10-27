// lib/xml/icon-vectors.ts — 图标选择器：Material Symbols TTF → Android vector drawable XML
// 纯函数，浏览器/Node 双端可用（opentype.js 解析 TTF）。
// Material Symbols 的 glyph 名（search/home/…）存于 post.names[i]（i = glyphIndex），直接建索引。

import * as opentype from "opentype.js";

let font: opentype.Font | null = null;
let nameIdx: Map<string, number> | null = null;

export function isIconFontLoaded(): boolean {
  return !!font && !!nameIdx && nameIdx.size > 0;
}

/** 解析 TTF 并建立「图标名 → glyphIndex」索引（浏览器里只调一次） */
export async function loadIconFont(src: string | ArrayBuffer): Promise<void> {
  // 注意：Response.arrayBuffer() 返回 Promise，必须 await（否则把 Promise 喂给 opentype，
  // 内部 new DataView(Promise) 得到 0 长度 → RangeError: Offset is outside the bounds of the DataView）
  const buf = typeof src === "string" ? await (await fetch(src)).arrayBuffer() : src;
  font = opentype.parse(buf as unknown as ArrayBuffer);
  nameIdx = new Map();
  const names: string[] | undefined =
    (font.tables as unknown as { post?: { names?: string[] } }).post?.names;
  if (names) {
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      if (n && !nameIdx.has(n)) nameIdx.set(n, i);
    }
  }
}

export function hasIcon(name: string): boolean {
  if (!nameIdx) return false;
  const i = nameIdx.get(name);
  return i != null;
}

/** 取某图标的 Android vector drawable XML；拿不到路径返回 null */
export function getIconVector(name: string, fillColor = "#1D1B20"): string | null {
  if (!font || !nameIdx) return null;
  const idx = nameIdx.get(name);
  if (idx == null) return null;
  const glyph = font.glyphs.get(idx);
  if (!glyph) return null;
  const path = glyph.getPath(0, 0, 24);
  if (!path || path.commands.length === 0) return null;
  const d = pathToSvgD(path);
  if (!d) return null;
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

/** 资源文件名：ic_search（Android 资源名规则：小写字母/数字/_，2-31 字符） */
export function iconResourceName(iconName: string, prefix = "ic_"): string {
  const base = iconName
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  let name = `${prefix}${base}`.slice(0, 31);
  if (name.length < 2) name = "ic_icon";
  return name;
}

export function iconNames(): string[] {
  if (!nameIdx) return [];
  return [...nameIdx.keys()];
}

/** opentype.js Path → SVG path d（M/L/C/Q/Z），保留 2 位小数 */
function pathToSvgD(path: { commands: opentype.PathCommand[] }): string | null {
  if (!path.commands || path.commands.length === 0) return null;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const parts: string[] = [];
  for (const c of path.commands) {
    if (c.type === "M") parts.push(`M${f(c.x)} ${f(c.y)}`);
    else if (c.type === "L") parts.push(`L${f(c.x)} ${f(c.y)}`);
    else if (c.type === "C") parts.push(`C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`);
    else if (c.type === "Q") parts.push(`Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`);
    else if (c.type === "Z") parts.push("Z");
  }
  return parts.join(" ");
}
