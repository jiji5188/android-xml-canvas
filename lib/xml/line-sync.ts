// lib/xml/line-sync.ts — 画布 ↔ 代码视图的行号联动（M26）
//
// 反方向（代码光标行 → 选中节点）已有 parser.nodeAtLine；这里补正方向：
// 画布选中某个节点后，代码视图要滚到并高亮它的开标签行。
//
// 只用 path（#0/1/2）定位，不依赖渲染模型，纯函数好单测。

import { findNode, nodeAtLine } from "./parser";
import type { XmlNode } from "./types";

/** 节点自身开标签所在行（1 基）；找不到返回 null */
export function lineOfPath(root: XmlNode | null | undefined, path: string | null | undefined): number | null {
  if (!root || !path) return null;
  const node = findNode(root, path);
  if (!node || typeof node.line !== "number" || node.line < 1) return null;
  return node.line;
}

/** 节点子树覆盖的行范围（含后代，用于将来做整块高亮）；找不到返回 null */
export function spanOfPath(
  root: XmlNode | null | undefined,
  path: string | null | undefined,
): { from: number; to: number } | null {
  if (!root || !path) return null;
  const node = findNode(root, path);
  if (!node || typeof node.line !== "number" || node.line < 1) return null;
  let to = node.line;
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c.line === "number" && c.line > to) to = c.line;
      walk(c);
    }
  };
  walk(node);
  return { from: node.line, to };
}

/** 行号 → 该行最深的节点 path（代码 → 画布）；没有节点返回 null */
export function pathAtLine(root: XmlNode | null | undefined, line: number): string | null {
  if (!root || !Number.isFinite(line) || line < 1) return null;
  const n = nodeAtLine(root, line);
  return n?.path ?? null;
}

/** 是否要因为「用户正在敲代码」而跳过滚动（避免抢焦点）：比较选中路径是否已同步过 */
export function shouldResync(lastKey: string, path: string, line: number | null): boolean {
  if (line == null) return false;
  return lastKey !== `${path}@${line}`;
}
