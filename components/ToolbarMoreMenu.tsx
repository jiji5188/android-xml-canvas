"use client";

// components/ToolbarMoreMenu.tsx — M173：工具栏右侧「更多」弹出菜单
//
// 为什么单独一个组件：
//   1. Toolbar 本身要保持无 state（test/xml_m25c_toolbar.test.tsx 直接调用 Toolbar(props) 拿元素树）；
//   2. 菜单必须画到 .axv-main 层。工具栏中区 .axv-tb-scroll 是 overflow-x: auto，
//      菜单挂在按钮下面会被它裁掉（用户反馈「菜单被遮挡」），所以走 portal 到 .axv-main。
//   3. M174c：宽度自适应（min(224, 容器宽-16)），下方放不下时翻到按钮上方。

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

const MENU_MAX_W = 224;

export function ToolbarMoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: MENU_MAX_W });
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
    const hostLeft = hr?.left ?? 0;
    const hostTop = hr?.top ?? 0;
    const hostBottom = hr?.bottom ?? window.innerHeight;

    // 宽度：理想 224，窄容器里收窄（至少 160 才放得下图标+两行文字）
    const width = Math.max(160, Math.min(MENU_MAX_W, hostW - 16));
    const left = Math.max(8, Math.min(br.right - hostLeft - width, hostW - width - 8));

    // 高度估算：每项约 44px（图标 19 + 两行字）+ 菜单上下 padding 12
    const estH = Math.min(items.length, 10) * 44 + 12;
    const spaceBelow = hostBottom - br.bottom;
    // 下方不够且上方有空间（按钮不在视口顶部）→ 翻到按钮上方
    const flip = estH > spaceBelow && br.top - hostTop > estH + 8;
    const top = flip
      ? br.top - hostTop - estH - 6
      : br.bottom - hostTop + 6;

    setHost(target);
    setPos({ left, top: Math.max(4, top), width });
  }, [items.length]);

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
            style={{ left: pos.left, top: pos.top, width: pos.width }}
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
