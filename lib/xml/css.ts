// lib/xml/css.ts — Android 布局语义 → CSS 映射（M1 核心引擎）
// 把「已解析」的树转成 React 可直接用的 style 对象树。
// 单位：画布 scale 默认 1dp=2px（可通过 scale 参数调）。

import type { XmlNode, ResourceTable, RenderModel, ResolvedNode } from "./types";
import { resolveNodeAttrs, resolveSize } from "./resolve";
import type { ResolvedAttrs } from "./resolve";
import { solveConstraintChildren } from "./constraints";
import { solveRelativeChildren } from "./relative";
import { SCREEN_DP, phoneBodyDp } from "./theme";

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
    case "ViewStub":
      return "axv-viewstub";
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

  /** isRoot：根布局在窗口里总是填满内容区，它的 layout_margin 在 Android 里也不会
   *  产生「缩进」，但会让人误以为填充不满（拖动根节点留下的残值就属于这种）。
   *  预览忽略根节点 margin，保证 match_parent 的根一定贴边填满预览框。 */
  const resolveAll = (node: XmlNode, isRoot = false): ResolvedNode => {
    const { attrs, issues: nIssues } = resolveNodeAttrs(node, res);
    issues.push(...nIssues);
    const style: Record<string, string | number> = {};
    const tag = shortTag(node.tag); // 全限定类名归一化

    // 容器
    const isCL = tag === "ConstraintLayout" || tag === "ConstraintSet";
    const isRL = tag === "RelativeLayout";
    // RelativeLayout：子项位置由规则求解（见 relative.ts），容器自身仍需 position:relative
    // 作为 absolute 子项的定位基准
    if (isRL) {
      style.display = "block";
      style.position = "relative";
    } else if (tag === "LinearLayout" || tag === "FrameLayout" || tag === "ScrollView" || tag === "HorizontalScrollView" || tag === "CardView" || tag === "MaterialCardView" || isCL) {
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

    // 边距（用 longhand，便于 M1b 属性面板逐边编辑 + 回写）
    // 根节点强制归零：见 resolveAll 的 isRoot 说明
    const mt = isRoot ? 0 : DP((attrs["marginT"] as number) || 0, scale);
    const mr = isRoot ? 0 : DP((attrs["marginR"] as number) || 0, scale);
    const mb = isRoot ? 0 : DP((attrs["marginB"] as number) || 0, scale);
    const ml = isRoot ? 0 : DP((attrs["marginL"] as number) || 0, scale);

    // 内边距（longhand）
    const pt = DP((attrs["paddingT"] as number) || 0, scale);
    const pr = DP((attrs["paddingR"] as number) || 0, scale);
    const pb = DP((attrs["paddingB"] as number) || 0, scale);
    const pl = DP((attrs["paddingL"] as number) || 0, scale);

    // ===== match_parent + margin：必须用 calc 扣掉，否则右侧溢出屏幕 =====
    // Android 语义：layout_width="match_parent" 的可视宽度 = 父内容宽 - 左右 margin。
    // CSS 里 `width:100%` 已经是父内容宽（父 padding 已被百分比解析扣过），而 margin 是
    // 外挂的 → 100% + margin 会超宽，所以只扣 margin。
    // ⚠ padding 不能扣：`.axv-node` 是 border-box，padding 已经在盒内，
    //   再扣一次会让盒子变窄，右侧/底部凭空出现一道间隙（根布局 match_parent 尤其明显）。
    const isMatchW = w === "100%";
    const isMatchH = h === "100%";
    let finalW = isMatchW ? "100%" : w;
    let finalH = isMatchH ? "100%" : h;
    if (isMatchW && (ml || mr)) {
      finalW = `calc(100% - ${ml + mr}px)`;
    }
    if (isMatchH && (mt || mb)) {
      finalH = `calc(100% - ${mt + mb}px)`;
    }
    // 有 padding 时显式声明 border-box（Android 的 padding 永远在盒内）
    if (pt || pr || pb || pl) style.boxSizing = "border-box";

    // 尺寸
    style.width = w === "0px" && weight === 0 ? "auto" : finalW;
    style.height = h === "0px" ? "auto" : finalH;

    if (mt) style.marginTop = `${mt}px`;
    if (mr) style.marginRight = `${mr}px`;
    if (mb) style.marginBottom = `${mb}px`;
    if (ml) style.marginLeft = `${ml}px`;

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

    // ===== 变换：rotation / scale / alpha / translation =====
    const rot = (attrs["rotation"] as number) || 0;
    const rotX = (attrs["rotationX"] as number) || 0;
    const rotY = (attrs["rotationY"] as number) || 0;
    const sx = attrs["scaleX"] !== undefined ? (attrs["scaleX"] as number) : 1;
    const sy = attrs["scaleY"] !== undefined ? (attrs["scaleY"] as number) : 1;
    const tx = (attrs["translationX"] as number) || 0;
    const ty = (attrs["translationY"] as number) || 0;
    const parts: string[] = [];
    if (tx || ty) parts.push(`translate(${DP(tx, scale)}px, ${DP(ty, scale)}px)`);
    if (rot) parts.push(`rotate(${rot}deg)`);
    if (rotX) parts.push(`rotateX(${rotX}deg)`);
    if (rotY) parts.push(`rotateY(${rotY}deg)`);
    if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
    if (parts.length > 0) {
      style.transform = parts.join(" ");
      const pv = (attrs["pivotX"] as string) || "50%";
      const pvY = (attrs["pivotY"] as string) || "50%";
      style.transformOrigin = `${pv} ${pvY}`;
    }
    const alpha = attrs["alpha"] !== undefined ? (attrs["alpha"] as number) : 1;
    if (alpha !== 1) style.opacity = alpha;

    // 前景（foreground 覆盖层，CardView / FrameLayout 常见）
    const fg = (attrs["foreground"] as string) || "";
    if (fg && fg.startsWith("data:")) {
      style.backgroundImage = `url(${fg})`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
    }

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
      // 排版细节：letterSpacing / lineSpacingExtra / maxLines / ellipsize
      const fsPx = parseFloat(String(style.fontSize ?? "28")) || 28;
      const ls = attrs["letterSpacing"] as number;
      if (ls) style.letterSpacing = `${(ls * fsPx).toFixed(2)}px`;
      const lse = attrs["lineSpacingExtra"] as number;
      if (lse) style.lineHeight = `${(fsPx * 1.2 + lse * scale).toFixed(1)}px`;
      const ml = attrs["maxLines"] as number;
      const ellip = (attrs["ellipsize"] as string) || "";
      if (ml > 0 || ellip) {
        if (ml > 0) {
          style.display = "-webkit-box";
          style.WebkitLineClamp = String(ml);
          style.overflow = "hidden";
        }
        if (ellip === "end") style.textOverflow = "ellipsis";
        else if (ellip === "start") style.textAlign = "right";
      }
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
      const src = attrs["src"] as string;
      if (src && !src.startsWith("missing:")) {
        // 真图（dataURL）或矢量占位
        if (src.startsWith("vector:")) {
          // 矢量图：虚线紫框占位（真实 vector 路径不渲染，避免误导）
          style.backgroundColor = style.backgroundColor || "#EDE7F6";
          style.border = "1.5px dashed #9575CD";
        } else {
          // dataURL 直接做 background
          style.backgroundImage = `url(${src})`;
          style.backgroundSize = "100% 100%";
          style.backgroundColor = style.backgroundColor || "transparent";
        }
      } else if (!src) {
        style.backgroundColor = style.backgroundColor || "#E0D9E3";
        style.minHeight = style.minHeight || `${DP(48, scale)}px`;
      }
      if (attrs["adjustViewBounds"]) style.aspectRatio = "1 / 1";
      // CL 里的宽高比（0dp + layout_constraintDimensionRatio 在非 CL 容器时也吃）
      const ratioRaw = (attrs["dimensionRatio"] as string) || "";
      if (ratioRaw) {
        const body = ratioRaw.includes(",") ? ratioRaw.split(",").slice(1).join(",") : ratioRaw;
        const m = body.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
        if (m && parseFloat(m[2]) > 0) style.aspectRatio = `${parseFloat(m[1])} / ${parseFloat(m[2])}`;
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

    // ViewStub：画个虚线占位框，标上将被填充的 layout 名
    if (cls === "axv-viewstub") {
      style.minHeight = `${DP(56, scale)}px`;
      style.border = "1px dashed #99C9A8";
      style.borderRadius = `${DP(4, scale)}px`;
      style.display = "flex";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.fontStyle = "italic";
      style.color = "#6B8F7B";
      style.fontSize = "12px";
      style.backgroundColor = "rgba(153,201,168,0.08)";
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
    } else if (cls === "axv-viewstub") {
      const layoutRef = (node.attrs["layout"] as string) || "";
      const layoutName = layoutRef.startsWith("@layout/") ? layoutRef.slice(8) : layoutRef;
      text = `⚡ ViewStub → @layout/${layoutName || "?"}`;
    } else if (cls === "axv-text" && !text && (attrs["hint"] as string)) {
      text = attrs["hint"] as string;
    }

    // ===== 组合图标（drawableLeft 等）：交给渲染层画 img =====
    const cdStart = (attrs["drawableStart"] as string) || "";
    const cdEnd = (attrs["drawableEnd"] as string) || "";
    const cdTop = (attrs["drawableTop"] as string) || "";
    const cdBottom = (attrs["drawableBottom"] as string) || "";
    const compound =
      cdStart || cdEnd || cdTop || cdBottom
        ? {
            start: cdStart,
            end: cdEnd,
            top: cdTop,
            bottom: cdBottom,
            gap: DP((attrs["drawablePadding"] as number) || 4, scale),
          }
        : undefined;
    if (compound && !compound.top && !compound.bottom) {
      style.flexDirection = style.flexDirection ?? "row";
      style.alignItems = "center";
    }

    const resolved: ResolvedNode = {
      tag: node.tag,
      path: node.path,
      style,
      compound,
      className: cls + (attrs["checked"] ? " axv-checked" : ""),
      text,
      issues: nIssues,
      children: node.children.map((c) => resolveAll(c)),
      rawAttrs: node.attrs,
    };
    return resolved;
  };

  const rootNode = resolveAll(root, true);

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
      // match_parent + margin/padding 会生成 calc(100% - Npx)：用 fallback 减去 N 得到真实宽
      const mCalc = s2.match(/^calc\(100%\s*-\s*([0-9.]+)px\)$/);
      if (mCalc) return Math.max(0, fallback - parseFloat(mCalc[1]));
      if (s2 === "100%" || s2 === "" || s2 === "auto") return fallback;
      const m = s2.match(/^(-?[0-9.]+)/);
      if (m && !s2.includes("%")) return parseFloat(m[1]);
      return fallback;
    };
    const cw = toPx(n.style.width, SCREEN_DP.w * scale);
    // 高度回落值 = 内容区高度（屏高 - 状态栏 - 导航栏），否则 CL 根会按整屏高算出
    // 比内容区还高的盒子 → 底部被导航栏遮住 / 溢出预览框
    const ch = toPx(n.style.height, phoneBodyDp() * scale);
    // CL 自身尺寸必须落实成 px：父级只有 min-height 时 100% 解析不出来，
    // 子项全 absolute 又撑不起来 → 容器会塔成 0 高（真 bug，会看到控件跑出屏幕）
    const wStr = String(n.style.width ?? "");
    const hStr = String(n.style.height ?? "");
    if (wStr === "100%" || wStr === "auto" || wStr === "") n.style.width = `${cw}px`;
    if (hStr === "100%" || hStr === "auto" || hStr === "") n.style.height = `${ch}px`;
    // 子项定位基准是 padding box，而 Android 是在 padding 里面排
    // → 内容区扣掉 padding，坐标加上 padding 偏移
    const padL = parseFloat(String(n.style.paddingLeft ?? "0")) || 0;
    const padT = parseFloat(String(n.style.paddingTop ?? "0")) || 0;
    const padR = parseFloat(String(n.style.paddingRight ?? "0")) || 0;
    const padB = parseFloat(String(n.style.paddingBottom ?? "0")) || 0;
    const contentW = Math.max(0, cw - padL - padR);
    const contentH = Math.max(0, ch - padT - padB);
    const sourceCL = findSourceNode(root, n.path);
    if (!sourceCL) return;
    const solved = solveConstraintChildren(sourceCL, res, contentW, contentH);
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
          child.style.left = `${padL}px`;
          child.style.top = `${padT + box.top}px`;
          child.style.width = `${contentW}px`;
          child.style.height = "2px";
        } else {
          child.style.left = `${padL + box.left}px`;
          child.style.top = `${padT}px`;
          child.style.width = "2px";
          child.style.height = `${contentH}px`;
        }
        child.style.boxSizing = "border-box";
        for (const gc of child.children) patchCL(gc);
        continue;
      }
      child.style.left = `${padL + box.left}px`;
      child.style.top = `${padT + box.top}px`;
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

  // M2p：RelativeLayout 子项规则定位（alignParent / center / toRightOf / below / alignTop …）
  const patchRL = (n: ResolvedNode): void => {
    if (shortTag(n.tag) !== "RelativeLayout") {
      for (const c of n.children) patchRL(c);
      return;
    }
    const toPx = (v: unknown, fallback: number): number => {
      const s2 = String(v ?? "");
      if (s2.endsWith("px")) return parseFloat(s2);
      const mCalc = s2.match(/^calc\(100%\s*-\s*([0-9.]+)px\)$/);
      if (mCalc) return Math.max(0, fallback - parseFloat(mCalc[1]));
      if (s2 === "100%" || s2 === "" || s2 === "auto") return fallback;
      const m = s2.match(/^(-?[0-9.]+)/);
      if (m && !s2.includes("%")) return parseFloat(m[1]);
      return fallback;
    };
    const cw = toPx(n.style.width, SCREEN_DP.w * scale);
    const ch = toPx(n.style.height, phoneBodyDp() * scale);
    // 容器自身尺寸要落实成 px：子项全 absolute 撑不起来，否则整个 RelativeLayout 塔成 0 高
    const wStr = String(n.style.width ?? "");
    const hStr = String(n.style.height ?? "");
    if (wStr === "100%" || wStr === "auto" || wStr === "") n.style.width = `${cw}px`;
    if (hStr === "100%" || hStr === "auto" || hStr === "") n.style.height = `${ch}px`;
    // 同 CL：Android 在 padding 内排子项，CSS absolute 不认 padding → 手动扣/偏移
    const padL = parseFloat(String(n.style.paddingLeft ?? "0")) || 0;
    const padT = parseFloat(String(n.style.paddingTop ?? "0")) || 0;
    const padR = parseFloat(String(n.style.paddingRight ?? "0")) || 0;
    const padB = parseFloat(String(n.style.paddingBottom ?? "0")) || 0;
    const contentW = Math.max(0, cw - padL - padR);
    const contentH = Math.max(0, ch - padT - padB);
    const sourceRL = findSourceNode(root, n.path);
    if (!sourceRL) return;
    const solved = solveRelativeChildren(sourceRL, res, contentW, contentH);
    issues.push(...solved.issues);
    for (const child of n.children) {
      const box = solved.boxes.get(child.path);
      if (!box) continue;
      child.style.position = "absolute";
      child.style.left = `${padL + box.left}px`;
      child.style.top = `${padT + box.top}px`;
      child.style.width = `${box.width}px`;
      child.style.height = `${box.height}px`;
      child.style.boxSizing = "border-box";
      // margin 已折进 left/top（与 CL 一致），否则会重复位移
      delete child.style.marginTop;
      delete child.style.marginRight;
      delete child.style.marginBottom;
      delete child.style.marginLeft;
      for (const gc of child.children) patchRL(gc);
    }
  };
  patchRL(rootNode);

  // M2d：FrameLayout 子项定位修正——absolute 子项补默认 left/top，父容器补明确宽高
  const patchFrame = (n: ResolvedNode): void => {
    const st = shortTag(n.tag);
    if (st === "FrameLayout" || st === "ScrollView" || st === "HorizontalScrollView") {
      // 父容器宽高留空时补 100%（match_parent 子项百分比需要父有确定尺寸）
      if (String(n.style.width ?? "") === "") n.style.width = "100%";
      if (String(n.style.height ?? "") === "") n.style.height = "100%";
      for (const c of n.children) {
        if (c.style.position === "absolute") {
          if (c.style.left === undefined || c.style.left === "") c.style.left = "0px";
          if (c.style.top === undefined || c.style.top === "") c.style.top = "0px";
        }
        patchFrame(c);
      }
      return;
    }
    for (const c of n.children) patchFrame(c);
  };
  patchFrame(rootNode);

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
