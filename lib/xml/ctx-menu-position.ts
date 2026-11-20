// lib/xml/ctx-menu-position.ts — M441：代码编辑器的复制/粘贴菜单定位（纯函数）
//
// 用户要求：菜单上下偏移，不要挡住「当前行」。
// 规则：
//   ① 优先放当前行上方（贴行顶 - gap）——不遮行
//   ② 上方放不下 → 放当前行下方（贴行底 + gap）
//   ③ 两边都放不下 → 选空间大的一边，再夹到容器内（可能压边，但尽量离当前行远）
// 坐标全是「容器内相对坐标」，不碰 DOM，可单测。

export interface CtxLineBox {
  /** 当前行顶边 y（相对容器） */
  top: number;
  /** 当前行底边 y（相对容器） */
  bottom: number;
}

export interface CtxMenuPlacement {
  top: number;
  side: "above" | "below";
}

/** 估算菜单高度：容器 padding 上下 4+4，每项 padding 8+8 + 行高 ~19 ≈ 35，项间 gap 2 */
export const CTX_ITEM_H = 35;
export const CTX_PAD_Y = 8;

export function estimateCtxMenuHeight(itemCount: number): number {
  return Math.max(CTX_ITEM_H, itemCount * CTX_ITEM_H) + CTX_PAD_Y;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/** 算菜单纵坐标（横坐标由调用方按指针 x 夹取） */
export function placeCtxMenu(
  line: CtxLineBox,
  menuHeight: number,
  containerHeight: number,
  opts: { gap?: number; margin?: number } = {},
): CtxMenuPlacement {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 4;
  const spaceAbove = line.top - gap - margin;
  const spaceBelow = containerHeight - line.bottom - gap - margin;

  let side: "above" | "below";
  if (spaceAbove >= menuHeight) side = "above";
  else if (spaceBelow >= menuHeight) side = "below";
  else side = spaceAbove >= spaceBelow ? "above" : "below";

  let top = side === "above" ? line.top - gap - menuHeight : line.bottom + gap;
  top = clamp(top, margin, Math.max(margin, containerHeight - margin - menuHeight));
  return { top, side };
}
