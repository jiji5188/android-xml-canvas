// lib/xml/resource-panel.ts — M183 资源面板的纯逻辑层（可单测，不碰 DOM）
//
// 背景：旧的「资源值」面板把 res/values*/ 下所有文件拉平，同一资源名在
// values/、values-night/、values-zh-rCN/ 里各算一遍 → 八百多条看着像重复。
// 这里的规则：以资源名为主键、限定符为从属，先聚合再展示。
// 项目资源（mipmap/drawable）也归这里管，「草稿」（未写盘）由面板自己接 GenAssets 数据。

import { parseValues, type ValueItem } from "@/lib/xml/values-edit";

export type ResTab = "draft" | "icon" | "text" | "color" | "other";

/** 一条 values 资源（跨限定符聚合后的视图） */
export interface ValueGroup {
  /** 资源名（<string name="x"> 里的 x） */
  name: string;
  /** 类型：string | color | dimen | integer | bool */
  kind: string;
  /** 出现在哪些限定符目录（如 values / values-night / values-zh-rCN） */
  variants: Array<{
    /** 文件相对项目根路径 */
    rel: string;
    /** 限定符目录名（values-night → night） */
    qualifier: string;
    /** 每个文件里的值（同名可能有多行，按出现顺序） */
    items: Array<{ item: ValueItem; line: number }>;
  }>;
}

/** 扫出来的文件 → 按资源名聚合 */
export function groupValuesByResource(
  files: Array<{ rel: string; xml: string }>,
): ValueGroup[] {
  const map = new Map<string, ValueGroup>();
  for (const f of files) {
    const parentDir = f.rel.slice(0, f.rel.lastIndexOf("/")); // "…/res/values-night"
  const dirName = parentDir.includes("/") ? parentDir.slice(parentDir.lastIndexOf("/") + 1) : parentDir;
    const qualifier = valuesQualifier(dirName);
    let doc;
    try {
      doc = parseValues(f.xml);
    } catch {
      continue; // 解析不了的文件跳过，不让一个坏文件毁掉整张表
    }
    for (const item of doc.items) {
      if (!item.name) continue;
      const key = item.kind + "/" + item.name;
      let g = map.get(key);
      if (!g) {
        g = { name: item.name, kind: item.kind, variants: [] };
        map.set(key, g);
      }
      let v = g.variants.find((x) => x.rel === f.rel);
      if (!v) {
        v = { rel: f.rel, qualifier, items: [] };
        g.variants.push(v);
      }
      v.items.push({ item, line: item.line });
    }
  }
  const out = [...map.values()];
  // 按类型 + 名字排，稳定可预测
  out.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind),
  );
  return out;
}

/** values 目录名 → 限定符（values → 空=默认，values-night → night，values-zh-rCN → zh-rCN） */
export function valuesQualifier(dirName: string): string {
  const m = /^values(-(.*))?\/?$/.exec(dirName);
  return m ? m[2] || "" : "";
}

/** 文本 tab 只放 string 系（string/arrays 都算），颜色 tab 放 color，其他 tab 放其余 */
export function splitGroupsByTab(groups: ValueGroup[]): {
  text: ValueGroup[];
  color: ValueGroup[];
  other: ValueGroup[];
} {
  const text: ValueGroup[] = [];
  const color: ValueGroup[] = [];
  const other: ValueGroup[] = [];
  for (const g of groups) {
    if (g.kind === "string" || g.kind === "item") text.push(g);
    else if (g.kind === "color") color.push(g);
    else other.push(g);
  }
  return { text, color, other };
}

/**
 * 给资源选一个「默认编辑目标」：没有限定符的值优先（values/ 是主文件），
 * 其次按 qualifier 的「长度短 = 更通用」排。返回要打开的文件 rel + 行号。
 */
export function primaryVariant(g: ValueGroup): { rel: string; line: number } {
  let best = g.variants[0];
  for (const v of g.variants) {
    if (v.qualifier === "" && best.qualifier !== "") best = v;
    else if (v.qualifier.length < best.qualifier.length) best = v;
  }
  return { rel: best.rel, line: best.items[0].line };
}

/** 项目图标/drawable 文件的 tab 归属：图片与 vector 归「图标」，xml 形状类归「其他」 */
export function iconFileTab(rel: string, name: string): "icon" | "other" {
  const p = (rel + "/" + name).toLowerCase();
  const parts = p.split("/").filter(Boolean);
  const base = name ? name.toLowerCase() : parts[parts.length - 1] || "";
  // 1) 图片扩展名 → 图标（不管在哪个目录）
  if (/\.(png|webp|jpe?g|gif|bmp)$/.test(base)) return "icon";
  // 2) 路径里任意一段是 mipmap*/drawable* → 图标（含里面的 xml）
  if (parts.some((seg) => /^(mipmap|drawable)/.test(seg))) return "icon";
  return "other";
}

/** 一行值显示：颜色带色块，字符串截断 */
export function valuePreview(v: string): { text: string; color?: string } {
  const m = /^#([0-9a-f]{6,8})$/i.exec(v.trim());
  if (m) return { text: v, color: v };
  if (v.length > 24) return { text: v.slice(0, 24) + "…" };
  return { text: v };
}
