/**
 * M49：ARGB 颜色工具
 *
 * 为什么自己写：`<input type="color">` 只认 `#rrggbb`，没有透明度。代码编辑器里
 * 「选中背景 / 当前行背景」这类颜色必须能调 alpha（而且要能叠出层次），所以要一个
 * 支持 Android 习惯的 **#AARRGGBB** 的解析/格式化工具，输出统一走 CSS 的 rgba()。
 *
 * 8 位十六进制按 Android 习惯解释为 ARGB（不是 CSS 的 RRGGBBAA）；
 * 4 位按 CSS 习惯解释为 #RGBA（少见，但标准如此）。
 */

export interface Rgba {
  /** 0-255 */
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function hex2(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0");
}

/** 解析 CSS 颜色：#rgb / #rgba / #rrggbb / #aarrggbb / rgb() / rgba() / transparent */
export function parseColor(input: string | null | undefined): Rgba | null {
  const s = (input || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1,
      };
    }
    if (h.length === 4) {
      // CSS #RGBA
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: parseInt(h[3] + h[3], 16) / 255,
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    if (h.length === 8) {
      // Android #AARRGGBB
      return {
        a: parseInt(h.slice(0, 2), 16) / 255,
        r: parseInt(h.slice(2, 4), 16),
        g: parseInt(h.slice(4, 6), 16),
        b: parseInt(h.slice(6, 8), 16),
      };
    }
    return null;
  }

  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (p: string, max: number) =>
      p.endsWith("%") ? (Number(p.slice(0, -1)) / 100) * max : Number(p);
    const r = num(parts[0], 255);
    const g = num(parts[1], 255);
    const b = num(parts[2], 255);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    let a = 1;
    if (parts.length >= 4) {
      const raw = parts[3];
      const v = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
      if (Number.isFinite(v)) a = v;
    }
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) };
  }
  return null;
}

/** #AARRGGBB（Android 习惯，大小写按传入参数） */
export function toArgbHex(c: Rgba, upper = true): string {
  const hex = `#${hex2(c.a * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return upper ? hex.toUpperCase() : hex;
}

/** #RRGGBB（丢掉 alpha，喂给 <input type="color">） */
export function toRgbHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** 统一的 CSS 输出：alpha=1 用 #rrggbb，否则 rgba() */
export function toCssColor(c: Rgba): string {
  if (c.a >= 1) return toRgbHex(c);
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.round(c.a * 100) / 100})`;
}

/** 只改 alpha，其它保持 */
export function withAlpha(c: Rgba, a: number): Rgba {
  return { ...c, a: clamp01(a) };
}

/** 安全解析：解析不出来用 fallback（同样解析失败则给黑色不透明） */
export function parseColorOr(input: string | null | undefined, fallback?: string): Rgba {
  return parseColor(input) || parseColor(fallback) || { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * M53：把**单个 Android 颜色值**转成浏览器能正确渲染的 CSS 颜色。
 *
 * 为什么必须转：Android XML / values 里写死的 8 位 hex 是 `#AARRGGBB`，
 * 而浏览器（CSS / SVG fill）按 `#RRGGBBAA` 解释 —— 直接透传会把 alpha
 * 当成红色通道，`#80123456` 会渲染成完全不透明的 `#801234`+`56` alpha。
 * 4 位同理：Android `#ARGB`，CSS `#RGBA`。
 *
 * - 不透明（alpha=FF）：输出 6 位 `#rrggbb`
 * - 带透明度：输出 `rgba(r, g, b, a)`
 * - 非 `#` 开头（`@color/x` / `?attr/x` / 命名色）：原样返回，交给调用方解析
 */
export function androidColorToCss(input: string | null | undefined): string {
  const s = (input ?? "").trim();
  if (!s.startsWith("#")) return s;
  const h = s.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(h)) return s;
  const hx = (x: string) => parseInt(x, 16);

  // Android #ARGB（4 位）→ 先展开成 #AARRGGBB，不走 CSS 的 #RGBA 语义
  if (h.length === 4) {
    const [a, r, g, b] = h.split("");
    return androidColorToCss(`#${a}${a}${r}${r}${g}${g}${b}${b}`);
  }
  if (h.length === 3) return "#" + h.split("").map((c) => c + c).join("");
  if (h.length !== 8) return s; // 6 位或其他长度：本来就是 CSS 能吃的写法

  const a = hx(h.slice(0, 2));
  if (a === 255) return "#" + h.slice(2);
  if (a === 0) return "transparent";
  const alpha = Math.round((a / 255) * 100) / 100;
  return `rgba(${hx(h.slice(2, 4))}, ${hx(h.slice(4, 6))}, ${hx(h.slice(6, 8))}, ${alpha})`;
}
