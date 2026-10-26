// lib/xml/css.ts — Android 布局语义 → CSS 映射（M1 核心引擎）
// 把「已解析」的树转成 React 可直接用的 style 对象树。
// 单位：画布 scale 默认 1dp=2px（可通过 scale 参数调）。

import type { XmlNode, ResourceTable, RenderModel, ResolvedNode } from "./types";
import { resolveNodeAttrs, resolveSize } from "./resolve";
import type { ResolvedAttrs } from "./resolve";
import { solveConstraintChildren } from "./constraints";

const DP = (n: number, scale = 2) => n * scale;

/** 全限定类名 → 短名：androidx.recyclerview.widget.RecyclerView → RecyclerView */
function shortTag(tag: string): string {
  return tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
}

/** 控件类名（占位渲染用） */
function viewClass(rawTag: string, a: ResolvedAttrs): string {
  const tag = shortTag(rawTag);
  switch (tag) {
    case "TextView":
    case "AppCompatTextView":
    case "Button":
    case "AppCompatButton":
    case "MaterialButton":
    case "EditText":
    case "AppCompatEditText":
    case "TextInputEditText":
      return "axv-text";
    case "ImageView":
    case "AppCompatImageView":
      return "axv-image";
    case "ProgressBar":
      return "axv-progress";
    case "View":
    case "Space":
      return "axv-view";
    // M2a：复合 / 常用控件占位
    case "CardView":
    case "MaterialCardView":
      return "axv-card";
    case "RecyclerView":
    case "ListView":
      return "axv-list";
    case "Switch":
    case "SwitchMaterial":
    case "SwitchCompat":
      return "axv-switch";
    case "CheckBox":
    case "AppCompatCheckBox":
      return "axv-check";
    case "RadioButton":
    case "AppCompatRadioButton":
      return "axv-radio";
    case "SeekBar":
    case "Slider":
      return "axv-seek";
    case "Spinner":
      return "axv-spinner";
    // M2c：ConstraintLayout 辅助节点（渲染为参考线）
    case "Guideline":
      return "axv-guideline";
    case "Barrier":
      return "axv-barrier";
    case "include":
      return "axv-include";
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
  const parts = g.split("|");
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));
  if (has("center")) {
    v.justifyContent = "center";
    v.alignItems = "center";
  } else {
    if (has("top")) v.justifyContent = "flex-start";
    if (has("bottom")) v.justifyContent = "flex-end";
    if (has("center_vertical")) v.justifyContent = "center";
    if (has("start") || has("left")) v.alignItems = "flex-start";
    if (has("end") || has("right")) v.alignItems = "flex-end";
    if (has("center_horizontal")) v.alignItems = "center";
  }
  return v;
}

/** 文本类控件的 gravity → text-align（Button/TextView/EditText 语义） */
function gravityToTextAlign(g: string): "left" | "center" | "right" | undefined {
  if (!g) return undefined;
  const parts = g.split("|");
  if (parts.includes("center") || parts.includes("center_horizontal")) return "center";
  if (parts.includes("start") || parts.includes("left")) return "left";
  if (parts.includes("end") || parts.includes("right")) return "right";
  return undefined;
}

/** 文本类控件的 gravity → flex 对齐（.axv-text 是 flex 容器，textAlign 管不到匿名文本项） */
function gravityToFlexAlign(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  const parts = g.split("|");
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));
  if (has("center")) {
    v.justifyContent = "center";
    v.alignItems = "center";
    return v;
  }
  if (has("center_horizontal")) v.justifyContent = "center";
  else if (has("start", "left")) v.justifyContent = "flex-start";
  else if (has("end", "right")) v.justifyContent = "flex-end";
  if (has("center_vertical")) v.alignItems = "center";
  else if (has("top")) v.alignItems = "flex-start";
  else if (has("bottom")) v.alignItems = "flex-end";
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
    const tag = shortTag(node.tag); // 全限定类名归一化

    // 容器
    const isCL = tag === "ConstraintLayout" || tag === "ConstraintSet";
    if (tag === "LinearLayout" || tag === "FrameLayout" || tag === "ScrollView" || tag === "HorizontalScrollView" || tag === "CardView" || tag === "MaterialCardView" || isCL) {
      style.display = "flex";
      if (tag === "ScrollView") {
        style.flexDirection = "column";
        style.overflowY = "auto";
      } else if (tag === "HorizontalScrollView") {
        style.flexDirection = "row";
        style.overflowX = "auto";
      } else if (tag === "LinearLayout") {
        const o = orientationAlign((attrs["orientation"] as string) || "vertical");
        style.flexDirection = o.flexDirection;
        const g = gravityToJustify((attrs["gravity"] as string) || "");
        Object.assign(style, g);
        style.justifyContent = g.justifyContent ?? "flex-start";
        style.alignItems = g.alignItems ?? "stretch";
      } else if (tag === "CardView" || tag === "MaterialCardView") {
        style.flexDirection = "column";
      } else {
        // FrameLayout / ConstraintLayout
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
    if (bg) style.backgroundColor = bg;
    const r = (attrs["radius"] as number) || 0;
    if (r) style.borderRadius = `${DP(r, scale)}px`;
    const el = attrs["elevation"] as { kind?: string; value?: number } | null;
    if (el && el.kind === "dp" && (el.value ?? 0) > 0) {
      const ev = el.value ?? 0;
      style.boxShadow = `0 ${ev * scale * 2}px ${ev * scale * 4}px rgba(0,0,0,0.18)`;
    }

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
      const gRaw = (attrs["gravity"] as string) || "";
      const ga = gravityToTextAlign(gRaw);
      // flex 容器里真正决定位置的是 justify-content / align-items
      Object.assign(style, gravityToFlexAlign(gRaw));
      if (align === "center" || ga === "center") {
        style.textAlign = "center";
        style.justifyContent = style.justifyContent ?? "center";
      } else if (ga) {
        style.textAlign = ga;
      }
      if ((attrs["textAllCaps"] as boolean)) style.textTransform = "uppercase";
      if ((attrs["textStyle"] as string) === "bold") style.fontWeight = 600;
      // Button/EditText 默认样式
      if (tag === "Button" || tag === "MaterialButton" || tag === "AppCompatButton") {
        style.backgroundColor = bg || "#6750A4";
        style.color = tc || "#FFFFFF";
        style.borderRadius = style.borderRadius ?? `${DP(20, scale)}px`;
        style.fontWeight = 500;
        style.cursor = "pointer";
      }
      if (tag === "EditText" || tag === "AppCompatEditText" || tag === "TextInputEditText") {
        style.border = style.border ?? "1px solid #E0D9E3";
        style.borderRadius = style.borderRadius ?? `${DP(8, scale)}px`;
        style.backgroundColor = style.backgroundColor ?? "#FFFFFF";
        if (attrs["hint"] && !(attrs["text"] as string)) {
          style.color = "#9A9AA8";
        }
      }
      style.minHeight = (attrs["minHeight"] as number) ? `${DP(attrs["minHeight"] as number, scale)}px` : style.minHeight;
    }

    if (cls === "axv-image") {
      if (attrs["adjustViewBounds"]) style.aspectRatio = "1 / 1";
      if (!(attrs["src"] as string)) {
        style.backgroundColor = style.backgroundColor || "#E0D9E3";
        style.minHeight = style.minHeight || `${DP(48, scale)}px`;
      }
    }

    if (cls === "axv-progress") {
      const styleAttr = (attrs["progressStyle"] as string) || "";
      if (styleAttr.includes("horizontal")) {
        style.height = style.height || `${DP(4, scale)}px`;
        style.backgroundColor = style.backgroundColor || "#E0D9E3";
        style.borderRadius = `${DP(2, scale)}px`;
        style.overflow = "hidden";
      } else {
        style.width = style.width || `${DP(32, scale)}px`;
        style.height = style.height || `${DP(32, scale)}px`;
      }
    }

    // ===== M2a：复合 / 常用控件占位渲染 =====
    if (cls === "axv-card") {
      const cr = (attrs["cardCornerRadius"] as number) || 12;
      style.backgroundColor = bg || "#FFFFFF";
      style.borderRadius = `${DP(cr, scale)}px`;
      if (!el || (el.value ?? 0) <= 0) style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      style.overflow = "hidden";
    }

    if (cls === "axv-list") {
      style.backgroundColor = style.backgroundColor || "#FFFFFF";
      style.minHeight = style.minHeight || `${DP(160, scale)}px`;
    }

    if (cls === "axv-switch") {
      style.minWidth = `${DP(56, scale)}px`;
      style.minHeight = `${DP(32, scale)}px`;
      style.borderRadius = `${DP(16, scale)}px`;
      style.backgroundColor = style.backgroundColor || (attrs["checked"] ? "#6750A4" : "#E0D9E3");
      style.boxSizing = "border-box";
    }

    if (cls === "axv-check" || cls === "axv-radio") {
      style.minWidth = `${DP(24, scale)}px`;
      style.minHeight = `${DP(24, scale)}px`;
      style.boxSizing = "border-box";
      style.backgroundColor = style.backgroundColor || (attrs["checked"] ? "#6750A4" : "#FFFFFF");
      style.border = "2px solid " + (attrs["checked"] ? "#6750A4" : "#79747E");
      style.borderRadius = cls === "axv-radio" ? "50%" : `${DP(4, scale)}px`;
    }

    if (cls === "axv-seek") {
      style.minWidth = `${DP(120, scale)}px`;
      style.minHeight = `${DP(24, scale)}px`;
      style.backgroundColor = style.backgroundColor || "#E0D9E3";
      style.borderRadius = `${DP(2, scale)}px`;
      const p = (attrs["progress"] as number) || 0;
      const maxV = (attrs["max"] as number) || 100;
      style["--axv-progress"] = String(Math.min(1, maxV > 0 ? p / maxV : 0));
    }

    if (cls === "axv-spinner") {
      style.minHeight = `${DP(40, scale)}px`;
      style.border = "1px solid #79747E";
      style.borderRadius = `${DP(8, scale)}px`;
      style.backgroundColor = style.backgroundColor || "#FFFFFF";
      style.paddingRight = `${DP(28, scale)}px`;
    }

    // ===== M2c：Guideline / Barrier 渲染为参考线（位置尺寸由 patchCL 求解写入） =====
    if (cls === "axv-guideline") {
      style.backgroundColor = "rgba(103,80,164,0.55)";
      style.zIndex = "2";
    } else if (cls === "axv-barrier") {
      style.backgroundColor = "rgba(255,111,0,0.45)";
      style.zIndex = "2";
    }

    if (cls === "axv-include") {
      style.minHeight = `${DP(48, scale)}px`;
      style.border = "1px dashed #B0AEB8";
      style.borderRadius = `${DP(4, scale)}px`;
    }

    // layout_gravity（FrameLayout / LinearLayout 子项）
    const lg = layoutGravityToSelf((attrs["layoutGravity"] as string) || "");
    Object.assign(style, lg);
    // FrameLayout 子项绝对定位
    const parentTag = shortTag(findParentTag(root, node) ?? "");
    if (parentTag === "FrameLayout") {
      style.position = "absolute";
      style.zIndex = "1";
    }

    // 开关/勾选类不渲染文字到框里（会在 title 提示里显示）
    let text = (attrs["text"] as string) || "";
    if (cls === "axv-switch" || cls === "axv-check" || cls === "axv-radio" || cls === "axv-seek") {
      text = "";
    } else if (cls === "axv-include") {
      text = "⟳ include " + ((node.attrs["layout"] as string) || "");
    } else if (cls === "axv-text" && !text && (attrs["hint"] as string)) {
      text = attrs["hint"] as string;
    }

    const resolved: ResolvedNode = {
      tag: node.tag,
      path: node.path,
      style,
      className: cls + (attrs["checked"] ? " axv-checked" : ""),
      text,
      issues: nIssues,
      children: node.children.map(resolveAll),
      rawAttrs: node.attrs,
    };
    return resolved;
  };

  const rootNode = resolveAll(root);

  // M2b：ConstraintLayout 子项约束定位（后处理：对每个 CL 节点求解直接子项）
  const patchCL = (n: ResolvedNode): void => {
    if (shortTag(n.tag) !== "ConstraintLayout") {
      for (const c of n.children) patchCL(c);
      return;
    }
    // CL 自身内容区尺寸（px）：取自身 style 的 width/height，"100%"/auto/undefined 时回落到手机屏默认
    const toPx = (v: unknown, fallback: number): number => {
      const s2 = String(v ?? "");
      if (s2.endsWith("px")) return parseFloat(s2);
      if (s2 === "100%" || s2 === "" || s2 === "auto") return fallback;
      const m = s2.match(/^(-?[0-9.]+)/);
      if (m && !s2.includes("%")) return parseFloat(m[1]);
      return fallback;
    };
    const cw = toPx(n.style.width, 412 * scale);
    const ch = toPx(n.style.height, 892 * scale);
    // CL 自身尺寸必须落实成 px：父级只有 min-height 时 100% 解析不出来，
    // 子项全 absolute 又撑不起来 → 容器会塔成 0 高（真 bug，会看到控件跑出屏幕）
    const wStr = String(n.style.width ?? "");
    const hStr = String(n.style.height ?? "");
    if (wStr === "100%" || wStr === "auto" || wStr === "") n.style.width = `${cw}px`;
    if (hStr === "100%" || hStr === "auto" || hStr === "") n.style.height = `${ch}px`;
    const sourceCL = findSourceNode(root, n.path);
    if (!sourceCL) return;
    const solved = solveConstraintChildren(sourceCL, res, cw, ch);
    issues.push(...solved.issues);
    for (const child of n.children) {
      const box = solved.boxes.get(child.path);
      if (!box) continue;
      const cTag = shortTag(child.tag);
      child.style.position = "absolute";
      // M2c：Guideline / Barrier 参考线——0 维盒子展开成 2px 线
      if (cTag === "Guideline" || cTag === "Barrier") {
        const o = (child.rawAttrs["orientation"] ?? "vertical").toLowerCase();
        const dir = (child.rawAttrs["barrierDirection"] ?? "top").toLowerCase();
        const isHorizLine = cTag === "Guideline" ? o === "horizontal" : dir === "top" || dir === "bottom";
        if (isHorizLine) {
          child.style.left = "0px";
          child.style.top = `${box.top}px`;
          child.style.width = `${cw}px`;
          child.style.height = "2px";
        } else {
          child.style.left = `${box.left}px`;
          child.style.top = "0px";
          child.style.width = "2px";
          child.style.height = `${ch}px`;
        }
        child.style.boxSizing = "border-box";
        for (const gc of child.children) patchCL(gc);
        continue;
      }
      child.style.left = `${box.left}px`;
      child.style.top = `${box.top}px`;
      child.style.width = `${box.width}px`;
      child.style.height = `${box.height}px`;
      child.style.boxSizing = "border-box";
      delete child.style.marginTop;
      delete child.style.marginRight;
      delete child.style.marginBottom;
      delete child.style.marginLeft;
      for (const gc of child.children) patchCL(gc);
    }
  };
  patchCL(rootNode);

  return { root: rootNode, issues };
}

/** 按 path 在源 XML 树里找节点（ConstraintLayout 求解需要 XmlNode.attrs） */
function findSourceNode(root: XmlNode, path: string): XmlNode | null {
  const walk = (n: XmlNode): XmlNode | null => {
    if (n.path === path) return n;
    for (const c of n.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
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
