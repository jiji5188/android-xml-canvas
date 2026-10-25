// lib/xml/resolve.ts — 把 XmlNode 上的属性引用（@string/@dimen/@color/?attr）展开成具体值
// 返回每个属性一份「已解析」映射；解析不到走内置兜底 + issue 提示。

import type { XmlNode, XmlIssue, ResourceTable } from "./types";
import { parseDimenToDp } from "./resources";

export type ResolvedAttrs = Record<string, string | number | boolean | SizeSpec | null>;

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

/** 颜色解析：#hex / @color/xxx / ?attr/xxx / 命名色（白/黑/transparent） */
export function resolveColor(raw: string, res: ResourceTable, issues: XmlIssue[], path: string, prop: string): string {
  const v = raw.trim();
  if (v === "" || v === "@null") return "transparent";
  if (v.startsWith("#")) return v;
  if (v.startsWith("@color/")) {
    const name = v.slice("@color/".length);
    const c = res.colors[name];
    if (c !== undefined) return c;
    issues.push({ level: "warn", nodePath: path, message: `${prop} 引用 @color/${name} 未定义，用兜底色` });
    return "#888888";
  }
  if (v.startsWith("?attr/")) {
    const name = v.slice("?attr/".length);
    const c = res.colors[name]; // 主题属性名与 color 名同名时命中默认主题表
    if (c !== undefined) return c;
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

/**
 * 解析某节点的全部「关心属性」成 ResolvedAttrs
 * 返回键：width/height/weight/gravity/margin 四边/padding 四边/background/text/textSize/textColor/src/visibility 等
 */
export function resolveNodeAttrs(node: XmlNode, res: ResourceTable): { attrs: ResolvedAttrs; issues: XmlIssue[] } {
  const issues: XmlIssue[] = [];
  const path = node.path;
  const a = node.attrs; // 已归一化（无前缀）
  const out: ResolvedAttrs = {};

  // 尺寸
  out["width"] = a["layout_width"] !== undefined ? resolveSize(a["layout_width"], res, issues, path, "layout_width") : null;
  out["height"] = a["layout_height"] !== undefined ? resolveSize(a["layout_height"], res, issues, path, "layout_height") : null;

  // weight
  out["weight"] = a["layout_weight"] ? parseFloat(a["layout_weight"]) || 0 : 0;

  // gravity / layout_gravity
  out["gravity"] = a["gravity"] ?? "";
  out["layoutGravity"] = a["layout_gravity"] ?? "";

  // 四角 margin/padding（支持简写 padding="16dp" 展开四边；Start/End 是 RTL 语义，映射到 Left/Right）
  const expandQuad = (key: string): number[] => {
    const single = a[key];
    const toDp = (raw?: string, prop?: string): number => {
      if (raw === undefined || raw === "") return 0;
      const s = resolveSize(raw, res, issues, path, prop ?? key);
      return s.kind === "zero" ? 0 : s.kind === "dp" ? s.value : s.kind === "px" ? s.value : 0;
    };
    const top = toDp(a[key + "Top"], key + "Top");
    const bottom = toDp(a[key + "Bottom"], key + "Bottom");
    // right = layout_marginRight 或 layout_marginEnd；left = layout_marginLeft 或 layout_marginStart
    const rightRaw = a[key + "Right"] ?? a[key + "End"];
    const leftRaw = a[key + "Left"] ?? a[key + "Start"];
    const right = toDp(rightRaw, (rightRaw !== undefined ? key : key) + "Right");
    const left = toDp(leftRaw, key + "Left");
    if (a[key + "Top"] !== undefined || rightRaw !== undefined || a[key + "Bottom"] !== undefined || leftRaw !== undefined) {
      return [top, right, bottom, left];
    }
    const s = toDp(single, key);
    return [s, s, s, s];
  };
  const pad = expandQuad("padding");
  out["paddingT"] = pad[0]; out["paddingR"] = pad[1]; out["paddingB"] = pad[2]; out["paddingL"] = pad[3];
  const mar = expandQuad("layout_margin");
  out["marginT"] = mar[0]; out["marginR"] = mar[1]; out["marginB"] = mar[2]; out["marginL"] = mar[3];

  // 颜色
  out["background"] = a["background"] !== undefined ? resolveColor(a["background"], res, issues, path, "background") : "";

  // 文本
  out["text"] = a["text"] !== undefined ? resolveText(a["text"], res, issues, path) : "";
  out["textSize"] = a["textSize"] !== undefined ? (resolveSize(a["textSize"], res, issues, path, "textSize").kind as string === "dp" ? (resolveSize(a["textSize"], res, issues, path, "textSize") as { kind: "dp"; value: number }).value : 14) : 0;
  out["textColor"] = a["textColor"] !== undefined ? resolveColor(a["textColor"], res, issues, path, "textColor") : "";
  out["textStyle"] = a["textStyle"] ?? "";
  out["textAllCaps"] = a["textAllCaps"] === "true";
  out["textAlignment"] = a["textAlignment"] ?? "";
  out["hint"] = a["hint"] !== undefined ? resolveText(a["hint"], res, issues, path) : "";

  // 图片
  out["src"] = a["src"] ?? "";

  // 可见性 / 可用性
  out["visibility"] = a["visibility"] ?? "visible";
  out["enabled"] = a["enabled"] !== "false";

  // 宽高比（ImageView）
  out["adjustViewBounds"] = a["adjustViewBounds"] === "true";

  // 进度条样式
  out["progressStyle"] = a["style"] ?? "";

  // 圆角 / 阴影（elevation）
  out["elevation"] = a["elevation"] !== undefined ? resolveSize(a["elevation"], res, issues, path, "elevation") : null;
  out["radius"] = a["radius"] !== undefined ? (resolveSize(a["radius"], res, issues, path, "radius").kind as string === "dp" ? (resolveSize(a["radius"], res, issues, path, "radius") as { kind: "dp"; value: number }).value : 0) : 0;

  // id（回写定位用）
  out["id"] = a["id"] ?? "";

  // min 宽高
  out["minWidth"] = a["minWidth"] !== undefined ? (resolveSize(a["minWidth"], res, issues, path, "minWidth").kind as string === "dp" ? (resolveSize(a["minWidth"], res, issues, path, "minWidth") as { kind: "dp"; value: number }).value : 0) : 0;
  out["minHeight"] = a["minHeight"] !== undefined ? (resolveSize(a["minHeight"], res, issues, path, "minHeight").kind as string === "dp" ? (resolveSize(a["minHeight"], res, issues, path, "minHeight") as { kind: "dp"; value: number }).value : 0) : 0;

  // LinearLayout 专用
  out["orientation"] = a["orientation"] ?? "vertical";

  return { attrs: out, issues };
}
