// lib/xml/constraints.ts — M2b：ConstraintLayout 四向约束基础求解
// 纯函数，不碰 React/DOM。输出单位：CSS px（已乘 scale）。
//
// 支持范围（见 PROJECT.md §10）：
// - 锚点 "parent" 或同层兄弟（@+id/xxx / @id/xxx / 裸 id）
// - 8 种边组合：Start_toStartOf / Start_toEndOf / End_toStartOf / End_toEndOf
//               Top_toTopOf / Top_toBottomOf / Bottom_toTopOf / Bottom_toBottomOf
// - layout_width/height = 0dp（match constraints）/ wrap_content / dp / match_parent
// - layout_constraintHorizontal_bias / Vertical_bias（默认 0.5）
// - layout_margin* 生效（layout_margin 作为兜底，分边优先）
// - Guideline、chainStyle、嵌套链求解：本期不做（M2c）

import type { XmlNode, ResourceTable, XmlIssue } from "./types";
import { resolveSize } from "./resolve";

export interface ConstraintBox {
  left: number;   // CSS px
  top: number;
  width: number;
  height: number;
}

export interface SolveResult {
  boxes: Map<string, ConstraintBox>;  // key = 子项 path
  issues: XmlIssue[];
}

/** @+id/xxx / @id/xxx → xxx；其它原样返回 */
function cleanId(v: string): string {
  if (!v.startsWith("@")) return v;
  const m = v.match(/^@\+?id\/(.+)$/);
  return m ? m[1] : "";
}

/** 一条约束引用：指向目标节点的哪条边 */
interface AnchorRef {
  id: string;
  /** true = 目标的后/右缘；false = 目标的前/左缘 */
  toEnd: boolean;
}

/**
 * 读取某个方向边的约束。同名边优先（Start_toStartOf 先于 Start_toEndOf）。
 * 返回 undefined 表示未约束（属性缺失或 "0"）。
 */
function readAnchor(
  a: Record<string, string>,
  side: "Start" | "End" | "Top" | "Bottom",
): AnchorRef | undefined {
  const pairs: [string, boolean][] =
    side === "Start"
      ? [["layout_constraintStart_toStartOf", false], ["layout_constraintStart_toEndOf", true]]
      : side === "End"
        ? [["layout_constraintEnd_toEndOf", true], ["layout_constraintEnd_toStartOf", false]]
        : side === "Top"
          ? [["layout_constraintTop_toTopOf", false], ["layout_constraintTop_toBottomOf", true]]
          : [["layout_constraintBottom_toBottomOf", true], ["layout_constraintBottom_toTopOf", false]];

  for (const [key, toEnd] of pairs) {
    const raw = a[key];
    if (raw === undefined || raw === "") continue;
    const id = cleanId(raw);
    if (id === "" || id === "0") continue; // "0" = 显式不约束
    return { id, toEnd };
  }
  return undefined;
}

/** wrap_content 估尺寸（dp；见 PROJECT.md §10） */
export function estSize(node: XmlNode): { w: number; h: number } {
  const tag = node.tag.includes(".") ? node.tag.slice(node.tag.lastIndexOf(".") + 1) : node.tag;
  switch (tag) {
    case "TextView":
    case "Button":
    case "EditText":
    case "AppCompatTextView":
    case "AppCompatButton":
    case "AppCompatEditText":
    case "MaterialButton":
    case "TextInputEditText":
      return { w: 120, h: 40 };
    case "ImageView":
    case "ImageButton":
      return { w: 48, h: 48 };
    case "Switch":
    case "SwitchCompat":
    case "CheckBox":
    case "RadioButton":
      return { w: 48, h: 32 };
    case "SeekBar":
      return { w: 160, h: 32 };
    case "ProgressBar":
      return { w: 160, h: 24 };
    default:
      return { w: 120, h: 48 };
  }
}

type DimKind = "zero" | "wrap" | "match" | "dp";

/** 子项某方向的尺寸（dp 或 CSS px 由 resolveSize 决定） */
function dimDp(
  node: XmlNode,
  which: "width" | "height",
  res: ResourceTable,
  issues: XmlIssue[],
  path: string,
): { kind: DimKind; value: number; unit: "dp" | "px" } {
  const raw = node.attrs[which === "width" ? "layout_width" : "layout_height"];
  const est = estSize(node);
  if (raw === undefined) {
    return { kind: "wrap", value: which === "width" ? est.w : est.h, unit: "dp" };
  }
  const spec = resolveSize(raw, res, issues, path, which);
  switch (spec.kind) {
    case "zero":
      return { kind: "zero", value: 0, unit: "dp" };
    case "match":
      return { kind: "match", value: 0, unit: "dp" };
    case "wrap":
      return { kind: "wrap", value: which === "width" ? est.w : est.h, unit: "dp" };
    default:
      return { kind: "dp", value: spec.value ?? 0, unit: spec.kind === "px" ? "px" : "dp" };
  }
}

/**
 * 对一个 ConstraintLayout 的直接子项求解。
 * @param parent  ConstraintLayout 节点
 * @param parentContentW/H  父内容区尺寸（CSS px）
 */
export function solveConstraintChildren(
  parent: XmlNode,
  res: ResourceTable,
  parentContentW: number,
  parentContentH: number,
): SolveResult {
  const out: SolveResult = { boxes: new Map(), issues: [] };
  const children = parent.children;
  const SCALE = 2; // 1dp = 2px，与画布默认一致
  const toPx = (v: number, unit: "dp" | "px") => (unit === "px" ? v : v * SCALE);

  // id → 节点
  const byId = new Map<string, XmlNode>();
  for (const c of children) {
    const id = c.attrs["id"];
    if (!id) continue;
    const cid = cleanId(id);
    if (cid) byId.set(cid, c);
  }

  // 第一遍：估尺寸
  const dims = new Map<string, { w: number; h: number; kindW: DimKind; kindH: DimKind; unitW: "dp" | "px"; unitH: "dp" | "px" }>();
  for (const c of children) {
    const wSpec = dimDp(c, "width", res, out.issues, c.path);
    const hSpec = dimDp(c, "height", res, out.issues, c.path);
    dims.set(c.path, {
      w: wSpec.value,
      h: hSpec.value,
      kindW: wSpec.kind,
      kindH: hSpec.kind,
      unitW: wSpec.unit,
      unitH: hSpec.unit,
    });
  }

  const boxCache = new Map<string, ConstraintBox>();
  const visiting = new Set<string>();

  const positionOf = (c: XmlNode): ConstraintBox => {
    const cached = boxCache.get(c.path);
    if (cached) return cached;

    const a = c.attrs;
    const d = dims.get(c.path)!;

    const marginPx = (key: string, fallback?: string): number => {
      const raw = a[key] ?? (fallback ? a[fallback] : undefined) ?? a["layout_margin"];
      if (raw === undefined || raw === "") return 0;
      const spec = resolveSize(raw, res, out.issues, c.path, "margin");
      if (spec.kind === "dp") return (spec.value ?? 0) * SCALE;
      if (spec.kind === "px") return spec.value ?? 0;
      return 0;
    };
    const mT = marginPx("layout_marginTop");
    const mB = marginPx("layout_marginBottom");
    const mS = marginPx("layout_marginStart", "layout_marginLeft");
    const mE = marginPx("layout_marginEnd", "layout_marginRight");

    const hStart = readAnchor(a, "Start");
    const hEnd = readAnchor(a, "End");
    const vTop = readAnchor(a, "Top");
    const vBottom = readAnchor(a, "Bottom");

    const biasOf = (raw: string | undefined): number => {
      const n = parseFloat(raw ?? "");
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
    };
    const hBias = biasOf(a["layout_constraintHorizontal_bias"]);
    const vBias = biasOf(a["layout_constraintVertical_bias"]);

    /** 解析一条水平约束 → 目标边的 CSS px 坐标 */
    const resolveH = (ref: AnchorRef | undefined): number => {
      if (ref === undefined) return 0;
      if (ref.id === "parent" || ref.id === "0") return ref.toEnd ? parentContentW : 0;
      const target = byId.get(ref.id);
      if (!target) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 未找到，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentW : 0;
      }
      if (visiting.has(target.path)) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 存在循环引用，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentW : 0;
      }
      visiting.add(c.path);
      const tb = positionOf(target);
      visiting.delete(c.path);
      return ref.toEnd ? tb.left + tb.width : tb.left;
    };

    /** 解析一条垂直约束 → 目标边的 CSS px 坐标 */
    const resolveV = (ref: AnchorRef | undefined): number => {
      if (ref === undefined) return 0;
      if (ref.id === "parent" || ref.id === "0") return ref.toEnd ? parentContentH : 0;
      const target = byId.get(ref.id);
      if (!target) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 未找到，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentH : 0;
      }
      if (visiting.has(target.path)) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 存在循环引用，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentH : 0;
      }
      visiting.add(c.path);
      const tb = positionOf(target);
      visiting.delete(c.path);
      return ref.toEnd ? tb.top + tb.height : tb.top;
    };

    const startX = hStart ? resolveH(hStart) : 0;
    const endX = hEnd ? resolveH(hEnd) : parentContentW;
    const topY = vTop ? resolveV(vTop) : 0;
    const bottomY = vBottom ? resolveV(vBottom) : parentContentH;

    // 尺寸
    let w = toPx(d.w, d.unitW);
    let h = toPx(d.h, d.unitH);
    const spanW = Math.max(endX - startX - mS - mE, 0);
    const spanH = Math.max(bottomY - topY - mT - mB, 0);
    if (d.kindW === "match" || d.kindW === "zero") {
      if (hStart || hEnd) w = spanW;
    }
    if (d.kindH === "match" || d.kindH === "zero") {
      if (vTop || vBottom) h = spanH;
    }

    // 位置
    let left: number;
    if (hStart && hEnd) {
      const free = Math.max(endX - startX - mS - mE - w, 0);
      left = startX + mS + hBias * free;
    } else if (hStart) {
      left = startX + mS;
    } else if (hEnd) {
      left = endX - mE - w;
    } else {
      left = 0;
    }

    let top: number;
    if (vTop && vBottom) {
      const free = Math.max(bottomY - topY - mT - mB - h, 0);
      top = topY + mT + vBias * free;
    } else if (vTop) {
      top = topY + mT;
    } else if (vBottom) {
      top = bottomY - mB - h;
    } else {
      top = 0;
    }

    const box: ConstraintBox = {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(w),
      height: Math.round(h),
    };
    boxCache.set(c.path, box);
    return box;
  };

  for (const c of children) {
    out.boxes.set(c.path, positionOf(c));
  }
  return out;
}
