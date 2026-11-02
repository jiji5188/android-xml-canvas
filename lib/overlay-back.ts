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
      // 组件卸载本身可能是父层已经通过 close/save 调过 onClose，不能在这里再触发回调，
      // 也不能主动 history.back()：网页端会额外退一条真实历史，导致“闪一下回到上页/侧边栏”。
      // 历史清理只保留 sentinel 状态，实际条目由 close() 的 popstate/watchdog 路径负责收敛。
      window.removeEventListener("popstate", onPop);
      clearWatch();
    };
  }, [active]);

  return useCallback(() => {
    // UI close 永远只触发一次：先标记已处理，避免 StrictMode/cleanup/后续误触造成双关。
    if (!pushed.current) {
      cbRef.current();
      return;
    }
    pushed.current = false;
    if (isMine(window.history.state)) {
      try {
        // 让 popstate 统一触发 onBack；万一浏览器不给事件（个别 WebView），
        // 400ms 后兜底自己关一次
        window.history.back();
        clearWatch();
        watch.current = window.setTimeout(() => {
          watch.current = null;
          cbRef.current();
        }, 400);
        return;
      } catch {
        /* 落到直接回调 */
      }
    }
    cbRef.current();
  }, []);
}
