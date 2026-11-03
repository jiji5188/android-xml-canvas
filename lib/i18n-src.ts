// lib/i18n-src.ts — M95：以「中文原文」为 key 的译文表 + 全局 t()
//
// 背景：编辑器里 1000+ 条文案散在 30 多个组件里，逐条起 key 再补 4 种语言不现实。
// 这里的做法是：组件里直接写成 t("保存")，中文原文就是 key；只要本表里有对应译文
// 就切过去，没有就原样显示中文（不会出现 ??? 或空串）。
//
// 因此回填是「按页面、增量」的：先给哪个页面补译文，哪个页面就支持多语言。
// zh-Hant / ja 目前会被英文表兜底（见 SRC_FALLBACK），以后再按需补。

export type SrcDict = Record<string, string>;

/** 英文 —— 简体中文原文 → English */
export const SRC_EN: SrcDict = {
  // ---- 已生成资源面板（GenAssetsPanel）----
  "已生成资源": "Generated assets",
  "搜索资源名…": "Search asset name…",
  "搜索资源名": "Search assets",
  "未引用": "Unused",
  "引用 {n}": "{n} ref(s)",
  "确定": "OK",
  "取消": "Cancel",
  "关闭": "Close",
  "删除": "Delete",
  "删除资源": "Delete asset",
  "改名": "Rename",
  "改名（会同步改布局里的引用）": "Rename (layout references update too)",
  "复制 xml": "Copy XML",
  "下载 xml 文件": "Download XML file",
  "下载 xml": "Download XML",
  "双击编辑形状内容": "Double-click to edit the shape",
  "双击编辑图标（颜色 / 尺寸 / 路径 / 旋转）": "Double-click to edit the icon (color / size / path / rotation)",
  "没有匹配「{q}」的资源": "No assets match “{q}”",
  "还没有生成过资源。用属性面板的": "No generated assets yet. Use the",
  "选图标 /": "icon picker /",
  "建形状，生成后会出现在这里。": "shape builder in the attribute panel; generated assets show up here.",
  "再点一次确认删除（{n} 处引用会变缺失）": "Click again to confirm ({n} reference(s) will break)",
  "改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动。":
    "Rename / delete only affect assets generated in the editor; same-named files in the uploaded res/ folder are untouched.",
  "形状资源双击可直接改内容。": "Double-click a shape asset to edit its content.",
  "资源名不能为空（只能用 a-z 0-9 _，且字母开头）": "Asset name cannot be empty (a-z 0-9 _ only, must start with a letter)",
  "已按 aapt 规则纠正为 {name}，再点一次「确定」": "Corrected to {name} per aapt rules — click OK again",
  "已存在同名资源 {name}": "An asset named {name} already exists",
  "已改名 {from} → {to}，布局里 {n} 处引用已同步": "Renamed {from} → {to}; {n} reference(s) in the layout updated",
  "已改名 {from} → {to}": "Renamed {from} → {to}",
  "已删除 {name}（布局里 {n} 处引用会变成缺失资源）": "Deleted {name} ({n} reference(s) in the layout are now missing)",
  "已删除 {name}": "Deleted {name}",
  "已复制 {name} 的 xml": "Copied the XML of {name}",
  "复制失败（浏览器不允许写剪贴板）": "Copy failed (the browser blocked clipboard access)",
  "已写入《{project}》app/src/main/res/drawable/{name}.xml": "Written to 《{project}》app/src/main/res/drawable/{name}.xml",
  "写入项目失败：{reason}": "Failed to write into the project: {reason}",
  "项目": "project",
  "目录不可写": "directory is not writable",
};

/** 繁體 —— 只登记与简体不同的；没登记的会先试英文兜底 */
export const SRC_HANT: SrcDict = {};

/** 日本語 */
export const SRC_JA: SrcDict = {};

export const SRC_DICTS: Record<string, SrcDict> = {
  en: SRC_EN,
  "zh-Hant": SRC_HANT,
  ja: SRC_JA,
};

// ---- 当前语言（模块级）----
// 组件不必都接 lang prop：语言切换时 XmlEditor 会重渲染整棵树，子组件跟着重渲染，
// 读模块级变量即可。memo 过的组件需要额外传 lang，见 useLangTick()。

let currentLang: string = "zh-Hans";

export function setI18nLang(lang: string): void {
  currentLang = lang;
}

export function getI18nLang(): string {
  return currentLang;
}

/**
 * 取译文：与 tr(key, fallback) 的区别是不需要 key。
 * 用法：t("保存") → Save / 保存 / 保存（中文环境原样返回）
 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  if (currentLang === "zh-Hans") {
    if (!vars) return zh;
  }
  const raw =
    (currentLang !== "zh-Hans" ? SRC_DICTS[currentLang]?.[zh] : undefined) ?? zh;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** 组件内可选用：拿到当前语言，便于把 lang 放进依赖里 */
export function useLangValue(): string {
  return currentLang;
}
