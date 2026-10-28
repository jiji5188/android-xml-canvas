// lib/xml/icon-vectors.ts — Material Symbols TTF（opentype.js）→ Android vector drawable XML
// M3g：图标选择器生成「真文件」vector 资源，导出 res 包时写进 drawable/
import * as opentype from "opentype.js";

/** 自托管 TTF，避免 CDN；浏览器里加载一次即可 */
const FONT_URL = "/material-symbols-rounded.ttf";

let font: opentype.Font | null = null;
/** 图标名 → glyphIndex（post 表 names[i]，i = 下标） */
let nameIdx: Map<string, number> | null = null;

export function isIconFontLoaded(): boolean {
  return !!font && !!nameIdx && nameIdx.size > 0;
}

/** 加载 TTF 并建名字索引；重复调用幂等 */
export async function loadIconFont(src: string | ArrayBuffer = FONT_URL): Promise<void> {
  // opentype.parse 要真 ArrayBuffer：传字符串要先 fetch + await arrayBuffer()，
  // 直接把 Promise / URL 字符串喂进去会抛异常（表现为「图标字体解析失败」）
  const buf: ArrayBuffer =
    typeof src === "string" ? await (await fetch(src)).arrayBuffer() : src;
  font = opentype.parse(buf);
  nameIdx = new Map();
  const names: string[] | undefined = (
    font.tables as unknown as { post?: { names?: string[] } }
  ).post?.names;
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

/** 取某个图标的 Android vector drawable XML；取不到路径返回 null */
export function getIconVector(name: string, fillColor = "#1D1B20"): string | null {
  if (!font || !nameIdx) return null;
  const idx = nameIdx.get(name);
  if (idx == null) return null;
  const glyph = font.glyphs.get(idx);
  if (!glyph) return null;
  // 先以 100pt 探测 bbox，再平移到 24×24 视口正中（opentype 的 y 轴向下，
  // glyph 基线在 0，字形大多落在负 y 区；直接 getPath(0,0,24) 会画出屏外 → 图标空白）
  const probe = glyph.getPath(0, 0, 100);
  if (!probe || probe.commands.length === 0) return null;
  const bb = probe.getBoundingBox() as unknown as {
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    xMin?: number;
    yMin?: number;
    xMax?: number;
    yMax?: number;
  };
  const xMin = bb.xMin ?? bb.x1 ?? 0;
  const xMax = bb.xMax ?? bb.x2 ?? 0;
  const yMin = bb.yMin ?? bb.y1 ?? 0;
  const yMax = bb.yMax ?? bb.y2 ?? 0;
  const cx = ((xMin + xMax) / 2) * 0.24;
  const cy = ((yMin + yMax) / 2) * 0.24;
  const path = glyph.getPath(12 - cx, 12 - cy, 24);
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

/** 资源文件名：ic_search（Android 资源名规则：小写字母/数字/_，≤31 字符） */
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

/** 已加载的全部图标名（按 post.names 顺序） */
export function iconNames(): string[] {
  if (!nameIdx) return [];
  return [...nameIdx.keys()];
}

/** opentype Path → SVG pathData（绝对坐标，Q/C 贝塞尔转成近似折线+二次曲线） */
export function pathToSvgD(path: opentype.Path): string | null {
  const cmds = path.commands;
  if (cmds.length === 0) return null;
  const out: string[] = [];
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  for (const c of cmds) {
    switch (c.type) {
      case "M":
        out.push(`M${f(c.x)} ${f(c.y)}`);
        break;
      case "L":
        out.push(`L${f(c.x)} ${f(c.y)}`);
        break;
      case "Q":
        out.push(`Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`);
        break;
      case "C":
        out.push(`C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`);
        break;
      case "Z":
        out.push("Z");
        break;
      default:
        break;
    }
  }
  return out.join(" ");
}

// ===== 视口归一：旧生成图标 y 全在负区（画进视口外 → 预览空白），修数据 =====
// 纯文本手术：每个 pathData 里按命令分组的坐标对（x,y）整体做 平移+等比缩放，
// 把 bbox 移到 0–24 正中。不依赖字体，node/浏览器都能跑。

/** 把一段 pathData 的坐标按 (x,y) 对变换；A 命令不出现于生成的图标，直接跳过 */
function transformPathData(d: string, tf: (x: number, y: number) => [number, number]): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let argParity = 0; // 当前命令内第几个参数（0=x, 1=y, 2=x2, ...）
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      out.push(t);
      argParity = 0;
      continue;
    }
    const n = parseFloat(t);
    if (argParity % 2 === 0) {
      const [nx, ny] = tf(n, NaN); // x 单独记录 y 在下一个
      out.push(fmtN(nx));
    } else {
      // 需要配对：把上一 x 暂存
      const x = (out[out.length - 1] as string);
      const [nx, ny] = tf(parseFloat(x), n);
      out[out.length - 1] = fmtN(nx);
      out.push(fmtN(ny));
    }
    argParity++;
  }
  return out.join(" ");
}

function fmtN(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** 检测 vector 的坐标是否整体落在视口外（y 全 ≤0.5 或全 ≥23.5 等） */
export function isVectorOffCanvas(xml: string): boolean {
  const ys: number[] = [];
  const re = /pathData="([^"]*)"/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(xml)) !== null) {
    any = true;
    const tokens = m[1].match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let argParity = 0;
    for (const t of tokens) {
      if (/^[A-Za-z]$/.test(t)) {
        argParity = 0;
        continue;
      }
      if (argParity % 2 === 1) ys.push(parseFloat(t));
      argParity++;
    }
  }
  if (!any || ys.length === 0) return false;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  // 正常图标应横跨视口主体（0..24）；全挤在边界外/上/下才判 off-canvas
  return max <= 0.5 || min >= 23.5;
}

/** 归一化 vector：bbox 平移到 24×24 正中 + 等比放大到铺满（只改 pathData） */
export function normalizeVectorBox(xml: string): { xml: string; changed: boolean } {
  if (!isVectorOffCanvas(xml)) return { xml, changed: false };
  // 收集全部坐标求 bbox
  const pts: Array<[number, number]> = [];
  const re = /pathData="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tokens = m[1].match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let argParity = 0;
    let lastX: number | null = null;
    for (const t of tokens) {
      if (/^[A-Za-z]$/.test(t)) {
        argParity = 0;
        lastX = null;
        continue;
      }
      const n = parseFloat(t);
      if (argParity % 2 === 0) lastX = n;
      else if (lastX != null) pts.push([lastX, n]);
      argParity++;
    }
  }
  if (pts.length === 0) return { xml, changed: false };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs),
    yMin = Math.min(...ys),
    yMax = Math.max(...ys);
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const s = 24 / Math.max(xMax - xMin, yMax - yMin, 0.001);
  const tf = (x: number, y: number): [number, number] => [12 + (x - cx) * s, 12 + (y - cy) * s];
  const fixed = xml.replace(/pathData="([^"]*)"/g, (_, d: string) => `pathData="${transformPathData(d, tf)}"`);
  // 校验：修完必须落回视口内，否则宁可不动
  if (isVectorOffCanvas(fixed)) return { xml, changed: false };
  return { xml: fixed, changed: true };
}

/** 批量修一整张 generatedDrawables 表；返回修过的资源名 */
export function repairGeneratedVectors(map: Record<string, string>): {
  map: Record<string, string>;
  repaired: string[];
} {
  const out = { ...map };
  const repaired: string[] = [];
  for (const [k, v] of Object.entries(out)) {
    if (!/<vector[\s>]/.test(v)) continue;
    const r = normalizeVectorBox(v);
    if (r.changed) {
      out[k] = r.xml;
      repaired.push(k);
    }
  }
  return { map: out, repaired };
}
