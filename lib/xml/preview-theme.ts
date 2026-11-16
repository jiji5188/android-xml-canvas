// lib/xml/preview-theme.ts — M317b：原生预览主题「自足化」
//
// 背景：设备端原生预览的资源包是 `aapt2 compile/link -I <framework android.jar>` 单独编的，
// 里面 **没有 AppCompat / Material 的父主题和 attr**。而主题面板写进 themes.xml 的是
//   <style name="Theme.MyApp" parent="Theme.Material3.Light">
//       <item name="colorPrimary">…</item>
// 这两样 aapt2 link 都解析不出来：
//   error: resource style/Theme.Material3.Light not found
//   error: resource attr/colorPrimary not found
// → 一选主题预览就 link 失败（或 applyStyle 拿不到 id）。
//
// 对策：把 app 主题「翻译」成只依赖 framework 的等价主题（parent 映射到 @android:style 家族，
// item 映射到 android: 属性），再以同名 style 注进预览资源包；原 themes.xml 里那段 <style> 一并剥掉，
// 避免同名 style 重复（aapt2 会报 duplicate）。
//
// 纯字符串/纯函数，便于单测。

/** 父主题 → framework 等价物（按顺序匹配，先中先得） */
const PARENT_RULES: { re: RegExp; base: string }[] = [
  // 已经是 framework 的，原样保留（下面统一处理）
  { re: /^@android:style\//i, base: "" },
  { re: /Material3/i, base: "@android:style/Theme.Material.Light" },
  { re: /MaterialComponents/i, base: "@android:style/Theme.Material.Light" },
  { re: /AppCompat/i, base: "@android:style/Theme.Material.Light" },
  { re: /DeviceDefault/i, base: "@android:style/Theme.DeviceDefault" },
  { re: /Holo\.Light/i, base: "@android:style/Theme.Holo.Light" },
  { re: /Holo/i, base: "@android:style/Theme.Holo" },
  { re: /Theme\.Material\b/i, base: "@android:style/Theme.Material" },
];

const DARK_HINT = /(dark|black)/i;

/** 判断父主题大致是不是「深色」，深色就把 framework 基座换成深色版 */
function isDarkish(parent: string): boolean {
  return DARK_HINT.test(parent) && !/light/i.test(parent);
}

/**
 * 把任意 parent 映射成 framework 里确定存在的 style。
 * 保留 NoActionBar / Fullscreen 这类后缀（framework 家族都有这些变体）。
 */
export function mapThemeParent(parent: string): string {
  const raw = (parent || "").trim();
  if (!raw) return "@android:style/Theme.Material.Light";

  // 1) 已经是 @android:style/xxx：确认后缀合法性后原样返回
  if (/^@android:style\//i.test(raw)) {
    return normalizeFrameworkSuffix(raw);
  }

  // 2) 找基座
  let base = "@android:style/Theme.Material.Light";
  for (const rule of PARENT_RULES) {
    if (rule.re.test(raw)) {
      if (rule.base) base = rule.base;
      break;
    }
  }

  // 3) 深色调整：Material.Light → Material；Holo.Light → Holo
  if (isDarkish(raw)) {
    base = base.replace(/\.Light\b/, "").replace(/Material$/, "Material");
    if (/^@android:style\/Theme\.Material$/.test(base) === false && !/Holo|DeviceDefault/.test(base)) {
      base = "@android:style/Theme.Material";
    }
  }

  // 4) 后缀
  const suffixes: string[] = [];
  if (/NoActionBar/i.test(raw)) suffixes.push("NoActionBar");
  // Fullscreen 只在 Material 家族可靠；Holo/DeviceDefault 不强求
  if (/Fullscreen/i.test(raw) && /Material/.test(base)) suffixes.push("Fullscreen");

  return suffixes.length ? `${base}.${suffixes.join(".")}` : base;
}

/** 校验/修剪后缀，避免拼出 framework 里不存在的组合 */
function normalizeFrameworkSuffix(full: string): string {
  const m = /^(@android:style\/(?:Theme\.[\w.]+))/i.exec(full);
  if (!m) return "@android:style/Theme.Material.Light";
  let out = m[1];
  // Theme.Material 家族支持 .NoActionBar / .Fullscreen；其它家族去掉 Fullscreen
  if (!/Theme\.Material/.test(out)) out = out.replace(/\.Fullscreen$/i, "");
  return out;
}

/** AppCompat/Material 的 attr → framework 里等价（或不存在则 null 丢弃） */
const ITEM_MAP: { [k: string]: string | null } = {
  colorPrimary: "android:colorPrimary",
  colorPrimaryVariant: "android:colorPrimaryDark",
  colorSecondary: "android:colorAccent",
  colorOnSurface: "android:textColorPrimary",
  colorOnSurfaceVariant: "android:textColorSecondary",
  colorSurface: null, // 已用 windowBackground/colorBackground 表达
  colorOnPrimary: null, // framework 无对应
  colorOnSecondary: null,
  colorError: null,
  colorOutline: null,
};

/** item 名 → framework 属性名；返回 null = 丢弃 */
export function mapThemeItem(name: string): string | null {
  const n = (name || "").trim();
  if (!n) return null;
  if (/^android:/i.test(n)) return n; // 本来就是 framework 属性
  if (Object.prototype.hasOwnProperty.call(ITEM_MAP, n)) return ITEM_MAP[n];
  return null; // 未知的 appcompat/material attr，预览里一律丢弃
}

interface StyleBlock {
  name: string;
  parent: string;
  items: { name: string; value: string }[];
}

/** 从 XML 文本里抽某个 <style> 块（含嵌套 item） */
export function extractStyleBlock(themesXml: string, styleName: string): StyleBlock | null {
  const re = new RegExp(
    `<style\\b[^>]*\\bname\\s*=\\s*["']${escapeRe(styleName)}["'][^>]*>([\\s\\S]*?)<\\/style>`,
    "i",
  );
  const m = re.exec(themesXml);
  if (!m) return null;
  const openTag = m[0].slice(0, m[0].indexOf(">") + 1);
  const parent = (/\bparent\s*=\s*["']([^"']+)["']/i.exec(openTag) || [])[1] || "";
  const items: { name: string; value: string }[] = [];
  const itemRe = /<item\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/item>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(m[1])) !== null) {
    items.push({ name: im[1], value: im[2].trim() });
  }
  return { name: styleName, parent, items };
}

/** 从 XML 文本里删掉某个 <style> 块（其它 style 保留） */
export function stripStyleBlock(themesXml: string, styleName: string): string {
  const re = new RegExp(
    `<style\\b[^>]*\\bname\\s*=\\s*["']${escapeRe(styleName)}["'][^>]*>[\\s\\S]*?<\\/style>`,
    "gi",
  );
  return themesXml.replace(re, "");
}

/**
 * 生成「只依赖 framework」的预览主题 XML（单 style）。
 * 返回 null 表示：themes.xml 里找不到这个 style，或映射后没有任何有效 item。
 */
export function buildPreviewThemeXml(
  themesXml: string,
  styleName: string,
): { xml: string; styleName: string; parent: string; items: { name: string; value: string }[] } | null {
  const block = extractStyleBlock(themesXml, styleName);
  if (!block) return null;

  const parent = mapThemeParent(block.parent);
  const seen = new Set<string>();
  const items: { name: string; value: string }[] = [];
  for (const it of block.items) {
    const mapped = mapThemeItem(it.name);
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    items.push({ name: mapped, value: it.value });
  }
  if (items.length === 0) return null;

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n` +
    `    <style name="${styleName}" parent="${parent}">\n` +
    items.map((i) => `        <item name="${i.name}">${i.value}</item>`).join("\n") +
    `\n    </style>\n</resources>\n`;
  return { xml, styleName, parent, items };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
