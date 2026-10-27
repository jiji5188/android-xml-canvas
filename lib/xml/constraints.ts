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
// - Guideline（orientation/guidelineBegin/guidelinePercent）与 Barrier（barrierDirection/constraintReference）可作锚点
// - chain 链式排布：End_toStartOf / Start_toEndOf 串联 + chainStyle spread/spread_inside/centered/packed

import type { XmlNode, ResourceTable, XmlIssue } from "./types";
import { resolveSize } from "./resolve";

export interface ConstraintBox {
  left: number;   // CSS px
  top: number;
  width: number;
  height: number;
  /** M2t：该轴是 wrap_content（渲染时用 auto，让浏览器算真实内容尺寸） */
  wrapW?: boolean;
  wrapH?: boolean;
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
    case "Guideline":
      return { w: 412, h: 1 };
    case "Barrier":
      return { w: 412, h: 1 };
    default:
      return { w: 120, h: 48 };
  }
}

type DimKind = "zero" | "wrap" | "match" | "dp";

/**
 * M2t：wrap_content 真实尺寸表（CSS px，由浏览器 DOM 实测回填）。
 * 键 = 节点 path。命中时 CL/RL 求解的 wrap 维度优先用它，不再走 estSize 估算。
 * Node（无 DOM）下传 undefined，行为不变。
 */
export type MeasuredMap = Map<string, { w: number; h: number }>;

/**
 * layout_constraintDimensionRatio → 宽/高比值（w/h）。
 * 支持 "16:9"、"W,16:9"、"H,1:1"；返回 w/h，解析失败返回 null。
 */
function parseDimensionRatio(raw: string): number | null {
  const body = raw.includes(",") ? raw.split(",").slice(1).join(",") : raw;
  const m = body.trim().match(/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (h === 0 || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return w / h;
}

/** 子项某方向的尺寸（dp 或 CSS px 由 resolveSize 决定） */
function dimDp(
  node: XmlNode,
  which: "width" | "height",
  res: ResourceTable,
  issues: XmlIssue[],
  path: string,
  measured?: MeasuredMap,
): { kind: DimKind; value: number; unit: "dp" | "px" } {
  const raw = node.attrs[which === "width" ? "layout_width" : "layout_height"];
  const est = estSize(node);
  const meas = measured?.get(path);
  const wrapPx = meas ? (which === "width" ? meas.w : meas.h) : 0;
  if (raw === undefined) {
    // 缺省当 wrap：实测值优先（px），否则估算（dp）
    return meas
      ? { kind: "wrap", value: wrapPx, unit: "px" }
      : { kind: "wrap", value: which === "width" ? est.w : est.h, unit: "dp" };
  }
  const spec = resolveSize(raw, res, issues, path, which);
  switch (spec.kind) {
    case "zero":
      return { kind: "zero", value: 0, unit: "dp" };
    case "match":
      return { kind: "match", value: 0, unit: "dp" };
    case "wrap":
      return meas
        ? { kind: "wrap", value: wrapPx, unit: "px" }
        : { kind: "wrap", value: which === "width" ? est.w : est.h, unit: "dp" };
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
  /** M2t：wrap 实测尺寸表（可选，浏览器 DOM 回填） */
  measured?: MeasuredMap,
): SolveResult {
  const out: SolveResult = { boxes: new Map(), issues: [] };
  const children = parent.children;
  const SCALE = 2; // 1dp = 2px，与画布默认一致
  const toPx = (v: number, unit: "dp" | "px") => (unit === "px" ? v : v * SCALE);

  // id → 节点（含 Guideline / Barrier，它们可作为锚点但不进 box 主求解）
  const byId = new Map<string, XmlNode>();
  for (const c of children) {
    const id = c.attrs["id"];
    if (!id) continue;
    const cid = cleanId(id);
    if (cid) byId.set(cid, c);
  }

  /** 解析一条 Guideline / Barrier 的盒子（它们自己也是节点，可被引用为锚点） */
  const specVisiting = new Set<string>();
  const specialBox = (id: string): ConstraintBox | null => {
    const n = byId.get(id);
    if (!n) return null;
    if (specVisiting.has(id)) return null; // Barrier 互引护栏
    specVisiting.add(id);
    try {
      return specialBoxInner(n);
    } finally {
      specVisiting.delete(id);
    }
  };
  const specialBoxInner = (n: XmlNode): ConstraintBox | null => {
    const st = n.tag.includes(".") ? n.tag.slice(n.tag.lastIndexOf(".") + 1) : n.tag;
    const a = n.attrs;
    const toLen = (raw: string | undefined): number => {
      if (!raw) return 0;
      const spec = resolveSize(raw, res, out.issues, n.path, st.toLowerCase());
      return spec.kind === "dp" ? (spec.value ?? 0) * SCALE : spec.kind === "px" ? (spec.value ?? 0) : 0;
    };
    if (st === "Guideline") {
      // 水平 Guideline：一条横线的 Y 位置；垂直：X 位置
      // 真实属性：android:orientation + app:layout_constraintGuide_begin/end/percent
      const orientation = (a["orientation"] ?? "vertical").toLowerCase();
      const pctRaw = a["layout_constraintGuide_percent"];
      const percent = pctRaw !== undefined ? parseFloat(pctRaw) : NaN;
      const begin = toLen(a["layout_constraintGuide_begin"]);
      const endRaw = a["layout_constraintGuide_end"];
      const fromEnd = endRaw !== undefined && endRaw !== "";
      const totalLen = orientation === "horizontal" ? parentContentH : parentContentW;
      const pos = Number.isFinite(percent)
        ? totalLen * percent
        : fromEnd
          ? totalLen - toLen(endRaw)
          : begin;
      return orientation === "horizontal"
        ? { left: 0, top: pos, width: 0, height: 0 }
        : { left: pos, top: 0, width: 0, height: 0 };
    }
    if (st === "Barrier") {
      const dir = (a["barrierDirection"] ?? "top").toLowerCase();
      // 真实属性：app:constraint_referenced_ids="id1,id2"
      const refs = (a["constraint_referenced_ids"] ?? "").split(/[\s,]+/).filter(Boolean);
      const margin = toLen(a["barrierMargin"]);
      // constraint_referenced_ids 存的是 id（如 btnA），boxCache 键是 path，需先转 path
      const members = refs
        .map((r) => {
          const n2 = byId.get(cleanId(r));
          if (!n2) return null;
          const b = boxCache.get(n2.path);
          if (b) return b;
          return specialBox(cleanId(r));
        })
        .filter(Boolean) as ConstraintBox[];
      // 若引用的子项还没解出来（循环），退回 0
      const bb: ConstraintBox = {
        left: 0,
        top: 0,
        width: parentContentW,
        height: parentContentH,
      };
      if (members.length === 0) {
        if (dir === "top") bb.top = margin;
        else if (dir === "bottom") bb.top = parentContentH - margin;
        else if (dir === "start") bb.left = margin;
        else if (dir === "end") bb.left = parentContentW - margin;
        return bb;
      }
      if (dir === "top") bb.top = Math.min(...members.map((m) => m.top)) + margin;
      else if (dir === "bottom") bb.top = Math.max(...members.map((m) => m.top + m.height)) - margin;
      else if (dir === "start") bb.left = Math.min(...members.map((m) => m.left)) + margin;
      else if (dir === "end") bb.left = Math.max(...members.map((m) => m.left + m.width)) - margin;
      return bb;
    }
    return null;
  };

  // 第一遍：估尺寸
  const dims = new Map<string, { w: number; h: number; kindW: DimKind; kindH: DimKind; unitW: "dp" | "px"; unitH: "dp" | "px" }>();
  for (const c of children) {
    const wSpec = dimDp(c, "width", res, out.issues, c.path, measured);
    const hSpec = dimDp(c, "height", res, out.issues, c.path, measured);
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
  /** 解算过程中遇到循环引用而兜底的节点：其结果不可进缓存（同节点其它轴可能已算对） */
  const degraded = new Set<string>();
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

    /** 目标是否也反向引用了本节点（= 链式互相引用，非错误环） */
    const pointsBack = (target: XmlNode, horiz: boolean): boolean => {
      const cid = cleanId(c.attrs["id"] ?? "");
      if (!cid) return false;
      const sides = horiz ? (["Start", "End"] as const) : (["Top", "Bottom"] as const);
      return sides.some((sd) => readAnchor(target.attrs, sd)?.id === cid);
    };

    /** 解析一条水平约束 → 目标边的 CSS px 坐标 */
    const resolveH = (ref: AnchorRef | undefined): number => {
      if (ref === undefined) return 0;
      if (ref.id === "parent" || ref.id === "0") return ref.toEnd ? parentContentW : 0;
      const target = byId.get(ref.id);
      if (target) {
        const st = target.tag.includes(".") ? target.tag.slice(target.tag.lastIndexOf(".") + 1) : target.tag;
        if (st === "Guideline" || st === "Barrier") {
          const sb = specialBox(ref.id);
          if (sb) return ref.toEnd ? sb.left + sb.width : sb.left;
        }
      }
      if (!target) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 未找到，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentW : 0;
      }
      if (visiting.has(target.path)) {
        if (!pointsBack(target, true)) {
          out.issues.push({
            level: "warn",
            nodePath: c.path,
            message: `约束目标 @+id/${ref.id} 存在循环引用，按 parent 兜底`,
          });
        }
        degraded.add(c.path);
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
      if (target) {
        const st = target.tag.includes(".") ? target.tag.slice(target.tag.lastIndexOf(".") + 1) : target.tag;
        if (st === "Guideline" || st === "Barrier") {
          const sb = specialBox(ref.id);
          if (sb) return ref.toEnd ? sb.top + sb.height : sb.top;
        }
      }
      if (!target) {
        out.issues.push({
          level: "warn",
          nodePath: c.path,
          message: `约束目标 @+id/${ref.id} 未找到，按 parent 兜底`,
        });
        return ref.toEnd ? parentContentH : 0;
      }
      if (visiting.has(target.path)) {
        if (!pointsBack(target, false)) {
          out.issues.push({
            level: "warn",
            nodePath: c.path,
            message: `约束目标 @+id/${ref.id} 存在循环引用，按 parent 兜底`,
          });
        }
        degraded.add(c.path);
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

    // layout_constraintWidth_percent / Height_percent：按父内容区百分比定尺寸（0..1）
    const pctW = parseFloat(a["layout_constraintWidth_percent"] ?? "");
    if (Number.isFinite(pctW) && pctW > 0) w = parentContentW * Math.min(pctW, 1);
    const pctH = parseFloat(a["layout_constraintHeight_percent"] ?? "");
    if (Number.isFinite(pctH) && pctH > 0) h = parentContentH * Math.min(pctH, 1);

    // layout_constraintDimensionRatio（"W,16:9" / "H,1:1" / "16:9"）：宽或高未定（0dp/match_constraint）时按比反推
    const ratio = parseDimensionRatio(a["layout_constraintDimensionRatio"] ?? "");
    if (ratio) {
      const hint = String(a["layout_constraintDimensionRatio"]).split(",")[0]?.trim().toUpperCase();
      // 哪一维是“未定”：0dp / match_constraint
      const wUndetermined = d.kindW === "zero" || d.kindW === "match";
      const hUndetermined = d.kindH === "zero" || d.kindH === "match";
      if (hint === "W" && hUndetermined) h = w / ratio;
      else if (hint === "H" && wUndetermined) w = h * ratio;
      else if (wUndetermined && hUndetermined) {
        // 两维都 0dp：按宽度撑满后的值反推高度（与 Android 实测行为一致）
        if (w > 0) h = w / ratio;
      } else if (wUndetermined) w = h * ratio;
      else if (hUndetermined) h = w / ratio;
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
      wrapW: d.kindW === "wrap",
      wrapH: d.kindH === "wrap",
    };
    if (degraded.has(c.path)) boxCache.delete(c.path);
    else boxCache.set(c.path, box);
    return box;
  };

  for (const c of children) {
    out.boxes.set(c.path, positionOf(c));
  }

  // M2c：链式排布（chain）。先解出每个子项的位置后，找出链并重新分配水平/垂直自由空间。
  applyChains(out, children, parentContentW, parentContentH, SCALE, toPx, boxCache, dims, res, out.issues);

  // Guideline / Barrier 的盒子不是普通布局算出来的（它们是参考线）：用 specialBox 覆写
  for (const c of children) {
    const st = c.tag.includes(".") ? c.tag.slice(c.tag.lastIndexOf(".") + 1) : c.tag;
    if (st === "Guideline" || st === "Barrier") {
      const cid = cleanId(c.attrs["id"] ?? "");
      if (cid) {
        const bb = specialBox(cid);
        if (bb) out.boxes.set(c.path, bb);
      }
    }
  }

  return out;
}

/**
 * M2c：链式排布。
 * 水平链形态：A.End_toStartOf=B 且 B.Start_toEndOf=A（首尾分别锚父容器）。
 * 支持 chainStyle：spread（默认）/ spread_inside / centered / packed。
 */
function applyChains(
  out: SolveResult,
  children: XmlNode[],
  parentW: number,
  parentH: number,
  scale: number,
  toPx: (v: number, u: "dp" | "px") => number,
  boxCache: Map<string, ConstraintBox>,
  dims: Map<string, { w: number; h: number; kindW: string; kindH: string; unitW: "dp" | "px"; unitH: "dp" | "px" }>,
  res: ResourceTable,
  issues: XmlIssue[],
): void {
  const byId = new Map<string, XmlNode>();
  for (const c of children) {
    const id = c.attrs["id"];
    if (id) byId.set(cleanId(id), c);
  }

  /** 某方向边上的锚点（读同名边优先，再读跨边） */
  const anchor = (c: XmlNode, side: "Start" | "End" | "Top" | "Bottom"): AnchorRef | undefined =>
    readAnchor(c.attrs, side);

  const rightAnchor = (c: XmlNode, horiz: boolean) => anchor(c, horiz ? "End" : "Bottom");
  const leftAnchor = (c: XmlNode, horiz: boolean) => anchor(c, horiz ? "Start" : "Top");

  /** 正向找链：c 的右端 glue 到下一个节点的左端 */
  const buildChain = (start: XmlNode, horiz: boolean): { nodes: XmlNode[]; spanEndId: string } | null => {
    const seq: XmlNode[] = [start];
    let cur = start;
    for (let i = 0; i < 32; i++) {
      const r = rightAnchor(cur, horiz);
      if (!r || r.toEnd) break; // 右端必须 glue 到别人的左端
      const next = byId.get(r.id);
      if (!next || next === start) break;
      seq.push(next);
      cur = next;
    }
    if (seq.length < 2) return null;
    // 校验相邻互指（A.End_toStartOf=B 且 B.Start_toEndOf=A）
    for (let i = 0; i < seq.length - 1; i++) {
      const aR = rightAnchor(seq[i], horiz);
      const bL = leftAnchor(seq[i + 1], horiz);
      if (!aR || aR.toEnd) return null;
      if (!bL || !bL.toEnd) return null;
      if (aR.id !== cleanId(seq[i + 1].attrs["id"] ?? "")) return null;
      if (bL.id !== cleanId(seq[i].attrs["id"] ?? "")) return null;
    }
    const lastR = rightAnchor(seq[seq.length - 1], horiz);
    const spanEndId = lastR ? lastR.id : "parent";
    return { nodes: seq, spanEndId };
  };

  const seen = new Set<string>();
  for (const c of children) {
    const st = c.tag.includes(".") ? c.tag.slice(c.tag.lastIndexOf(".") + 1) : c.tag;
    if (st === "Guideline" || st === "Barrier") continue;
    const cid = cleanId(c.attrs["id"] ?? "");
    if (!cid || seen.has(cid)) continue;

    const hStart = leftAnchor(c, true);
    const vStart = leftAnchor(c, false);
    const hOk = hStart?.id === "parent" && !hStart.toEnd;
    const vOk = vStart?.id === "parent" && !vStart.toEnd;

    // 水平、垂直都要试：先水平，链不成立再试垂直
    const candidates: boolean[] = [];
    if (hOk) candidates.push(true);
    if (vOk) candidates.push(false);
    if (candidates.length === 0) continue;

    let chain: { nodes: XmlNode[]; spanEndId: string } | null = null;
    let horiz = true;
    for (const h of candidates) {
      const r = buildChain(c, h);
      if (r && r.nodes.length >= 2) {
        chain = r;
        horiz = h;
        break;
      }
    }
    seen.add(cid);
    if (!chain) continue;
    chain.nodes.forEach((n) => seen.add(cleanId(n.attrs["id"] ?? "")));

    const styleRaw = (c.attrs[horiz ? "layout_constraintHorizontal_chainStyle" : "layout_constraintVertical_chainStyle"] ?? "spread").toLowerCase();
    const sizes = chain.nodes.map((m) => {
      const d = dims.get(m.path)!;
      return horiz ? toPx(d.w, d.unitW as "dp" | "px") : toPx(d.h, d.unitH as "dp" | "px");
    });
    const isZero = chain.nodes.map((m) => {
      const d = dims.get(m.path)!;
      return horiz ? d.kindW === "zero" : d.kindH === "zero";
    });
    const boxes = chain.nodes.map((m) => out.boxes.get(m.path)).filter(Boolean) as ConstraintBox[];
    if (boxes.length !== chain.nodes.length) continue;

    // 链内每个成员的起/止 margin（dp → px）：链排布必须把 margin 算进总量，否则会溢出
    const tag0 = chain.nodes[0].tag.includes(".") ? chain.nodes[0].tag.slice(chain.nodes[0].tag.lastIndexOf(".") + 1) : chain.nodes[0].tag;
    const dm = (raw: string | undefined): number => {
      if (!raw) return 0;
      const spec = resolveSize(raw, res, issues, tag0.toLowerCase(), "margin");
      return spec.kind === "dp" ? (spec.value ?? 0) * scale : 0;
    };
    const mStart = chain.nodes.map((m) => {
      const k = horiz ? "layout_marginStart" : "layout_marginTop";
      const alt = horiz ? "layout_marginLeft" : "layout_marginTop";
      return dm(m.attrs[k] ?? m.attrs[alt] ?? m.attrs["layout_margin"]);
    });
    const mEnd = chain.nodes.map((m) => {
      const k = horiz ? "layout_marginEnd" : "layout_marginBottom";
      const alt = horiz ? "layout_marginRight" : "layout_marginBottom";
      return dm(m.attrs[k] ?? m.attrs[alt] ?? m.attrs["layout_margin"]);
    });

    const total =
      sizes.reduce((a, b) => a + b, 0) + mStart.reduce((a, b) => a + b, 0) + mEnd.reduce((a, b) => a + b, 0);
    const endNode = chain.spanEndId === "parent" ? null : byId.get(chain.spanEndId);
    let spanStart = 0;
    let spanEnd = horiz ? parentW : parentH;
    if (endNode) {
      const b = out.boxes.get(endNode.path) ?? boxCache.get(endNode.path);
      if (b) spanEnd = horiz ? b.left : b.top;
    }
    const free = Math.max(spanEnd - spanStart - total, 0);
    void res;
    void issues;

    const put = (i: number, pos: number) => {
      if (horiz) {
        boxes[i].left = Math.round(pos);
        if (isZero[i]) boxes[i].width = Math.round(sizes[i]);
      } else {
        boxes[i].top = Math.round(pos);
        if (isZero[i]) boxes[i].height = Math.round(sizes[i]);
      }
    };

    if (styleRaw === "spread_inside") {
      // 首尾贴边，中间均分间隙
      const g = chain.nodes.length > 1 ? free / (chain.nodes.length - 1) : 0;
      let cur = spanStart + mStart[0];
      for (let i = 0; i < chain.nodes.length; i++) {
        put(i, cur);
        cur += sizes[i] + mEnd[i] + g + (mStart[i + 1] ?? 0);
      }
    } else if (styleRaw === "centered" || styleRaw === "packed" || styleRaw === "pack") {
      // 整块贴起点 / 居中，成员之间只留 margin
      let cur = spanStart + (styleRaw === "centered" ? free / 2 : 0) + mStart[0];
      for (let i = 0; i < chain.nodes.length; i++) {
        put(i, cur);
        cur += sizes[i] + mEnd[i] + (mStart[i + 1] ?? 0);
      }
    } else {
      // spread：成员全是 0dp（match constraints）时剩余空间均分进尺寸，不留额外间隙；
      // 否则按 N+1 个等距间隙排布（Android 语义）
      const allZero = isZero.every(Boolean);
      if (allZero) {
        const each = free / chain.nodes.length;
        let cur = spanStart + mStart[0];
        for (let i = 0; i < chain.nodes.length; i++) {
          if (horiz) {
            boxes[i].left = Math.round(cur);
            boxes[i].width = Math.round(each);
          } else {
            boxes[i].top = Math.round(cur);
            boxes[i].height = Math.round(each);
          }
          cur += each + mEnd[i] + (mStart[i + 1] ?? 0);
        }
      } else {
        const g = free / (chain.nodes.length + 1);
        let cur = spanStart + g + mStart[0];
        for (let i = 0; i < chain.nodes.length; i++) {
          put(i, cur);
          cur += sizes[i] + mEnd[i] + g + (mStart[i + 1] ?? 0);
        }
      }
    }
  }
}
