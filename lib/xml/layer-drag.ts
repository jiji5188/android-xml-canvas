// lib/xml/layer-drag.ts — M31j：图层树拖拽的纯逻辑（不含 DOM 交互）
//
// 为什么不用 HTML5 drag&drop：Android WebView 里触摸**根本不会触发** dragstart，
// 所以手机上「拖拽调整层级」一直是死的。改成 pointer 事件后鼠标和手指走同一套逻辑。
//
// 这里只放可单测的部分：启动阈值、落点判定、父子关系判断。

export type DropZone = "before" | "inside" | "after";

/** 移动超过这个距离才算「拖」，避免点一下就被当成拖动 */
export const DRAG_SLOP = 8;
/** 手指按住多久之后移动才启动拖拽（否则算滑动列表） */
export const TOUCH_HOLD_MS = 220;

/** 应当启动拖拽了吗 */
export function shouldStartDrag(args: {
  pointerType: string;
  dx: number;
  dy: number;
  elapsedMs: number;
}): boolean {
  const dist = Math.hypot(args.dx, args.dy);
  if (dist < DRAG_SLOP) return false;
  if (args.pointerType === "mouse") return true;
  return args.elapsedMs >= TOUCH_HOLD_MS;
}

/** 行内相对位置 → 落点：上下 1/4 是换兄弟，容器中间 1/2 是放进子项 */
export function zoneAt(clientY: number, top: number, height: number, isContainer: boolean): DropZone {
  if (height <= 0) return "after";
  const y = (clientY - top) / height;
  if (!isContainer) return y < 0.5 ? "before" : "after";
  if (y < 0.25) return "before";
  if (y > 0.75) return "after";
  return "inside";
}

/** child 是否是 ancestor 的后代（含自身） */
export function isSelfOrDescendant(child: string, ancestor: string): boolean {
  const a = ancestor.split("/");
  const c = child.split("/");
  if (c.length < a.length) return false;
  return a.every((seg, i) => seg === c[i]);
}

/** 落点是否合法：不能拖到自己身上，也不能拖进自己的子树 */
export function canDropOn(fromPath: string, targetPath: string): boolean {
  if (!fromPath || !targetPath) return false;
  if (fromPath === targetPath) return false;
  return !isSelfOrDescendant(targetPath, fromPath);
}

/** 拖拽时列表边缘的自动滚动量（px），不在边缘返回 0 */
export function autoScrollDelta(clientY: number, top: number, bottom: number, edge = 36): number {
  if (clientY < top + edge) return -Math.round(edge - (clientY - top));
  if (clientY > bottom - edge) return Math.round(edge - (bottom - clientY));
  return 0;
}
