"use client";

// components/ToolbarMoreMenu.tsx — M173：工具栏右侧「更多」弹出菜单
//
// 为什么单独一个组件：
//   1. Toolbar 本身要保持无 state（test/xml_m25c_toolbar.test.tsx 直接调用 Toolbar(props) 拿元素树）；
//   2. 菜单必须画到 .axv-main 层。工具栏中区 .axv-tb-scroll 是 overflow-x: auto，
//      菜单挂在按钮下面会被它裁掉（用户反馈「菜单被遮挡」），所以走 portal 到 .axv-main。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as tt } from "@/lib/i18n-src";

export type MoreItem = {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  title?: string;
  onClick: () => void;
};

const MENU_W = 224;

export function ToolbarMoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const main = document.querySelector(".axv-main") as HTMLElement | null;
    const target = main ?? document.body;
    const br = btn.getBoundingClientRect();
    const hr = target === document.body ? null : target.getBoundingClientRect();
    const hostW = hr ? target.clientWidth || hr.width : window.innerWidth;
    // 右对齐按钮，但不越过容器右边界
    const left = Math.max(8, Math.min(br.right - (hr?.left ?? 0) - MENU_W, hostW - MENU_W - 8));
    setHost(target);
    setPos({ left, top: br.bottom - (hr?.top ?? 0) + 6 });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    place();
    setOpen(true);
  };

  const menu =
    open && host
      ? createPortal(
          <div
            ref={menuRef}
            className="axv-tb-menu"
            role="menu"
            style={{ left: pos.left, top: pos.top, width: MENU_W }}
          >
            {items.map((it) => (
              <button
                key={it.key}
                className="axv-tb-menu-item"
                role="menuitem"
                aria-label={it.label}
                title={it.title || it.label}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>{it.icon}</span>
                <span className="axv-tb-menu-text">
                  <span className="axv-tb-menu-label">{it.label}</span>
                  {it.hint ? <span className="axv-tb-menu-hint">{it.hint}</span> : null}
                </span>
              </button>
            ))}
          </div>,
          host,
        )
      : null;

  return (
    <span className="axv-tb-more">
      <button
        ref={btnRef}
        className="axv-tb-btn"
        title={tt("更多操作：打开文件 / 复制 XML / 导出 res / 清除 res")}
        aria-label={tt("更多")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>more_vert</span>
      </button>
      {menu}
    </span>
  );
}
