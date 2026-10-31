// lib/xml/suggest-position.ts — M45：关键词检索弹窗的定位计算（纯函数）
//
// 规则（用户指定）：
//   - x 轴：跟随光标 x（左边缘 = 光标左边缘）；右侧空间不足 → 右边缘对齐光标 x
//   - y 轴：吸在光标行的下方；下方空间不够 → 翻到光标行上方；
//     上下文只看「光标行在视口的位置 + 弹窗高度」，两边都不够就贴空间大的那边并限高
//
// 坐标全部是「容器内相对坐标」，不碰 DOM，方便单测。

export interface CaretBox {
  /** 光标左边缘 x（相对容器） */
  left: number;
  /** 光标右边缘 x（相对容器），用于「右侧不够时右对齐」 */
  right: number;
  /** 光标所在行顶边 y（相对容器） */
  top: number;
  /** 光标所在行底边 y（相对容器） */
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** 弹在下方还是上方 */
  placement: "below" | "above";
  /** 实际可用高度（放不下时用来滚） */
  maxHeight: number;
  /** x 对齐方式：follow=左边缘跟光标；right-align=右边缘对齐光标 x */
  align: "follow" | "right";
}

const DEFAULT_GAP = 4;
const DEFAULT_MARGIN = 4;

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/** 算弹窗位置 */
export function placeSuggest(
  caret: CaretBox,
  popup: Size,
  container: Size,
  opts: { gap?: number; margin?: number } = {},
): Placement {
  const gap = opts.gap ?? DEFAULT_GAP;
  const margin = opts.margin ?? DEFAULT_MARGIN;

  const spaceBelow = container.height - caret.bottom - gap - margin;
  const spaceAbove = caret.top - gap - margin;
  const need = popup.height;

  let placement: "below" | "above";
  let top: number;
  let maxHeight: number;

  if (spaceBelow >= need) {
    placement = "below";
    top = caret.bottom + gap;
    maxHeight = need;
  } else if (spaceAbove >= need) {
    placement = "above";
    top = caret.top - gap - need;
    maxHeight = need;
  } else if (spaceBelow >= spaceAbove) {
    placement = "below";
    top = caret.bottom + gap;
    maxHeight = Math.max(0, spaceBelow);
  } else {
    placement = "above";
    maxHeight = Math.max(0, spaceAbove);
    top = caret.top - gap - Math.min(need, maxHeight);
  }

  // 弹窗自身高度上限（estimate 已封顶，但调用方可能传更大的值）
  maxHeight = Math.min(maxHeight, SUG_MAX_H);

  // 垂直兜底：不越界
  top = clamp(top, margin, Math.max(margin, container.height - margin - Math.min(need, maxHeight)));

  // x 轴：
  // ① 左侧空间够（caret.left + 弹窗宽 ≤ 容器右边界）→ 左边缘跟光标
  // ② 不够 → 右边缘对齐光标 x（caret.right），不越容器左边界
  const followLeft = caret.left;
  const followOk = followLeft + popup.width <= container.width - margin;

  let align: "follow" | "right";
  let left: number;
  if (followOk) {
    align = "follow";
    left = clamp(followLeft, margin, Math.max(margin, container.width - margin - popup.width));
  } else {
    // 右边缘 = caret.right（光标右边缘），即弹窗左边 = caret.right - 弹窗宽
    align = "right";
    left = clamp(caret.right - popup.width, margin, Math.max(margin, container.width - margin - popup.width));
  }

  return { left, top, placement, maxHeight, align };
}

/** 估算弹窗尺寸：一行 26px + 上下 padding 8 */
export const SUG_ITEM_H = 26;
export const SUG_PAD_Y = 8;
export const SUG_MIN_W = 180;
export const SUG_MAX_W = 320;
/** 用户指定：弹窗最大高度 320px（超出滚） */
export const SUG_MAX_H = 320;

export function estimateSuggestSize(items: string[]): Size {
  const widest = items.reduce((m, s) => Math.max(m, s.length), 0);
  const width = clamp(SUG_MIN_W, SUG_MIN_W, SUG_MAX_W);
  const byText = Math.round(widest * 7.4 + 28);
  const rawH = Math.max(SUG_ITEM_H, items.length * SUG_ITEM_H) + SUG_PAD_Y;
  return {
    width: Math.min(SUG_MAX_W, Math.max(width, byText)),
    height: Math.min(rawH, SUG_MAX_H),
  };
}
