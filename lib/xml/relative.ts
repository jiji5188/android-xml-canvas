// lib/xml/relative.ts — M2p：RelativeLayout 定位规则求解
// 纯函数，不碰 React/DOM。输出单位：CSS px（已乘 scale）。
//
// 为什么单独写：RelativeLayout 的位置不是 flex 流，也不是约束（bias/chain），
// 而是一堆「相对兄弟/父容器的规则」。CSS 没有对应能力（除 alignParent 可以靠
// absolute 的 left/right 硬凑），所以按 Android 语义在 JS 里解出盒子。
//
// 支持范围（PROJECT.md §10 同步）：
// - alignParentStart/Left/End/Right/Top/Bottom、centerInParent/centerHorizontal/centerVertical
// - toStartOf/toLeftOf/toEndOf/toRightOf、above/below（可叠加 margin）
// - alignStart/alignLeft/alignEnd/alignRight/alignTop/alignBottom（对齐兄弟的边）
// - layout_width/height: dp / px / match_parent / wrap_content（wrap 用 estSize 估）
// - layout_margin / marginStart/End/Top/Bottom（含简写兜底）
// - 引用缺失的兄弟 → 回落 parent（等价 alignWithParentIfMissing 的宽松版）
// - 循环引用 → 断开并回落 parent + 记 warn
// - layoutDirection 只按 LTR 处理（Start=Left、End=Right）

import type { XmlNode, ResourceTable, XmlIssue } from "./types";
import { resolveSize } from "./resolve";
import { estSize, type MeasuredMap } from "./constraints";

export interface RelBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** M2t：该轴是 wrap_content（渲染时用 auto，让浏览器算真实内容尺寸） */
  wrapW?: boolean;
  wrapH?: boolean;
}

export interface RelSolveResult {
  boxes: Map<string, RelBox>;
  issues: XmlIssue[];
}

const SCALE = 2; // 1dp = 2px，与画布默认一致

function shortTag(raw: string): string {
  return raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
}

function cleanId(v: unknown): string {
  if (v === undefined || v === null) return "";
  let s = String(v).trim();
  if (s.startsWith("@+id/")) s = s.slice(5);
  else if (s.startsWith("@id/")) s = s.slice(4);
  return s;
}

/** 取属性（true 形式的布尔属性返回 true，字符串返回字符串） */
function flag(attrs: Record<string, unknown>, key: string): boolean {
  const v = attrs[key];
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "1";
}

function str(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

/** 某个方向上的子项尺寸（px） */
function dim(
  node: XmlNode,
  which: "width" | "height",
  res: ResourceTable,
  issues: XmlIssue[],
  path: string,
  parentContent: number,
  margins: { start: number; end: number },
  measured?: MeasuredMap,
): number {
  const key = which === "width" ? "layout_width" : "layout_height";
  const raw = node.attrs[key];
  const est = estSize(node);
  const estVal = which === "width" ? est.w : est.h;
  const meas = measured?.get(path);
  const wrapVal = meas ? (which === "width" ? meas.w : meas.h) : estVal * SCALE;
  if (raw === undefined) return wrapVal;
  const spec = resolveSize(raw, res, issues, path, which);
  switch (spec.kind) {
    case "match":
      // match_parent：扣掉左右/上下 margin（Android 语义）
      return Math.max(0, parentContent - margins.start - margins.end);
    case "wrap":
      return wrapVal;
    case "zero":
      return 0;
    default:
      return spec.kind === "px" ? (spec.value ?? 0) : (spec.value ?? 0) * SCALE;
  }
}

/** M2t：节点某方向是否为 wrap_content（未写尺寸属性也当 wrap，与 dim() 口径一致） */
function isWrapDim(node: XmlNode, which: "width" | "height"): boolean {
  const raw = node.attrs[which === "width" ? "layout_width" : "layout_height"];
  if (raw === undefined) return true;
  const v = String(raw).trim();
  return v === "wrap_content" || v === "wrap";
}

/** 读单边 margin（px）：分边优先，layout_margin 兜底 */
function marginPx(node: XmlNode, side: "start" | "end" | "top" | "bottom", res: ResourceTable): number {
  const a = node.attrs;
  const pick = (k: string): number | null => {
    const v = a[k];
    if (v === undefined || v === null) return null;
    const spec = resolveSize(v, res, [], "#", "margin");
    if (spec.kind === "dp") return (spec.value ?? 0) * SCALE;
    if (spec.kind === "px") return spec.value ?? 0;
    return null;
  };
  const sideKeys: Record<string, string[]> = {
    start: ["layout_marginStart", "layout_marginLeft"],
    end: ["layout_marginEnd", "layout_marginRight"],
    top: ["layout_marginTop"],
    bottom: ["layout_marginBottom"],
  };
  for (const k of sideKeys[side]) {
    const v = pick(k);
    if (v !== null) return v;
  }
  for (const k of ["layout_margin", "margin"]) {
    const v = pick(k);
    if (v !== null) return v;
  }
  return 0;
}

/**
 * 对一个 RelativeLayout 的直接子项求解。
 * @param parent RelativeLayout 节点
 * @param parentContentW/H 父内容区尺寸（CSS px）
 */
export function solveRelativeChildren(
  parent: XmlNode,
  res: ResourceTable,
  parentContentW: number,
  parentContentH: number,
  /** M2t：wrap 实测尺寸表（可选，浏览器 DOM 回填） */
  measured?: MeasuredMap,
): RelSolveResult {
  const issues: XmlIssue[] = [];
  const boxes = new Map<string, RelBox>();
  const children = parent.children;

  // id → 兄弟（只含直接子项，Android 的 RelativeLayout 也只能引用同层兄弟）
  const byId = new Map<string, XmlNode>();
  for (const c of children) {
    const id = cleanId(c.attrs["id"]);
    if (id) byId.set(id, c);
  }

  // 先按尺寸算好 w/h，再解位置（位置依赖兄弟的 w/h）
  const sizeOf = new Map<string, { w: number; h: number }>();
  for (const c of children) {
    const m = {
      start: marginPx(c, "start", res),
      end: marginPx(c, "end", res),
      top: marginPx(c, "top", res),
      bottom: marginPx(c, "bottom", res),
    };
    sizeOf.set(c.path, {
      w: dim(c, "width", res, issues, c.path, parentContentW, m, measured),
      h: dim(c, "height", res, issues, c.path, parentContentH, m, measured),
    });
  }

  const visiting = new Set<string>();

  /** 解一个子项的盒子；引用兄弟时递归（带环检测） */
  const solve = (node: XmlNode): RelBox => {
    const cached = boxes.get(node.path);
    if (cached) return cached;
    const a = node.attrs;
    const { w, h } = sizeOf.get(node.path) ?? { w: 0, h: 0 };
    const ms = marginPx(node, "start", res);    const me = marginPx(node, "end", res);
    const mt = marginPx(node, "top", res);
    const mb = marginPx(node, "bottom", res);

    const centerH = flag(a, "layout_centerHorizontal") || flag(a, "layout_centerInParent");
    const centerV = flag(a, "layout_centerVertical") || flag(a, "layout_centerInParent");

    /** 兄弟盒子（缺失 → parent 尺寸的虚拟盒子） */
    const sib = (idRaw: string): RelBox | null => {
      const id = cleanId(idRaw);
      if (!id) return null;
      if (id === "parent" || id === "") return { left: 0, top: 0, width: parentContentW, height: parentContentH };
      const t = byId.get(id);
      if (!t || t.path === node.path) return null;
      if (visiting.has(t.path)) {
        issues.push({
          level: "warn",
          nodePath: node.path,
          message: `RelativeLayout 循环引用（${id}），已回落 parent 定位`,
        });
        return null;
      }
      visiting.add(node.path);
      const b = solve(t);
      visiting.delete(node.path);
      return b;
    };

    // ===== 水平 =====
    let left: number | null = null;
    if (flag(a, "layout_alignParentStart") || flag(a, "layout_alignParentLeft")) {
      left = ms;
    } else if (flag(a, "layout_alignParentEnd") || flag(a, "layout_alignParentRight")) {
      left = parentContentW - w - me;
    } else if (centerH) {
      left = Math.round((parentContentW - w) / 2);
    } else {
      const toEnd = str(a, "layout_toEndOf") || str(a, "layout_toRightOf");
      const toStart = str(a, "layout_toStartOf") || str(a, "layout_toLeftOf");
      const alStart = str(a, "layout_alignStart") || str(a, "layout_alignLeft");
      const alEnd = str(a, "layout_alignEnd") || str(a, "layout_alignRight");
      if (toEnd) {
        const b = sib(toEnd);
        left = (b ? b.left + b.width : 0) + ms;
      } else if (toStart) {
        const b = sib(toStart);
        left = b ? b.left - w - me : ms;
      } else if (alStart) {
        const b = sib(alStart);
        left = (b ? b.left : 0) + ms;
      } else if (alEnd) {
        const b = sib(alEnd);
        left = b ? b.left + b.width - w - me : parentContentW - w - me;
      } else {
        left = ms;
      }
    }

    // ===== 垂直 =====
    let top: number | null = null;
    if (flag(a, "layout_alignParentTop")) {
      top = mt;
    } else if (flag(a, "layout_alignParentBottom")) {
      top = parentContentH - h - mb;
    } else if (centerV) {
      top = Math.round((parentContentH - h) / 2);
    } else {
      const below = str(a, "layout_below");
      const above = str(a, "layout_above");
      const alTop = str(a, "layout_alignTop");
      const alBottom = str(a, "layout_alignBottom");
      if (below) {
        const b = sib(below);
        top = (b ? b.top + b.height : 0) + mt;
      } else if (above) {
        const b = sib(above);
        top = b ? b.top - h - mb : mt;
      } else if (alTop) {
        const b = sib(alTop);
        top = (b ? b.top : 0) + mt;
      } else if (alBottom) {
        const b = sib(alBottom);
        top = b ? b.top + b.height - h - mb : parentContentH - h - mb;
      } else {
        top = mt;
      }
    }

    const box: RelBox = {
      left: left ?? 0,
      top: top ?? 0,
      width: w,
      height: h,
      wrapW: isWrapDim(node, "width"),
      wrapH: isWrapDim(node, "height"),
    };
    boxes.set(node.path, box);
    return box;
  };

  for (const c of children) solve(c);
  return { boxes, issues };
}
