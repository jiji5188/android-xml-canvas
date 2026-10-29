// lib/xml/path-chain.ts — 选中节点 → 根到它的层级链（右侧属性面板顶部面包屑用）
//
// path 形如 "#0/1/2"：第一段恒为根（#0），其后每段是父节点 children 的下标。
// 这里按下标逐段步进（不做字符串搜索），拿到 tag 和 id 给面板展示；
// 纯函数，方便单测，也避免在组件里重复写解析逻辑。

import type { XmlNode } from "./types";

export interface ChainItem {
  /** 原始标签（可能带包名前缀，展示时再 shortTag） */
  tag: string;
  /** 该节点自身的 path（可回传给 setSelectedPath 直接跳转） */
  path: string;
  /** android:id（若有，面包屑里显示便于区分同类型兄弟） */
  id?: string;
}

/** 根 → 当前节点的链条；path 无效时返回空数组 */
export function pathChainOf(root: XmlNode | null, path: string | null): ChainItem[] {
  if (!root || !path) return [];
  const segs = path.replace(/^#/, "").split("/").filter(Boolean);
  if (segs.length === 0) return [];
  // 第一段是根的下标（恒 0）；根节点本身也要进链条
  const out: ChainItem[] = [{ tag: root.tag, path: "#" + segs[0], id: root.attrs["id"] }];
  let cur: XmlNode = root;
  for (let i = 1; i < segs.length; i++) {
    const idx = parseInt(segs[i], 10);
    if (!Number.isFinite(idx)) break;
    const next = cur.children[idx];
    if (!next) break;
    cur = next;
    out.push({ tag: cur.tag, path: "#" + segs.slice(0, i + 1).join("/"), id: cur.attrs["id"] });
  }
  return out;
}
