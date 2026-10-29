// lib/xml/resolve.ts — 把 XmlNode 上的属性引用（@string/@dimen/@color/?attr）展开成具体值
// 返回每个属性一份「已解析」映射；解析不到走内置兜底 + issue 提示。

import type { XmlNode, XmlIssue, ResourceTable } from "./types";
import { parseDimenToDp, FRAMEWORK_COLORS, FRAMEWORK_STYLES } from "./resources";
import { parseShapeDrawable } from "./shape";
import { vectorToDataUrl } from "./vector-svg";

export type ResolvedAttrs = Record<string, string | number | boolean | SizeSpec | null | import("./shape").ShapeStyle>;

/** 尺寸类属性解析：match_parent/wrap_content/0dp/具体值/引用 */
export type SizeSpec =
  | { kind: "match" }
  | { kind: "wrap" }
  | { kind: "zero" }      // 0dp（配 weight 用）
  | { kind: "dp"; value: number }
  | { kind: "px"; value: number };

export function resolveSize(raw: string, res: ResourceTable, issues: XmlIssue[], path: string, prop: string): SizeSpec {
  const v = raw.trim();
  if (v === "match_parent" || v === "fill_parent") return { kind: "match" };
  if (v === "wrap_content") return { kind: "wrap" };
  if (v === "0dp" || v === "0dip" || v === "0") return { kind: "zero" };
  if (v.startsWith("@dimen/")) {
    const name = v.slice("@dimen/".length);
    const n = res.dimens[name];
    if (n === undefined) {
      issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 @dimen/${name} 未定义，按 0dp 兜底` });
      return { kind: "zero" };
    }
    return { kind: "dp", value: n };
  }
  if (v.startsWith("@")) {
    issues.push({ level: "warn", nodePath: path, message: `${prop} 尺寸引用 @ 无法解析（${v}），按 0dp 兜底` });
    return { kind: "zero" };
  }
  const n = parseDimenToDp(v);
  if (!Number.isFinite(n)) {
    issues.push({ level: "warn", nodePath: path, message: `${prop} 尺寸 "${v}" 无法解析，按 0dp 兜底` });
    return { kind: "zero" };
  }
  return { kind: "dp", value: n };
}

/** 颜色解析：#hex / @color/xxx / @android:color/xxx / ?attr/xxx / 命名色（白/黑/transparent） */
// ===== Android ARGB → CSS 颜色 =====
// Android 8 位 hex 是 #AARRGGBB，CSS 8 位 hex 是 #RRGGBBAA
function argbToCss(hex: string): string {
  const m = hex.match(/^#([0-9a-fA-F]{8})$/);
  if (!m) return hex;
  const arrgb = m[1];
  const a = arrgb.slice(0, 2);
  const rr = arrgb.slice(2, 4);
  const gg = arrgb.slice(4, 6);
  const bb = arrgb.slice(6, 8);
  if (a === "FF") return `#${rr}${gg}${bb}`; // 不透明：丢 alpha
  if (a === "00") return "transparent";
  const alpha = Math.round(parseInt(a, 16) / 255 * 100) / 100;
  const num = parseInt(rr, 16), g = parseInt(gg, 16), b = parseInt(bb, 16);
  return `rgba(${num}, ${g}, ${b}, ${alpha})`;
}

export function resolveColor(raw: string, res: ResourceTable, issues: XmlIssue[], path: string, prop: string): string {
  const v = raw.trim();
  if (v === "" || v === "@null") return "transparent";
  if (v.startsWith("#")) return argbToCss(v);
  if (v.startsWith("@android:color/")) {
    const name = v.slice("@android:color/".length);
    const c = FRAMEWORK_COLORS[name];
    if (c !== undefined) return c;
    issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 @android:color/${name} 未收录，用兜底色` });
    return "#888888";
  }
  if (v.startsWith("@color/")) {
    const name = v.slice("@color/".length);
    const c = res.colors[name];
    // M4v：颜色表里存的是项目原值（很多项目写 #AARRGGBB）——必须转成 CSS，
    // 否则浏览器把 8 位当 #RRGGBBAA，#FF212121 会变成半透明红
    if (c !== undefined) return argbToCss(c);
    issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 @color/${name} 未定义，用兜底色` });
    return "#888888";
  }
  if (v.startsWith("?attr/")) {
    const name = v.slice("?attr/".length);
    // M2x：上传的主题（styles.xml 里 Theme* 的 item）最优先——相当于运行时主题注入
    const themeV = res.themeAttrs?.[name];
    if (themeV !== undefined) {
      if (themeV.startsWith("@color/") || themeV.startsWith("#")) return resolveColor(themeV, res, issues, path, prop);
      if (themeV.startsWith("?attr/")) return themeV; // 嵌套引用不再深入，保持原样交给 CSS
      issues.push({ level: "warn", nodePath: path, message: `?attr/${name} 主题值 "${themeV}" 无法解析，用兜底色` });
      return "#888888";
    }
    const c = res.colors[name]; // 主题属性名与 color 名同名时命中颜色表
    if (c !== undefined) return argbToCss(c);
    // 常见 Material3 主题属性→默认色（未上传 styles 时的预览兜底）
    const themeAttrs: Record<string, string> = {
      colorPrimary: "#6750A4",
      colorOnPrimary: "#FFFFFF",
      colorPrimaryContainer: "#EADDFF",
      colorOnPrimaryContainer: "#21005D",
      colorSecondary: "#625B71",
      colorOnSecondary: "#FFFFFF",
      colorOnBackground: "#1D1B20",
      colorOnSurface: "#1D1B20",
      colorSurface: "#FEF7FF",
      colorBackground: "#FEF7FF",
      colorError: "#B3261E",
      textColorPrimary: "#1D1B20",
      textColorSecondary: "#49454F",
    };
    if (themeAttrs[name] !== undefined) return themeAttrs[name];
    issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 ?attr/${name} 未定义，用兜底色` });
    return "#888888";
  }
  if (v.startsWith("?")) {
    issues.push({ level: "warn", nodePath: path, message: `${prop} 主题引用 ${v} 未展开，用兜底色` });
    return "#888888";
  }
  if (v.startsWith("@")) {
    issues.push({ level: "warn", nodePath: path, message: `${prop} 颜色引用 ${v} 无法解析，用兜底色` });
    return "#888888";
  }
  // 命名色
  const named: Record<string, string> = {
    white: "#FFFFFF", black: "#000000", red: "#FF0000", green: "#00FF00", blue: "#0000FF",
    transparent: "transparent", gray: "#808080",
  };
  if (named[v.toLowerCase()] !== undefined) return named[v.toLowerCase()];
  issues.push({ level: "warn", nodePath: path, message: `${prop} 颜色 "${v}" 无法解析，用兜底色` });
  return "#888888";
}

/** 文本解析：字面量 / @string/xxx / 兜底 */
export function resolveText(raw: string, res: ResourceTable, issues: XmlIssue[], path: string): string {
  const v = raw.trim();
  if (v === "") return "";
  if (v.startsWith("@string/")) {
    const name = v.slice("@string/".length);
    const s = res.strings[name];
    if (s !== undefined) return s;
    issues.push({ level: "warn", nodePath: path, message: `text 引用 @string/${name} 未定义，原样显示` });
    return v;
  }
  if (v.startsWith("@")) {
    issues.push({ level: "warn", nodePath: path, message: `text 的 @ 引用 ${v} 无法解析，原样显示` });
    return v;
  }
  return v;
}

/** 把 @style/xxx、textAppearance 展开并入节点属性（显式属性优先，Android 语义） */
function applyStyleRefs(
  base: XmlNode["attrs"],
  res: ResourceTable,
  issues: XmlIssue[],
  path: string,
): XmlNode["attrs"] {
  const out: Record<string, string> = { ...base };
  const refs = [out["style"], out["textAppearance"]].filter(Boolean);
  for (const rawRef of refs) {
    const ref = String(rawRef).trim();
    if (!ref) continue;
    let name: string;
    if (ref.startsWith("@android:style/")) {
      name = ref.slice("@android:style/".length);
    } else if (ref.startsWith("@style/")) {
      name = ref.slice("@style/".length);
    } else if (ref.startsWith("?")) {
      // ?attr/textAppearance* 等——预览阶段不展开，静默
      continue;
    } else {
      continue;
    }
    const st = res.styles?.[name] ?? FRAMEWORK_STYLES[name];
    if (!st) {
      if (ref.startsWith("@style/")) {
        issues.push({ level: "warn", nodePath: path, message: `style 引用 @style/${name} 未定义，忽略` });
      }
      continue;
    }
    for (const [k, v] of Object.entries(st.attrs)) {
      const key = k.replace(/^(android:|app:)/, "");
      if (out[key] === undefined) out[key] = v; // 显式属性优先于 style
    }
  }
  return out;
}

/**
 * 解析某节点的全部「关心属性」成 ResolvedAttrs
 * 返回键：width/height/weight/gravity/margin 四边/padding 四边/background/text/textSize/textColor/src/visibility 等
 */
export function resolveNodeAttrs(node: XmlNode, res: ResourceTable): { attrs: ResolvedAttrs; issues: XmlIssue[] } {
  const issues: XmlIssue[] = [];
  const path = node.path;
  // @style/xxx + textAppearance 展开（显式属性优先）
  const a = applyStyleRefs(node.attrs, res, issues, path);
  const out: ResolvedAttrs = {};

  // 尺寸
  out["width"] = a["layout_width"] !== undefined ? resolveSize(a["layout_width"], res, issues, path, "layout_width") : null;
  out["height"] = a["layout_height"] !== undefined ? resolveSize(a["layout_height"], res, issues, path, "layout_height") : null;

  // weight
  out["weight"] = a["layout_weight"] ? parseFloat(a["layout_weight"]) || 0 : 0;

  // gravity / layout_gravity
  out["gravity"] = a["gravity"] ?? "";
  out["layoutGravity"] = a["layout_gravity"] ?? "";

  // M2v：GridLayout 定位（layout_column/layout_row 是 0 基；-1 = 未指定，由 CSS 自动流式排）
  out["gridColumn"] = a["layout_column"] !== undefined ? parseInt(a["layout_column"], 10) : -1;
  out["gridRow"] = a["layout_row"] !== undefined ? parseInt(a["layout_row"], 10) : -1;
  out["gridColumnSpan"] = parseInt(a["layout_columnSpan"] ?? "", 10) || 1;
  out["gridRowSpan"] = parseInt(a["layout_rowSpan"] ?? "", 10) || 1;
  out["gridColumnWeight"] = parseFloat(a["layout_columnWeight"] ?? "") || 0;
  out["columnCount"] = parseInt(a["columnCount"] ?? "", 10) || 0;

  // 四角 margin/padding（支持简写 padding="16dp" 展开四边；Start/End 是 RTL 语义，映射到 Left/Right）
  // Android 语义：简写值先铺四边，单独属性只覆盖自己那一边。
  // （旧实现：只要存在任何一个单独边就直接返回四边值，其余边变 0 → 会出现左右不对称）
  const expandQuad = (key: string): number[] => {
    const single = a[key];
    const toDp = (raw?: string, prop?: string): number => {
      if (raw === undefined || raw === "") return 0;
      const s = resolveSize(raw, res, issues, path, prop ?? key);
      return s.kind === "zero" ? 0 : s.kind === "dp" ? s.value : s.kind === "px" ? s.value : 0;
    };
    // 简写值作为每边兜底（没写单独边时用它）
    const shallow = toDp(single, key);
    const pick = (raw: string | undefined, prop: string): number =>
      raw === undefined || raw === "" ? shallow : toDp(raw, prop);
    const top = pick(a[key + "Top"], key + "Top");
    const bottom = pick(a[key + "Bottom"], key + "Bottom");
    // right = layout_marginRight 或 layout_marginEnd；left = layout_marginLeft 或 layout_marginStart
    const rightRaw = a[key + "Right"] ?? a[key + "End"];
    const leftRaw = a[key + "Left"] ?? a[key + "Start"];
    const right = pick(rightRaw, key + "Right");
    const left = pick(leftRaw, key + "Left");
    return [top, right, bottom, left];
  };
  const pad = expandQuad("padding");
  out["paddingT"] = pad[0]; out["paddingR"] = pad[1]; out["paddingB"] = pad[2]; out["paddingL"] = pad[3];
  const mar = expandQuad("layout_margin");
  out["marginT"] = mar[0]; out["marginR"] = mar[1]; out["marginB"] = mar[2]; out["marginL"] = mar[3];

  // 颜色
  // background 可能是：纯色 / @color / ?attr / **@drawable 引用**（shape xml 、vector、位图）。
  // M4i：@drawable 引用不能当颜色解析 —— 以前 resolveColor 会报「无法解析」并回成 #888888，
  //       于是 "background=@drawable/bg_btn" 的画布背景是灰色，而不是那个 shape 的填色。
  const bgRaw = a["background"] ?? "";
  const bgIsDrawable = /^@(drawable|mipmap)\//.test(bgRaw);
  out["background"] = bgRaw === "" ? "" : bgIsDrawable ? "" : resolveColor(bgRaw, res, issues, path, "background");
  /** 位图 form 的 background（dataURL） */
  out["bgImage"] = "";
  /** vector xml 形式的 background（画布用 vectorToDataUrl 转成 dataURL） */
  out["bgVector"] = "";

  // M2w：background="@drawable/bg_xxx" 且上传的 res 里有 <shape> xml → 还原渐变/圆角/描边
  out["bgShape"] = null;
  if (bgIsDrawable && res.drawableXml) {
    const nm = bgRaw.replace(/^@(?:drawable|mipmap)\//, "");
    const src = res.drawableXml[nm] ?? res.drawableXml[nm.replace(/\.xml$/i, "")];
    if (src) {
      out["bgShape"] = parseShapeDrawable(src, (raw) => resolveColor(raw, res, issues, path, "background"));
    }
  }
  // 不是 shape 的 drawable：位图 dataURL / vector xml
  if (bgIsDrawable && !out["bgShape"]) {
    const nm = bgRaw.replace(/^@(?:drawable|mipmap)\//, "");
    const key = nm.replace(/\.\w+$/, "");
    const url = res.drawables?.[nm] ?? res.drawables?.[key];
    if (url) {
      out["bgImage"] = url;
    } else {
      const xml = res.drawableXml?.[nm] ?? res.drawableXml?.[key];
      if (xml && /<vector/.test(xml)) out["bgVector"] = xml;
      else issues.push({ level: "warn", nodePath: path, message: `background 引用 ${bgRaw} 未找到（可上传 res/ 目录）` });
    }
  }

  // 文本
  out["text"] = a["text"] !== undefined ? resolveText(a["text"], res, issues, path) : "";
  out["textSize"] = a["textSize"] !== undefined ? (resolveSize(a["textSize"], res, issues, path, "textSize").kind as string === "dp" ? (resolveSize(a["textSize"], res, issues, path, "textSize") as { kind: "dp"; value: number }).value : 14) : 0;
  out["textColor"] = a["textColor"] !== undefined ? resolveColor(a["textColor"], res, issues, path, "textColor") : "";
  // M4q：API 28+ 阴影颜色（elevation 的露色控制；不写则用系统默认黑）
  out["outlineSpotShadowColor"] =
    a["outlineSpotShadowColor"] !== undefined
      ? resolveColor(a["outlineSpotShadowColor"], res, issues, path, "outlineSpotShadowColor")
      : "";
  out["outlineAmbientShadowColor"] =
    a["outlineAmbientShadowColor"] !== undefined
      ? resolveColor(a["outlineAmbientShadowColor"], res, issues, path, "outlineAmbientShadowColor")
      : "";
  out["tint"] = a["tint"] !== undefined ? resolveColor(a["tint"], res, issues, path, "tint") : "";
  out["textStyle"] = a["textStyle"] ?? "";
  out["textAllCaps"] = a["textAllCaps"] === "true";
  // M4r：文字阴影（android:shadowColor/Dx/Dy/Radius，与 elevation 阴影是两回事）
  out["shadowColor"] =
    a["shadowColor"] !== undefined ? resolveColor(a["shadowColor"], res, issues, path, "shadowColor") : "";
  for (const k of ["shadowDx", "shadowDy", "shadowRadius"] as const) {
    if (a[k] === undefined) {
      out[k] = 0;
      continue;
    }
    const s = resolveSize(a[k], res, issues, path, k);
    out[k] = s.kind === "dp" ? s.value : 0;
  }
  out["textAlignment"] = a["textAlignment"] ?? "";
  out["hint"] = a["hint"] !== undefined ? resolveText(a["hint"], res, issues, path) : "";

  // 图片：@drawable/xxx / @mipmap/xxx 优先查上传的 res 目录，查不到再原样
  out["src"] = resolveDrawable(a["src"] ?? a["srcCompat"] ?? "", res, issues, path, "src");
  out["scaleType"] = a["scaleType"] ?? "";
  // M5a：tintMode（缺省 src_in）——不在白名单里 css 层永远拿不到
  out["tintMode"] = a["tintMode"] ?? "";

  // 可见性 / 可用性
  out["visibility"] = a["visibility"] ?? "visible";
  out["enabled"] = a["enabled"] !== "false";

  // 宽高比（ImageView）
  out["adjustViewBounds"] = a["adjustViewBounds"] === "true";

  // 进度条样式
  out["progressStyle"] = a["style"] ?? "";

  // 宽高比 / 百分比（CL 与 ImageView 用；求解器读 dimensionRatio / percent）
  out["dimensionRatio"] = a["layout_constraintDimensionRatio"] ?? "";
  out["widthPercent"] = a["layout_constraintWidth_percent"]
    ? parseFloat(a["layout_constraintWidth_percent"]) || 0
    : 0;
  out["heightPercent"] = a["layout_constraintHeight_percent"]
    ? parseFloat(a["layout_constraintHeight_percent"]) || 0
    : 0;

  // 文字排版细节
  out["letterSpacing"] = a["letterSpacing"] !== undefined ? parseFloat(a["letterSpacing"]) || 0 : 0;
  out["lineSpacingExtra"] =
    a["lineSpacingExtra"] !== undefined
      ? resolveSize(a["lineSpacingExtra"], res, issues, path, "lineSpacingExtra").kind === "dp"
        ? (resolveSize(a["lineSpacingExtra"], res, issues, path, "lineSpacingExtra") as { kind: "dp"; value: number }).value
        : 0
      : 0;
  out["maxLines"] = a["maxLines"] !== undefined ? parseInt(a["maxLines"], 10) || 0 : 0;
  out["ellipsize"] = a["ellipsize"] ?? "";

  // ===== 组合图标（drawableLeft / Start / Top / Right / End / Bottom）=====
  const dl = a["drawableStart"] ?? a["drawableLeft"]; // RTL: Start 优先
  const dr = a["drawableEnd"] ?? a["drawableRight"];
  out["drawableStart"] = dl !== undefined ? resolveDrawable(dl, res, issues, path, "drawableStart") : "";
  out["drawableEnd"] = dr !== undefined ? resolveDrawable(dr, res, issues, path, "drawableEnd") : "";
  out["drawableTop"] =
    a["drawableTop"] !== undefined ? resolveDrawable(a["drawableTop"], res, issues, path, "drawableTop") : "";
  out["drawableBottom"] =
    a["drawableBottom"] !== undefined ? resolveDrawable(a["drawableBottom"], res, issues, path, "drawableBottom") : "";
  out["drawablePadding"] =
    a["drawablePadding"] !== undefined
      ? (() => {
          const s = resolveSize(a["drawablePadding"], res, issues, path, "drawablePadding");
          return s.kind === "dp" ? s.value : s.kind === "px" ? s.value : 0;
        })()
      : 0;

  // ===== 变换（rotation / scale / alpha / translation）=====
  const numAttr = (k: string, def: number): number => {
    if (a[k] === undefined || a[k] === "") return def;
    const f = parseFloat(a[k]);
    return Number.isFinite(f) ? f : def;
  };
  out["rotation"] = numAttr("rotation", 0);
  out["rotationX"] = numAttr("rotationX", 0);
  out["rotationY"] = numAttr("rotationY", 0);
  out["scaleX"] = numAttr("scaleX", 1);
  out["scaleY"] = numAttr("scaleY", 1);
  out["alpha"] = numAttr("alpha", 1);
  const dimToDp = (k: string): number => {
    if (a[k] === undefined) return 0;
    const s = resolveSize(a[k], res, issues, path, k);
    return s.kind === "dp" ? s.value : s.kind === "px" ? s.value : 0;
  };
  out["translationX"] = dimToDp("translationX");
  out["translationY"] = dimToDp("translationY");
  out["pivotX"] = a["pivotX"] ?? "50%";
  out["pivotY"] = a["pivotY"] ?? "50%";

  // ===== 前景 / 着色（tint）=====
  out["foreground"] =
    a["foreground"] !== undefined ? resolveDrawable(a["foreground"], res, issues, path, "foreground") : "";
  out["backgroundTint"] =
    a["backgroundTint"] !== undefined ? resolveColor(a["backgroundTint"], res, issues, path, "backgroundTint") : "";
  out["tint"] = a["tint"] !== undefined ? resolveColor(a["tint"], res, issues, path, "tint") : "";

  // ===== ViewStub =====
  out["layout"] = a["layout"] ?? "";
  out["inflatedId"] = a["inflatedId"] ?? "";

  // 圆角 / 阴影（elevation）
  out["elevation"] = a["elevation"] !== undefined ? resolveSize(a["elevation"], res, issues, path, "elevation") : null;
  // M3e：translationZ 参与 Z 轴堆叠（Android 的 Z = elevation + translationZ）
  out["translationZ"] =
    a["translationZ"] !== undefined ? resolveSize(a["translationZ"], res, issues, path, "translationZ") : null;
  out["radius"] = a["radius"] !== undefined ? (resolveSize(a["radius"], res, issues, path, "radius").kind as string === "dp" ? (resolveSize(a["radius"], res, issues, path, "radius") as { kind: "dp"; value: number }).value : 0) : 0;

  // id（回写定位用）
  out["id"] = a["id"] ?? "";

  // min 宽高
  out["minWidth"] = a["minWidth"] !== undefined ? (resolveSize(a["minWidth"], res, issues, path, "minWidth").kind as string === "dp" ? (resolveSize(a["minWidth"], res, issues, path, "minWidth") as { kind: "dp"; value: number }).value : 0) : 0;
  out["minHeight"] = a["minHeight"] !== undefined ? (resolveSize(a["minHeight"], res, issues, path, "minHeight").kind as string === "dp" ? (resolveSize(a["minHeight"], res, issues, path, "minHeight") as { kind: "dp"; value: number }).value : 0) : 0;

  // LinearLayout 专用
  out["orientation"] = a["orientation"] ?? "vertical";

  // M2a：复合控件占位所需
  out["checked"] = a["checked"] === "true";
  out["progress"] = a["progress"] !== undefined ? parseFloat(a["progress"]) || 0 : 0;
  out["max"] = a["max"] !== undefined ? parseFloat(a["max"]) || 100 : 100;
  out["cardCornerRadius"] = a["cardCornerRadius"] !== undefined ? (resolveSize(a["cardCornerRadius"], res, issues, path, "cardCornerRadius").kind as string === "dp" ? (resolveSize(a["cardCornerRadius"], res, issues, path, "cardCornerRadius") as { kind: "dp"; value: number }).value : 0) : 0;

  // ===== M11t：补齐此前「只解析不渲染 / 完全没解析」的一批属性 =====
  const dpNum = (name: string) => {
    if (a[name] === undefined) return 0;
    const s = resolveSize(a[name], res, issues, path, name);
    return s.kind === "dp" || s.kind === "px" ? (s.value as number) : 0;
  };
  out["maxWidth"] = dpNum("maxWidth");
  out["maxHeight"] = dpNum("maxHeight");
  // RatingBar
  out["numStars"] = a["numStars"] !== undefined ? Math.max(1, parseInt(a["numStars"], 10) || 5) : 5;
  out["rating"] = a["rating"] !== undefined ? parseFloat(a["rating"]) || 0 : 0;
  out["stepSize"] = a["stepSize"] !== undefined ? parseFloat(a["stepSize"]) || 0.5 : 0.5;
  out["isIndicator"] = a["isIndicator"] === "true";
  // ProgressBar
  out["secondaryProgress"] = a["secondaryProgress"] !== undefined ? parseFloat(a["secondaryProgress"]) || 0 : 0;
  out["indeterminate"] = a["indeterminate"] === "true";
  // 染色（Button/CheckBox/RadioButton 的 buttonTint、SeekBar/Switch 的 thumbTint/trackTint）
  out["buttonTint"] = a["buttonTint"] !== undefined ? resolveColor(a["buttonTint"], res, issues, path, "buttonTint") : "";
  out["thumbTint"] = a["thumbTint"] !== undefined ? resolveColor(a["thumbTint"], res, issues, path, "thumbTint") : "";
  out["trackTint"] = a["trackTint"] !== undefined ? resolveColor(a["trackTint"], res, issues, path, "trackTint") : "";
  out["progressTint"] = a["progressTint"] !== undefined ? resolveColor(a["progressTint"], res, issues, path, "progressTint") : "";
  out["indeterminateTint"] = a["indeterminateTint"] !== undefined ? resolveColor(a["indeterminateTint"], res, issues, path, "indeterminateTint") : "";
  // 文本：hint 颜色 / 单行 / 最少行数
  out["textColorHint"] = a["textColorHint"] !== undefined ? resolveColor(a["textColorHint"], res, issues, path, "textColorHint") : "";
  out["singleLine"] = a["singleLine"] === "true";
  out["minLines"] = a["minLines"] !== undefined ? parseInt(a["minLines"], 10) || 0 : 0;
  // CardView
  out["cardBackgroundColor"] = a["cardBackgroundColor"] !== undefined ? resolveColor(a["cardBackgroundColor"], res, issues, path, "cardBackgroundColor") : "";
  out["cardElevation"] = dpNum("cardElevation");

  return { attrs: out, issues };
}


/** 图片引用解析：@drawable/x、@mipmap/x 查 res.drawables（上传的 res/ 目录），找不到原样保留（画布显示占位） */
export function resolveDrawable(
  raw: string,
  res: ResourceTable,
  issues: import("./types").XmlIssue[],
  path: string,
  prop: string,
): string {
  const v = raw.trim();
  if (v === "") return "";
  // M4v：@android:drawable/xxx 是平台内置图标（不在项目 res 里），
  // 不当作“找不到”报错；给中性占位，避免登录页之类满屏红框
  if (/^@android:(drawable|mipmap)\//.test(v)) {
    return "builtin:" + v.replace(/^@android:(drawable|mipmap)\//, "");
  }
  const m = v.match(/^@(drawable|mipmap)\/(.+)$/);
  if (m) {
    const [, kind, name] = m;
    const url = res.drawables?.[name] ?? res.drawables?.[name.replace(/\.\w+$/, "")];
    if (url) return url;
    // M4p：上传的 vector xml（@drawable/ic_xxx）直接转成 data URL，画布能真画出来
    const vxml = res.drawableXml?.[name] ?? res.drawableXml?.[name.replace(/\.xml$/i, "")];
    if (vxml && /<vector[\s>]/.test(vxml)) {
      const du = vectorToDataUrl(vxml);
      if (du) return du;
    }
    // 矢量名单里（vector xml）标记为占位
    if (res.vectorNames?.includes(name)) {
      issues.push({ level: "warn", nodePath: path, message: `${prop} 引用矢量 @${kind}/${name}，按占位渲染` });
      return "vector:" + name;
    }
    issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 @${kind}/${name} 未找到（可上传 res/ 目录），按占位显示` });
    return "missing:" + kind + "/" + name;
  }
  // @color 当背景用（如 src 少见）或直连 dataURL/普通值
  return v;
}
