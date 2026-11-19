// components/LibsItemMenu.tsx — M388：库面板表项的长按/右键弹出菜单
//
// 背景：LibsPanel 三个 tab（共享库/项目库/常用库）的表项原本挂一排内联按钮
// （删除、存 libs、移除、下载、应用到项目…），手机上按钮太挤、误触多。
// 统一改成：行内只留主要动作（下载按钮 / 状态标记），次要动作走长按弹菜单
// （桌面端右键等价）。菜单样式复用 axv-tfm（项目树长按菜单同款）。
//
// 长按判定照抄 ProjectPanel 已验证的参数：
//   · 450ms 计时、8px 位移阈值（滑动 = 列表滚动，不弹菜单）
//   · 手机 WebView 长按会自发 pointercancel，抬起/取消都挂 window，且 cancel 不清定时器
//   · 右键（button===2）直接弹，不等 450ms

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface LibsMenuItem {
  key: string;
  label: string;
  /** 危险动作（红色） */
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface LibsItemMenuState {
  x: number;
  y: number;
  items: LibsMenuItem[];
}

export interface LibsItemMenuProps {
  state: LibsItemMenuState;
  onClose: () => void;
}

const MENU_W = 180;
const MENU_ITEM_H = 38;

export function LibsItemMenu({ state, onClose }: LibsItemMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // 挂载后按实际尺寸 clamp 进视口（同 TreeFileMenu）
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = ref.current;
    const w = el?.offsetWidth || MENU_W;
    const h = el?.offsetHeight || Math.min(MENU_ITEM_H * state.items.length + 12, vh);
    setPos({
      left: Math.max(6, Math.min(state.x, vw - w - 6)),
      top: Math.max(6, Math.min(state.y, vh - h - 6)),
    });
  }, [state.x, state.y, state.items.length]);

  // 点外面 / Esc 关闭
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="axv-tfm-mask" role="presentation">
      <div className="axv-tfm" ref={ref} style={{ left: pos.left, top: pos.top }} role="menu">
        {state.items.map((it) => (
          <button
            key={it.key}
            type="button"
            className={"axv-tfm-item" + (it.danger ? " danger" : "")}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span className="axv-tfm-label">{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** 长按/右键弹菜单的指针事件三件套。
 *  用法：const bind = useLongPress<P>((x, y, p) => ...); 行上 spread {...bind(payload)}
 *  单例 pressRef（同一时刻只有一行在被按）—— 不会因为多行各自建 ref 而泄漏。
 *  M431b：长按弹菜单后拦截随后的 click（触屏抬手必发 click）——
 *  否则挂了 onClick 的行（如 fileTree 组头折叠）会「菜单刚弹出列表又被折叠」。 */
export function useLongPress<P>(open: (x: number, y: number, payload: P) => void) {
  const pressRef = useRef({ timer: null as number | null, x: 0, y: 0, moved: false, fired: false });

  const cancelPress = () => {
    const st = pressRef.current;
    if (st.timer != null) {
      window.clearTimeout(st.timer);
      st.timer = null;
    }
  };

  const bind = (payload: P) => ({
    onPointerDown: (e: React.PointerEvent) => {
      pressRef.current.fired = false;
      if (e.button === 2) {
        e.preventDefault();
        open(e.clientX, e.clientY, payload);
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const st = pressRef.current;
      cancelPress();
      st.x = e.clientX;
      st.y = e.clientY;
      st.moved = false;
      st.timer = window.setTimeout(() => {
        st.timer = null;
        if (st.moved) return;
        st.fired = true;
        open(st.x, st.y, payload);
      }, 450);
      // 手机抬起/取消都靠 window（行上收不到），cancel 不清定时器（同 ProjectPanel 的注释）
      window.addEventListener("pointerup", cancelPress, { once: true });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = pressRef.current;
      if (st.timer == null) return;
      if (Math.abs(e.clientX - st.x) > 8 || Math.abs(e.clientY - st.y) > 8) {
        st.moved = true;
        cancelPress();
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      pressRef.current.fired = true; // 右键弹菜单后同样拦掉紧随的 click
      open(e.clientX, e.clientY, payload);
    },
    // M431b：长按/右键刚弹过菜单 → 吃掉这次 click，不让行上 onClick（折叠等）跟着触发
    onClickCapture: (e: React.MouseEvent) => {
      if (pressRef.current.fired) {
        e.preventDefault();
        e.stopPropagation();
        pressRef.current.fired = false;
      }
    },
  });

  return bind;
}
