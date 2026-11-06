/**
 * M171：应用图标（launcher icon）生成器
 *
 * 图标编辑器画出来的是普通 vector（比如 24×24 视口），而「应用图标」在 Android 里的形态是
 * 自适应图标：108×108dp 画布，中间 72dp 是安全区，系统按厂商自绘圆形/方圆/方形遮罩去裁。
 * 所以要做的不是「保存成 drawable」，而是：
 *
 *   drawable/ic_launcher_foreground.xml   ← 原图缩放进中间安全区，108 视口
 *   drawable/ic_launcher_background.xml   ← 纯色底（shape）
 *   mipmap-anydpi-v26/ic_launcher.xml     ← <adaptive-icon> 引用上面两个
 *   mipmap-anydpi-v26/ic_launcher_round.xml
 *
 * ⚠ 这两个 adaptive-icon 必须待在 mipmap-anydpi-v26/（带 -v26 限定符），
 *   放进 drawable/ 会让 aapt2 在 minSdk 24 下报 requires sdk version of at least 26（M170 踩过）。
 */

export interface AppIconFile {
  /** res 内相对路径，例如 mipmap-anydpi-v26/ic_launcher.xml */
  path: string;
  text: string;
}

export interface AppIconInput {
  /** 图标编辑器导出的 vector 源码（任意 viewport） */
  fgSourceXml: string;
  /** 背景色，支持 #RGB / #ARGB / #RRGGBB / #AARRGGBB */
  bgColor: string;
  /** 前景内容边长（dp，108 画布里的实际尺寸；Android 安全区 72，默认 72） */
  contentDp?: number;
  /** 前景资源名，默认 ic_launcher_foreground */
  fgName?: string;
  /** 背景资源名，默认 ic_launcher_background */
  bgName?: string;
  /** 图标资源名，默认 ic_launcher（文件名会生成 ic_launcher.xml 与 ic_launcher_round.xml） */
  iconName?: string;
}

export interface AppIconResult {
  files: AppIconFile[];
  /** 规范化后的背景色；输入非法时为空 */
  bgColor: string;
  error?: string;
}

const NS = "http://schemas.android.com/apk/res/android";
const LEGAL = /^[a-z][a-z0-9_]*$/;

/** 把 #RGB / #ARGB / #RRGGBB / #AARRGGBB 统一成 aapt 认的 #AARRGGBB */
export function normalizeColor(raw: string): string | null {
  const s = (raw ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const hex = s.toLowerCase();
  if (hex.length === 3) {
    const [r, g, b] = hex;
    return `#ff${r}${r}${g}${g}${b}${b}`;
  }
  if (hex.length === 4) {
    const [a, r, g, b] = hex;
    return `#${a}${a}${r}${r}${g}${g}${b}${b}`;
  }
  if (hex.length === 6) return `#ff${hex}`;
  if (hex.length === 8) return `#${hex}`;
  return null;
}

/** 从 vector 源码里抠出 viewport 与内部节点文本 */
export function splitVector(src: string): { vw: number; vh: number; inner: string } | null {
  const text = (src ?? "").trim();
  const open = text.search(/<vector\b/i);
  if (open < 0) return null;
  const gt = text.indexOf(">", open);
  if (gt < 0) return null;
  const head = text.slice(open, gt + 1);
  const end = text.lastIndexOf("</vector>");
  if (end < 0) return null;
  const inner = text.slice(gt + 1, end).trim();
  const num = (name: string) => {
    const m = head.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, "i"));
    const v = m ? Number.parseFloat(m[1]) : Number.NaN;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const vw = num(`(?:android:)?viewportWidth`);
  const vh = num(`(?:android:)?viewportHeight`);
  if (!vw || !vh) return null;
  return { vw, vh, inner };
}

/**
 * 把任意 viewport 的 vector 缩进 108dp 画布的中央安全区。
 * contentDp 是「内容边长占多少 dp」（108 画布里的绝对尺寸），默认 72（= Android 安全区）。
 */
export function buildLauncherForeground(src: string, contentDp = 72): string | null {
  const parsed = splitVector(src);
  if (!parsed) return null;
  const box = Math.min(108, Math.max(40, Number.isFinite(contentDp) ? contentDp : 72));
  const s = box / Math.max(parsed.vw, parsed.vh);
  const tx = (108 - parsed.vw * s) / 2;
  const ty = (108 - parsed.vh * s) / 2;
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  return [
    `<vector xmlns:android="${NS}"`,
    `    android:width="108dp"`,
    `    android:height="108dp"`,
    `    android:viewportWidth="108"`,
    `    android:viewportHeight="108">`,
    `    <group android:scaleX="${r(s)}" android:scaleY="${r(s)}"`,
    `        android:translateX="${r(tx)}" android:translateY="${r(ty)}">`,
    parsed.inner
      .split("\n")
      .map((l) => (l.trim() ? `        ${l.trim()}` : l))
      .join("\n"),
    `    </group>`,
    `</vector>`,
    ``,
  ].join("\n");
}

/** 纯色底：aapt 里用一个 shape 最稳（不依赖 colors.xml 有没有这个颜色） */
export function buildColorBackground(color: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<shape xmlns:android="${NS}" android:shape="rectangle">`,
    `    <solid android:color="${color}" />`,
    `</shape>`,
    ``,
  ].join("\n");
}

/** mipmap-anydpi-v26/xxx.xml 正文 */
export function buildAdaptiveIcon(backgroundRef: string, foregroundRef: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<adaptive-icon xmlns:android="${NS}">`,
    `    <background android:drawable="${backgroundRef}" />`,
    `    <foreground android:drawable="${foregroundRef}" />`,
    `</adaptive-icon>`,
    ``,
  ].join("\n");
}

/** 生成整套应用图标文件（4 个），返回 res 内相对路径 */
export function buildAppIcon(input: AppIconInput): AppIconResult {
  const fgName = input.fgName ?? "ic_launcher_foreground";
  const bgName = input.bgName ?? "ic_launcher_background";
  const iconName = input.iconName ?? "ic_launcher";
  for (const [label, name] of [
    ["前景", fgName],
    ["背景", bgName],
    ["图标", iconName],
  ] as const) {
    if (!LEGAL.test(name)) {
      return { files: [], bgColor: "", error: `${label}资源名不合法：${name}` };
    }
  }
  const color = normalizeColor(input.bgColor);
  if (!color) return { files: [], bgColor: "", error: `背景色不合法：${input.bgColor}` };
  const fg = buildLauncherForeground(input.fgSourceXml, input.contentDp ?? 72);
  if (!fg) {
    return { files: [], bgColor: color, error: "前景不是合法的 vector（缺 viewportWidth/Height？）" };
  }
  const adaptive = buildAdaptiveIcon(`@drawable/${bgName}`, `@drawable/${fgName}`);
  return {
    bgColor: color,
    files: [
      { path: `drawable/${fgName}.xml`, text: fg },
      { path: `drawable/${bgName}.xml`, text: buildColorBackground(color) },
      { path: `mipmap-anydpi-v26/${iconName}.xml`, text: adaptive },
      { path: `mipmap-anydpi-v26/${iconName}_round.xml`, text: adaptive },
    ],
  };
}

/**
 * 检查 AndroidManifest.xml 的图标声明。返回人话提示（空数组 = 没有问题）。
 * 只提示、不自动改：清单是用户资产，改错了整个 app 起不来。
 */
export function checkManifestIcon(manifest: string, iconName = "ic_launcher"): string[] {
  const out: string[] = [];
  if (!manifest || !/<manifest\b/i.test(manifest)) return out;
  const icon = manifest.match(/android:icon\s*=\s*"([^"]*)"/);
  if (!icon) {
    out.push(`清单里没有 android:icon，装出来的图标会是系统默认图标`);
  } else if (!icon[1].includes(`/mipmap/${iconName}`) && !icon[1].includes(`/mipmap-`)) {
    out.push(`清单里 android:icon="${icon[1]}"，不是 @mipmap/${iconName}`);
  }
  const round = manifest.match(/android:roundIcon\s*=\s*"([^"]*)"/);
  if (!round) out.push(`清单里没有 android:roundIcon，部分厂商桌面圆形图标会用 icon 顶替`);
  return out;
}
