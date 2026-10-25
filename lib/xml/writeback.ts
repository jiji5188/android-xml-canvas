// lib/xml/writeback.ts — M1b 双向：画布选中节点改属性 → 回写 XML 原文
// 策略：保留原 XML 声明/注释，按 path 定位目标节点，替换属性后重序列化整棵树。
// M1 简化：注释集中放文档尾（M2 再做原位锚点保留）。

import { parseLayoutXml, findNode, rewriteNodeAttrs } from "./parser";
import type { XmlNode, XmlIssue } from "./types";

export interface WritebackResult {
  xml: string;
  changed: boolean;
  issues: XmlIssue[];
}

/**
 * 回写单个节点属性。
 * @param originalXml 原 XML 文本
 * @param path 节点路径（#0/1/0 风格）
 * @param newAttrs 新属性值（未带命名空间前缀，如 text/textSize）
 * @param removedAttrs 要删除的属性名
 */
export function writebackAttrs(
  originalXml: string,
  path: string,
  newAttrs: Record<string, string>,
  removedAttrs?: string[],
): WritebackResult {
  const issues: XmlIssue[] = [];
  const { root } = parseLayoutXml(originalXml);
  if (!root) {
    issues.push({ level: "error", nodePath: path, message: "无法解析原 XML，回写失败" });
    return { xml: originalXml, changed: false, issues };
  }
  const target = findNode(root, path);
  if (!target) {
    issues.push({ level: "error", nodePath: path, message: "找不到节点路径 " + path });
    return { xml: originalXml, changed: false, issues };
  }
  let changed = false;
  for (const [k, v] of Object.entries(newAttrs)) {
    if (target.attrs[k] !== v) changed = true;
  }
  for (const k of removedAttrs ?? []) {
    if (target.attrs[k] !== undefined) changed = true;
  }
  if (!changed) return { xml: originalXml, changed: false, issues };
  const xml = rewriteNodeAttrs(originalXml, path, newAttrs, removedAttrs);
  return { xml, changed: true, issues };
}

/** px 画布值 → Android 单位文本（scale: 1dp = scale px） */
const pxToDp = (px: number, scale = 2): string => px / scale + "dp";
const pxToSp = (px: number, scale = 2): string => px / scale + "sp";
const num = (v: string | number): number => parseInt(String(v), 10);

/**
 * 把「画布属性面板里的值」映射回「Android XML 属性」。
 * 例如：fontSize 36px → textSize 18sp；marginRight 32px → layout_marginEnd 16dp
 */
export function canvasToXmlAttrs(
  style: Record<string, string | number>,
  tag: string,
  scale = 2,
): Record<string, string> {
  const out: Record<string, string> = {};

  // 文本
  if (style.text !== undefined && style.text !== "") out["text"] = style.text as string;
  if (style.fontSize !== undefined) out["textSize"] = pxToSp(num(style.fontSize), scale);
  if (style.color !== undefined) out["textColor"] = style.color as string;
  if (style.fontWeight === 600 || style.fontWeight === 700 || style.fontWeight === "bold") {
    out["textStyle"] = "bold";
  }

  // 背景
  if (style.background !== undefined) out["background"] = style.background as string;
  if (style.borderRadius !== undefined) out["radius"] = pxToDp(num(style.borderRadius), scale);

  // margin（画布四边 → Android 起止边）
  if (style.marginTop !== undefined) out["layout_marginTop"] = pxToDp(num(style.marginTop), scale);
  if (style.marginRight !== undefined) out["layout_marginEnd"] = pxToDp(num(style.marginRight), scale);
  if (style.marginBottom !== undefined) out["layout_marginBottom"] = pxToDp(num(style.marginBottom), scale);
  if (style.marginLeft !== undefined) out["layout_marginStart"] = pxToDp(num(style.marginLeft), scale);

  // 容器方向
  if (style.flexDirection !== undefined && (tag === "LinearLayout" || tag === "RadioGroup")) {
    out["orientation"] = style.flexDirection === "row" ? "horizontal" : "vertical";
  }

  // 可见性
  if (style.display === "none") out["visibility"] = "gone";
  else if (style.visibility === "hidden") out["visibility"] = "invisible";

  return out;
}

/** 反查：某 path 节点当前在 XML 里的属性（供属性面板初始化） */
export function readNodeAttrs(originalXml: string, path: string): Record<string, string> | null {
  const { root } = parseLayoutXml(originalXml);
  if (!root) return null;
  const n = findNode(root, path);
  return n ? { ...n.attrs } : null;
}

/** 校验：回写后的 XML 仍能被解析（完整性检查） */
export function validateXml(xml: string): { ok: boolean; issues: XmlIssue[] } {
  const { root, issues } = parseLayoutXml(xml);
  const hardErrors = issues.filter((i) => i.level === "error");
  return { ok: root !== null && hardErrors.length === 0, issues };
}

export type { XmlNode };
