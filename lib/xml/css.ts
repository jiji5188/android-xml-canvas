// lib/xml/css.ts — Android 布局语义 → CSS 映射（M1 核心引擎）
// 把「已解析」的树转成 React 可直接用的 style 对象树。
// 单位：画布 scale 默认 1dp=2px（可通过 scale 参数调）。

import type { XmlNode, ResourceTable, RenderModel, ResolvedNode } from "./types";
import { resolveNodeAttrs } from "./resolve";
import type { ResolvedAttrs } from "./resolve";

const DP = (n: number, scale = 2) => n * scale;

/** 控件类名（占位渲染用） */
function viewClass(tag: string, a: ResolvedAttrs): string {
  switch (tag) {
    case "TextView":
    case "Button":
    case "EditText":
      return "axv-text";
    case "ImageView":
      return "axv-image";
    case "ProgressBar":
      return "axv-progress";
    case "View":
    case "Space":
      return "axv-view";
    default:
      return "axv-container";
  }
}

function sizeToCss(s: unknown, scale: number): string {
  if (s === null || s === undefined) return "auto";
  const spec = s as { kind: string; value?: number };
  switch (spec.kind) {
    case "match": return "100%";
    case "wrap": return "auto";
    case "zero": return "0px";
    case "px": return `${spec.value}px`;
    case "dp": return `${DP(spec.value ?? 0, scale)}px`;
    default: return "auto";
  }
}

function gravityToJustify(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  const has = (k: string) => g.includes(k);
  // 水平主轴（vertical 容器的 justify-content）
  if (has("center_horizontal")) v.justifyContent = "center";
  if (has("end") || has("right")) v.justifyContent = "flex-end";
  if (has("start") || has("left")) v.justifyContent = "flex-start";
  if (has("center_vertical")) v.alignItems = "center";
  return v;
}

function layoutGravityToSelf(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  if (g.includes("center")) v.alignSelf = "center";
  if (g.includes("end") || g.includes("right")) v.alignSelf = "flex-end";
  if (g.includes("start") || g.includes("left")) v.alignSelf = "flex-start";
  return v;
}

function orientationAlign(dir: string): { flexDirection: string; alignItems?: string } {
  return dir === "horizontal"
    ? { flexDirection: "row" }
    : { flexDirection: "column" };
}

export function buildRenderModel(
  root: XmlNode,
  res: ResourceTable,
  scale = 2,
): RenderModel {
  const issues: import("./types").XmlIssue[] = [];

  const resolveAll = (node: XmlNode): ResolvedNode => {
    const { attrs, issues: nIssues } = resolveNodeAttrs(node, res);
    issues.push(...nIssues);
    const style: Record<string, string | number> = {};

    // 容器
    if (node.tag === "LinearLayout" || node.tag === "FrameLayout" || node.tag === "ScrollView" || node.tag === "HorizontalScrollView") {
      style.display = "flex";
      if (node.tag === "ScrollView") {
        style.flexDirection = "column";
        style.overflowY = "auto";
      } else if (node.tag === "HorizontalScrollView") {
        style.flexDirection = "row";
        style.overflowX = "auto";
      } else if (node.tag === "LinearLayout") {
        const o = orientationAlign((attrs["orientation"] as string) || "vertical");
        style.flexDirection = o.flexDirection;
        const g = gravityToJustify((attrs["gravity"] as string) || "");
        Object.assign(style, g);
        style.justifyContent = g.justifyContent ?? "flex-start";
        style.alignItems = g.alignItems ?? "stretch";
      } else {
        // FrameLayout
        style.position = "relative";
      }
    }

    // 通用尺寸（所有节点）
    const w = sizeToCss(attrs["width"], scale);
    const h = sizeToCss(attrs["height"], scale);
    const weight = attrs["weight"] as number;
    if (weight > 0) {
      style.flexGrow = weight;
      style.flexShrink = 1;
      style.minWidth = 0;
      if ((attrs["width"] as { kind?: string })?.kind === "zero" || (attrs["width"] as { kind?: string })?.kind === "match") {
        style.flexBasis = "0px";
      }
    }
    // 尺寸
    style.width = w === "0px" && weight === 0 ? "auto" : w;
    style.height = h === "0px" ? "auto" : h;

    // 边距（用 longhand，便于 M1b 属性面板逐边编辑 + 回写）
    const mt = DP((attrs["marginT"] as number) || 0, scale);
    const mr = DP((attrs["marginR"] as number) || 0, scale);
    const mb = DP((attrs["marginB"] as number) || 0, scale);
    const ml = DP((attrs["marginL"] as number) || 0, scale);
    if (mt) style.marginTop = `${mt}px`;
    if (mr) style.marginRight = `${mr}px`;
    if (mb) style.marginBottom = `${mb}px`;
    if (ml) style.marginLeft = `${ml}px`;

    // 内边距（longhand）
    const pt = DP((attrs["paddingT"] as number) || 0, scale);
    const pr = DP((attrs["paddingR"] as number) || 0, scale);
    const pb = DP((attrs["paddingB"] as number) || 0, scale);
    const pl = DP((attrs["paddingL"] as number) || 0, scale);
    if (pt) style.paddingTop = `${pt}px`;
    if (pr) style.paddingRight = `${pr}px`;
    if (pb) style.paddingBottom = `${pb}px`;
    if (pl) style.paddingLeft = `${pl}px`;

    // 背景 / 圆角 / 阴影
    const bg = (attrs["background"] as string) || "";
    if (bg) style.background = bg;
    const r = (attrs["radius"] as number) || 0;
    if (r) style.borderRadius = `${DP(r, scale)}px`;
    const el = attrs["elevation"] as { kind?: string; value?: number } | null;
    if (el && el.kind === "dp" && (el.value ?? 0) > 0) style.boxShadow = `0 ${el.value * scale * 2}px ${el.value * scale * 4}px rgba(0,0,0,0.18)`;

    // 可见性
    const vis = (attrs["visibility"] as string) || "visible";
    if (vis === "gone") style.display = "none";
    else if (vis === "invisible") style.visibility = "hidden";

    // 文本类
    const cls = viewClass(node.tag, attrs);
    if (cls === "axv-text") {
      style.boxSizing = "border-box";
      const ts = (attrs["textSize"] as number) || 14;
      style.fontSize = `${DP(ts, scale)}px`;
      const tc = (attrs["textColor"] as string) || "#1D1B20";
      style.color = tc;
      const align = (attrs["textAlignment"] as string) || "";
      if (align === "center") style.textAlign = "center";
      if ((attrs["textAllCaps"] as boolean)) style.textTransform = "uppercase";
      if ((attrs["textStyle"] as string) === "bold") style.fontWeight = 600;
      // Button/EditText 默认样式
      if (node.tag === "Button") {
        style.backgroundColor = bg || "#6750A4";
        style.color = tc || "#FFFFFF";
        style.borderRadius = style.borderRadius ?? `${DP(20, scale)}px`;
        style.fontWeight = 500;
        style.cursor = "pointer";
      }
      if (node.tag === "EditText") {
        style.border = style.border ?? "1px solid #E0D9E3";
        style.borderRadius = style.borderRadius ?? `${DP(8, scale)}px`;
        style.backgroundColor = style.backgroundColor ?? "#FFFFFF";
      }
      style.minHeight = (attrs["minHeight"] as number) ? `${DP(attrs["minHeight"] as number, scale)}px` : style.minHeight;
    }

    if (cls === "axv-image") {
      style.aspectRatio = (attrs["adjustViewBounds"] as boolean) ? "1 / 1" : undefined;
      if (!(attrs["src"] as string)) {
        style.background = style.background || "#E0D9E3";
        style.minHeight = style.minHeight || `${DP(48, scale)}px`;
      }
    }

    if (cls === "axv-progress") {
      const styleAttr = (attrs["progressStyle"] as string) || "";
      if (styleAttr.includes("horizontal")) {
        style.height = style.height || `${DP(4, scale)}px`;
        style.background = style.background || "#E0D9E3";
        style.borderRadius = `${DP(2, scale)}px`;
        style.overflow = "hidden";
      } else {
        style.width = style.width || `${DP(32, scale)}px`;
        style.height = style.height || `${DP(32, scale)}px`;
      }
    }

    // layout_gravity（FrameLayout / LinearLayout 子项）
    const lg = layoutGravityToSelf((attrs["layoutGravity"] as string) || "");
    Object.assign(style, lg);
    // FrameLayout 子项绝对定位
    if (node.tag !== "FrameLayout" && node.tag !== "LinearLayout" && node.tag !== "ScrollView" && node.tag !== "HorizontalScrollView") {
      if (findParentTag(root, node) === "FrameLayout") {
        style.position = "absolute";
        style.zIndex = "1";
      }
    }

    const resolved: ResolvedNode = {
      tag: node.tag,
      path: node.path,
      style,
      className: cls,
      text: (attrs["text"] as string) || "",
      issues: nIssues,
      children: node.children.map(resolveAll),
      rawAttrs: node.attrs,
    };
    return resolved;
  };

  const rootNode = resolveAll(root);
  return { root: rootNode, issues };
}

/** 从 root 找某 node 的父节点 tag（M1 简化：FrameLayout 子项绝对定位判断） */
function findParentTag(root: XmlNode, target: XmlNode): string | null {
  const walk = (n: XmlNode, parent: string | null): string | null => {
    if (n.path === target.path) return parent;
    for (const c of n.children) {
      const r = walk(c, n.tag);
      if (r !== null) return r;
    }
    return null;
  };
  return walk(root, null);
}
