// lib/xml/drawable-attrs.ts — schema 属性 ⇄ 树节点字段的适配层（M121）
//
// schema 里写的是「XML 属性名」，树里存的是结构化字段（spec.kind / color / left …）。
// 这层负责两件事：
//   1. editableAttrs(node)：这个节点上哪些属性我们真的能读写（不能读写的就不显示，避免假控件）
//   2. readAttr / writeAttr：按 XML 属性名读写

import type { AttrDef } from "./drawable-schema";
import { NODE_DEFS, defOf } from "./drawable-schema";
import type { DrawableNode } from "./drawable-node";

/** 属性值统一按字符串走：写回时再由 build 决定格式 */
export function readAttr(node: DrawableNode, name: string): string | undefined {
  switch (node.t) {
    case "shape":
      if (name === "shape") return node.spec.kind;
      return undefined;
    case "color":
      return name === "color" ? node.color : undefined;
    case "ref":
      return name === "drawable" ? (node.name ? `@drawable/${node.name}` : "") : undefined;
    case "ripple":
      if (name === "color") return node.color;
      if (name === "radius") return node.radius;
      return undefined;
    default:
      return undefined;
  }
}

/** value 为空串/undefined = 清除该属性 */
export function writeAttr(node: DrawableNode, name: string, value: string | undefined): DrawableNode {
  const v = value?.trim();
  switch (node.t) {
    case "shape": {
      if (name !== "shape") return node;
      const kind =
        v === "oval" || v === "ring" || v === "line" || v === "rectangle" ? v : "rectangle";
      return { ...node, spec: { ...node.spec, kind } };
    }
    case "color":
      if (name !== "color") return node;
      return { ...node, color: v ?? "#00000000", asText: node.asText };
    case "ref":
      if (name !== "drawable") return node;
      return { ...node, name: (v ?? "").replace(/^@(drawable|mipmap)\//, "") };
    case "ripple":
      if (name === "color") return { ...node, color: v || undefined };
      if (name === "radius") return { ...node, radius: v || undefined };
      return node;
    default:
      return node;
  }
}

/** 当前节点上真正可编辑的属性（schema 顺序） */
export function editableAttrs(node: DrawableNode): AttrDef[] {
  const def = defOf(node);
  return def.attrs.filter((a) => readAttr(node, a.name) !== undefined || canWrite(node, a.name));
}

function canWrite(node: DrawableNode, name: string): boolean {
  switch (node.t) {
    case "shape":
      return name === "shape";
    case "color":
      return name === "color";
    case "ref":
      // M166：ref 节点的参数由 SlotRows 里的「引用资源」输入框管（带搜索过滤），
      // 这里不再有可写属性，避免参数面板重复出现一条「资源」
      return false;
    case "ripple":
      return name === "color" || name === "radius";
    default:
      return false;
  }
}

export function dpOut(n: number | undefined): string | undefined {
  if (!n) return undefined;
  return `${Math.round(n * 100) / 100}dp`;
}

export function dpIn(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.match(/^(-?[\d.]+)\s*(dp|dip|px|sp)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  return (m[2] || "dp").toLowerCase() === "px" ? n * 0.5 : n;
}

/** 给 UI 用的节点摘要（树行右侧的小字） */
export function nodeSummary(node: DrawableNode): string {
  switch (node.t) {
    case "shape": {
      const s = node.spec;
      // 形状类型已经在行标题里了（“第 2 层 · 矩形”），这里只补颜色，不重复
      if (s.gradient) return "渐变";
      return (s.solid ?? "").replace(/^#/, "").slice(-6) || "无填充";
    }
    case "color":
      return node.color;
    case "ref":
      return `@drawable/${node.name}`;
    case "layer":
      return `${node.items.length} 层`;
    case "selector":
      return `${node.items.length} 个状态`;
    case "ripple":
      return [node.content ? "内容" : "", node.mask ? "遮罩" : ""].filter(Boolean).join("+") || "空";
    default:
      return (node as { tag?: string }).tag ?? "";
  }
}

export { NODE_DEFS };
