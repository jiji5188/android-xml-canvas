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

import { parseManifest, setElementAttr, attrOfElement } from "./manifest-edit";

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
  /** 生成前 clamp 后的实际尺寸 */
  contentDp: number;
  error?: string;
}

/** 从 res 包里读回应用图标配置（bg 色 + 前景尺寸），给「设为应用图标」面板做回填 */
export interface AppIconConfig {
  bgColor: string;
  contentDp: number;
}

/**
 * 从 res 相对路径 → 文件内容 的映射里读回配置。
 * 找 mipmap-anydpi-v26/ic_launcher.xml（或 _round）→ background 引用的 drawable → 读 <solid> 颜色；
 * 前景尺寸读生成器写入的标记注释（axv:contentDp=xx），读不到就默认 72。
 */
export function parseAppIconConfig(
  res: Record<string, string> | null | undefined,
): AppIconConfig | null {
  if (!res) return null;
  const adaptiveKeys = Object.keys(res).filter(
    (k) => /(^|\/)mipmap-anydpi-v26\//.test(k) && /ic_launcher(_round)?\.xml$/.test(k),
  );
  if (!adaptiveKeys.length) return null;
  const adaptive = res[adaptiveKeys[0]];
  if (!adaptive) return null;
  const bgMatch = adaptive.match(/<background\s+android:drawable="([^"]+)"/);
  if (!bgMatch) return null;
  const bgRef = bgMatch[1]; // 例如 @drawable/ic_launcher_background
  const key = refToResKey(bgRef, res);
  const bgXml = key ? res[key] : null;
  if (!bgXml) return null;
  const solid = bgXml.match(/<solid[^>]*android:color="([^"]+)"/i);
  if (!solid) return null;
  const color = normalizeColor(solid[1]);
  if (!color) return null;
  let dp = 72;
  // 前景文件：adaptive 引用 @drawable/xxx → 找 xxx.xml 里的 axv:contentDp 标记
  const fgMatch = adaptive.match(/<foreground\s+android:drawable="([^"]+)"/);
  const fgKey = fgMatch ? refToResKey(fgMatch[1], res) : null;
  const fg = fgKey ? res[fgKey] : null;
  if (fg) {
    const m = fg.match(/axv:contentDp=(\d+(?:\.\d+)?)/);
    if (m) dp = Math.round(Number.parseFloat(m[1]));
  }
  if (!Number.isFinite(dp) || dp < 40 || dp > 108) dp = 72;
  return { bgColor: color, contentDp: dp };
}

/** @drawable/ic_x → 在 res 映射里找对应的 key（可能带 drawable/ 前缀也可能不带） */
function refToResKey(ref: string, res: Record<string, string>): string | null {
  const name = ref.replace(/^@drawable\//, "");
  const full = Object.keys(res).find((k) => k.replace(/^\/+/i, "") === `drawable/${name}.xml`);
  if (full) return full;
  return Object.keys(res).find((k) => k.replace(/^\/+/i, "") === name) ?? null;
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
    `    <!-- axv:contentDp=${box} -->`,
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
      return { files: [], bgColor: "", contentDp: 72, error: `${label}资源名不合法：${name}` };
    }
  }
  const color = normalizeColor(input.bgColor);
  if (!color) return { files: [], bgColor: "", contentDp: 72, error: `背景色不合法：${input.bgColor}` };
  const fg = buildLauncherForeground(input.fgSourceXml, input.contentDp ?? 72);
  if (!fg) {
    return { files: [], bgColor: color, contentDp: 72, error: "前景不是合法的 vector（缺 viewportWidth/Height？）" };
  }
  const wantDp = Number.isFinite(input.contentDp ?? NaN) ? (input.contentDp as number) : 72;
  const usedDp = Math.min(108, Math.max(40, wantDp));
  const adaptive = buildAdaptiveIcon(`@drawable/${bgName}`, `@drawable/${fgName}`);
  return {
    bgColor: color,
    contentDp: usedDp,
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
  } else if (!icon[1].includes(`mipmap/${iconName}`) && !icon[1].includes("mipmap-")) {
    out.push(`清单里 android:icon="${icon[1]}"，不是 @mipmap/${iconName}`);
  }
  const round = manifest.match(/android:roundIcon\s*=\s*"([^"]*)"/);
  if (!round) out.push(`清单里没有 android:roundIcon，部分厂商桌面圆形图标会用 icon 顶替`);
  return out;
}

/**
 * M174 B：一键把 <application> 的图标声明补成 ic_launcher 系列。
 * 外科手术式改写（保留注释/缩进）：
 *   - android:icon 值不含 @mipmap/ic_launcher → 改为 @mipmap/ic_launcher
 *   - android:roundIcon 缺失或值不对 → 改为 @mipmap/ic_launcher_round
 * actions 里列出实际动过的地方（全没动则 actions 为空）。
 */
export function fixManifestIcon(manifest: string, iconName = "ic_launcher"): {
  ok: boolean;
  nextXml: string;
  actions: string[];
  error?: string;
} {
  if (!/<manifest\b/i.test(manifest ?? "")) {
    return { ok: false, nextXml: manifest, actions: [], error: "不是 AndroidManifest.xml" };
  }
  const doc = parseManifest(manifest);
  if (!doc.ok || !doc.application) {
    return { ok: false, nextXml: manifest, actions: [], error: "没找到 <application> 节点" };
  }
  const wantIcon = `@mipmap/${iconName}`;
  const wantRound = `@mipmap/${iconName}_round`;
  let next = manifest;
  const actions: string[] = [];
  // 改/补 android:icon（改完重新 parse，避免 span 偏移）
  {
    const d1 = parseManifest(next);
    const app1 = d1.application!;
    const curIcon = attrOfElement(next, app1, "android:icon");
    if (curIcon !== wantIcon) {
      next = setElementAttr(next, app1, "android:icon", wantIcon);
      actions.push(curIcon ? `android:icon 改成 ${wantIcon}（原来是 ${curIcon}）` : `补上 android:icon=${wantIcon}`);
    }
  }
  // 再改/补 android:roundIcon（再 parse 一次拿最新区间）
  {
    const d2 = parseManifest(next);
    const app2 = d2.application!;
    const curRound = attrOfElement(next, app2, "android:roundIcon");
    if (curRound !== wantRound) {
      next = setElementAttr(next, app2, "android:roundIcon", wantRound);
      actions.push(curRound ? `android:roundIcon 改成 ${wantRound}（原来是 ${curRound}）` : `补上 android:roundIcon=${wantRound}`);
    }
  }
  return { ok: true, nextXml: next, actions };
}
