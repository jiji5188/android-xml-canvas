// lib/xml/code-zoom.ts — M442：代码编辑框「双指捏合缩放」的纯计算（可单测）
//
// 用户要求：代码编辑器框支持缩放手势（双指捏合），且**不影响页面框架**——
// 只缩放代码编辑框内的文字（fontSize），不缩放整个 APK 页面。
// 这里只管「两指距离 → 字号缩放」的数学，DOM 监听在 components/CodeEditor.tsx。

/** 代码框允许的字号范围（px）：太小看不清，太大撑出框 */
export const CODE_ZOOM_MIN = 10;
export const CODE_ZOOM_MAX = 24;
/** 初始字号（与 cmTheme 的 --axv-code-font-size 默认一致） */
export const CODE_ZOOM_INIT = 13;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** 两点距离（客户端坐标） */
export function pointerDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * 双指捏合的字号：`startFont * (curDist / startDist)`，夹到 [CODE_ZOOM_MIN, CODE_ZOOM_MAX]。
 * curDist < startDist（两指合拢）→ 字号变小；反之变大。
 */
export function zoomFromPinch(startFont: number, startDist: number, curDist: number): number {
  if (startDist <= 0) return startFont;
  const ratio = curDist / startDist;
  return clamp(Math.round(startFont * ratio * 100) / 100, CODE_ZOOM_MIN, CODE_ZOOM_MAX);
}
