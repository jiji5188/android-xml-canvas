"use client";

// M78：整页浮层（图标编辑器 / 自定义形状 …）的系统返回键处理
//
// 背景：MainActivity.onBackPressed() 只判 web.canGoBack()，而 SPA 里打开浮层
// 不产生历史条目 → 手机上按返回键会直接结束 Activity，把人踢出 app。
//
// 做法：浮层挂载时 pushState 压一条「哨兵」条目，于是返回键命中 WebView 的
// goBack() → popstate → 关浮层；点页面上的返回/✕ 则主动 history.back()，
// 让两条路径收敛到同一个 popstate，不会回调两次。
import { useCallback, useEffect, useRef } from "react";

/** 哨兵条目的标记，卸载前用它确认栈顶还是我们压的那条 */
const MARK = "axvOverlay";

type OverlayState = { [MARK]?: boolean } | null;

function isMine(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as OverlayState)?.[MARK] === true;
}

/**
 * @param active 浮层是否打开（一般直接传 true，浮层是条件渲染的）
 * @param onBack 需要关闭浮层时调用（通常是父层传下来的 onClose）
 * @returns close：给页面上的返回 / ✕ 按钮用，内部优先走 history.back()
 */
export function useOverlayBack(active: boolean, onBack: () => void): () => void {
  const cbRef = useRef(onBack);
  cbRef.current = onBack;
  const pushed = useRef(false);
  const watch = useRef<number | null>(null);

  const clearWatch = () => {
    if (watch.current != null) {
      window.clearTimeout(watch.current);
      watch.current = null;
    }
  };

  useEffect(() => {
    if (!active) return;
    // 已经压过（StrictMode 双跑 effect 的第二遍）就不再压第二条
    if (!pushed.current) {
      try {
        // 保留 Next.js 自己的 history state 键，只加我们的标记，别把路由状态冲掉
        const prev = window.history.state;
        const base = prev && typeof prev === "object" ? { ...(prev as Record<string, unknown>) } : {};
        window.history.pushState({ ...base, [MARK]: true }, "");
        pushed.current = true;
      } catch {
        // 极端环境（禁用 history）下退化成「只靠 UI 按钮返回」
      }
    }

    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      clearWatch();
      cbRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      clearWatch();
      // 非 popstate 路径被卸载（比如保存后父层直接 setState 关闭）：
      // 栈顶还是我们的哨兵就撤掉，别在历史里留一条“按了没反应”的空记录
      if (pushed.current) {
        pushed.current = false;
        if (isMine(window.history.state)) {
          try {
            window.history.back();
          } catch {
            /* 忽略 */
          }
        }
      }
    };
  }, [active]);

  return useCallback(() => {
    if (!pushed.current || !isMine(window.history.state)) {
      // 没有哨兵（或已被别的东西顶掉）：直接关，别乱动历史
      pushed.current = false;
      cbRef.current();
      return;
    }
    // 让 popstate 统一触发 onBack；万一浏览器不给事件（个别 WebView），
    // 400ms 后兜底自己关一次
    try {
      window.history.back();
    } catch {
      pushed.current = false;
      cbRef.current();
      return;
    }
    clearWatch();
    watch.current = window.setTimeout(() => {
      watch.current = null;
      if (!pushed.current) return;
      pushed.current = false;
      cbRef.current();
    }, 400);
  }, []);
}
