// components/use-outside-pointerdown.ts
// M437：点面板外关闭浮层（通用）。
// 用于：代码编辑器长按菜单（M437）、以及任何需要「点外面就销毁但不干扰点击本身」的浮层。
//
// 语义（用户 2026-11-20 明确要求的两点）：
//   1. 点 ref 指向 DOM 之外 → onOutside() 回调（调用方通常 setXxx(null) 销毁浮层）；
//   2. 不 preventDefault / 不 stopPropagation —— 这一次 pointerdown 照常落到目标上：
//      点在编辑器里就正常移动光标，不影响输入。
// 捕获阶段（capture=true）挂在 document：比目标自己的处理器更早判定，
// 但因为我们不拦截事件，目标处理器随后照常被调用。

import { useEffect, type RefObject } from "react";

/** enabled=true 时监听 document pointerdown（捕获）：点在 ref 外 → onOutside()。
 *  ref 内不触发（调用方通常还会在浮层上 stopPropagation，双保险）。
 *  enabled=false 不挂监听（浮层未渲染时零开销）。 */
export function useOutsidePointerdown(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: PointerEvent) => {
      const el = ref.current;
      const t = e.target as Node | null;
      if (el && t && el.contains(t)) return;
      onOutside();
    };
    document.addEventListener("pointerdown", h, true);
    return () => document.removeEventListener("pointerdown", h, true);
  }, [enabled, ref, onOutside]);
}
