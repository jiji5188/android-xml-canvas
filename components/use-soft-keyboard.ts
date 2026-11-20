// components/use-soft-keyboard.ts
// M438b：软键盘（输入法）是否弹出 —— 通用检测钩子。
// 用户 2026-11-20 需求：APK 里弹出输入法时，① 代码编辑器下方日志抽屉自动收起，
// ② 悬浮的错误说明面板（hover tooltip / 问题卡片 / 长按菜单 / 文档浮层）一并隐藏，
// 避免键盘把浮层顶到屏幕中间挡视线。
//
// 两条检测路互补（Android 不同 windowSoftInputMode 行为不同）：
//   ① visualViewport.resize：键盘把视口顶起来时 vv.height 比 innerHeight 小（adjustResize 生效时最准）
//   ② document focusin：焦点落到 INPUT/TEXTAREA/contenteditable（键盘弹起必然伴随输入焦点；
//      adjustPan 不缩视口时也能拦到）。CodeMirror 是 contenteditable，输入时 focusin 必中。
//
// 语义：「键盘可能弹起」时返回 true；键盘收起（vv 恢复）或焦点离开输入控件时自动回 false。
// 只在原生壳（APK）里用 —— 调用方用 nativeAvailable() 做门槛，web 浏览器永不启用，零开销。

import { useEffect, useRef, useState } from "react";

/** 视口缩水阈值（px）：键盘弹起一般 >200px；横滚条/地址栏等小幅变化 <80px，取 120 中间值。 */
const KB_VIEWPORT_DROP_PX = 120;

/** @returns 软键盘是否弹出（检测中）。enabled=false 恒 false 且不挂任何监听。 */
export function useSoftKeyboard(enabled: boolean): boolean {
  const [vv, setVv] = useState(false);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVv(false);
      setFocus(false);
      return;
    }
    let vvFired = false;
    const vvObj = window.visualViewport;
    const onVvResize = () => {
      const v = window.visualViewport;
      if (!v) return;
      const firing = window.innerHeight - v.height >= KB_VIEWPORT_DROP_PX;
      if (firing !== vvFired) {
        vvFired = firing;
        setVv(firing);
      }
    };
    if (vvObj) {
      vvObj.addEventListener("resize", onVvResize);
      // 挂载时立即算一次（页面加载时键盘已弹的场景）
      onVvResize();
    }
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      setFocus(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.hasAttribute("contenteditable"));
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      vvObj?.removeEventListener("resize", onVvResize);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled]);

  return vv || focus;
}
