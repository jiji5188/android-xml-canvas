// lib/xml/r-index.ts — M465：项目 R 表索引（资源名按类型归组），喂 Java 候选 `R.` / `R.layout.`
//
// 背景（用户 2026-11-21 拍板）：aapt2 link 生成的 R 表在编辑时也有价值——
// 候选列表能直接列出资源引用（R.layout.activity_main / R.string.app_name），
// 不用翻文件名。数据源 = 编辑器里已有的 resExtras.tree（res/ 目录树，values XML 带文本），
// 纯前端推导，不依赖打包。
//
// 纯函数，单测覆盖（test/xml_m465_r_suggest.test.ts）。

import type { ResourceExtras } from "./resdir";

/** R 子表类型（标准 Android res 类型，按常见度排序） */
export const R_TYPES = [
  "id", "layout", "drawable", "mipmap", "string", "color", "dimen",
  "style", "styleable", "array", "integer", "bool", "raw",
  "anim", "animator", "menu", "xml", "font", "plurals", "transition",
] as const;

export type RIndex = Record<string, string[]>;

/** values XML 顶层标签 → R 类型（同名 resource 标签统一算 string/color 等对应类型） */
const VALUES_TAG_TO_TYPE: Record<string, string> = {
  string: "string",
  color: "color",
  dimen: "dimen",
  style: "style",
  "declare-styleable": "styleable",
  "styleable": "styleable",
  "integer-array": "array",
  "string-array": "array",
  "array": "array",
  integer: "integer",
  bool: "bool",
  plurals: "plurals",
  "item": "",
};

/** 目录名 → R 类型（限定符后缀 -hdpi/-night/-v21/-zh 等剥掉） */
const DIR_TO_TYPE: Record<string, string> = {
  layout: "layout",
  drawable: "drawable",
  mipmap: "mipmap",
  raw: "raw",
  menu: "menu",
  anim: "anim",
  animator: "animator",
  color: "color",
  xml: "xml",
  font: "font",
  transition: "transition",
};

/** 去 res 名里的扩展名（ic_launcher.png → ic_launcher；.9.png 也剥） */
function baseResName(fileName: string): string {
  let n = fileName;
  if (n.endsWith(".9.png")) return n.slice(0, -6);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(0, i) : n;
}

/** 从一个 values XML 文本里抽 (tag, name) 对 */
function parseValuesXml(text: string): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  const re = /<([a-zA-Z-]+)\b[^>]*\bname\s*=\s*"([^"]+)"/g;
  for (const m of text.matchAll(re)) {
    const tag = m[1];
    const name = m[2];
    if (!name || name.startsWith("@") || name.startsWith("?")) continue;
    const t = VALUES_TAG_TO_TYPE[tag];
    if (!t) continue;
    out.push({ type: t, name });
  }
  return out;
}

function addName(idx: RIndex, type: string, name: string) {
  if (!type || !name) return;
  let set = idx[type];
  if (!set) idx[type] = (set = []);
  if (!set.includes(name)) set.push(name);
}

/**
 * 从 resExtras（编辑器 res 目录树）+ 本工具生成的 drawable 建 R 索引。
 * 没有任何资源时返回 {}（调用方据此不弹 R 候选，避免误导）。
 */
export function buildRIndex(
  res: ResourceExtras | null | undefined,
  generatedDrawables?: Record<string, unknown> | null,
): RIndex {
  const idx: RIndex = {};
  const tree = res?.tree;
  if (tree?.children) {
    for (const [dirName, node] of Object.entries(tree.children)) {
      if (!("children" in node)) continue; // res 根下不应有裸文件，防御
      const base = dirName.includes("-") ? dirName.slice(0, dirName.indexOf("-")) : dirName;
      if (base === "values") {
        // values*：解析 XML 抽 string/color/dimen/style/styleable/array/...
        for (const f of Object.values(node.children)) {
          if (!("text" in f)) continue;
          if (!f.rel.endsWith(".xml") || f.text == null) continue;
          for (const { type, name } of parseValuesXml(f.text)) addName(idx, type, name);
        }
        continue;
      }
      const type = DIR_TO_TYPE[base];
      if (!type) continue;
      for (const [fname, fnode] of Object.entries(node.children)) {
        if ("children" in fnode) continue; // 目录下不应再有目录
        // 布局/菜单/anim 等只收 .xml；drawable/mipmap/raw 收一切文件
        if (type !== "drawable" && type !== "mipmap" && type !== "raw" && !fname.endsWith(".xml")) continue;
        addName(idx, type, baseResName(fname));
      }
    }
  }
  // 本工具生成的 drawable
  if (generatedDrawables) {
    for (const n of Object.keys(generatedDrawables)) addName(idx, "drawable", n);
  }
  // resExtras 已解析好的 id 名（M256 收的 @+id，防 R.id 误报那份直接复用）
  if (res?.ids) for (const n of res.ids) addName(idx, "id", n);
  return idx;
}

/** R. 后该列的类型表：标准类型里有货的 + 索引里多出来的非标准类型 */
export function rTableTypes(idx: RIndex): string[] {
  const out: string[] = [];
  for (const t of R_TYPES) if (idx[t]?.length) out.push(t);
  for (const k of Object.keys(idx)) if (!out.includes(k)) out.push(k);
  return out;
}
