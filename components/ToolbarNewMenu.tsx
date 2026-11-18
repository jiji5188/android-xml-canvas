"use client";

// components/ToolbarNewMenu.tsx — M404：工具栏「＋」新建菜单（撤销按钮前）
//
// 与 ToolbarMoreMenu 同款：portal 到 .axv-main，避免被 .axv-tb-scroll 的 overflow 裁掉。
// 三项：新建 Activity 页面 / 新建 Java 类 / 新建 XML 布局。
// items 走 props 传入（与 ToolbarMoreMenu 一致），元素树测试可收集 props.items。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as tt } from "@/lib/i18n-src";

export type NewItemKind = "activity" | "java" | "layout" | "debug";

export interface NewMenuItem {
  key: NewItemKind;
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
}

const MENU_MAX_W = 232;

/** M404：工具栏「＋」菜单默认三项 */
export const DEFAULT_NEW_ITEMS = (onNewItem: (kind: NewItemKind) => void): NewMenuItem[] => [
  { key: "activity", icon: "note_add", label: tt("新建 Activity 页面"), hint: tt("Java 类 + 配套布局"), onClick: () => onNewItem("activity") },
  { key: "java", icon: "description", label: tt("新建 Java 类"), hint: tt("只建 .java 源文件"), onClick: () => onNewItem("java") },
  // M405：带 main/debug 入口的 Java 类，新建后直接可点「▶ 调试」
  { key: "debug", icon: "bug_report", label: tt("新建调试入口类"), hint: tt("带 main/debug，可直接调试运行"), onClick: () => onNewItem("debug") },
  { key: "layout", icon: "dashboard_customize", label: tt("新建 XML 布局"), hint: tt("res/layout 下新建布局"), onClick: () => onNewItem("layout") },
];

export function ToolbarNewMenu({ items }: { items: NewMenuItem[] }) {
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
    const width = Math.max(180, Math.min(MENU_MAX_W, hostW - 16));
    const left = Math.max(8, Math.min(br.left - hostLeft, hostW - width - 8));
    const estH = items.length * 48 + 12;
    const spaceBelow = hostBottom - br.bottom;
    const flip = estH > spaceBelow && br.top - hostTop > estH + 8;
    const top = flip ? br.top - hostTop - estH - 6 : br.bottom - hostTop + 6;
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
          <div ref={menuRef} className="axv-tb-menu" role="menu" style={{ left: pos.left, top: pos.top, width: pos.width }}>
            {items.map((it) => (
              <button
                key={it.key}
                className="axv-tb-menu-item"
                role="menuitem"
                aria-label={it.label}
                title={it.label}
                onClick={it.onClick}
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
        title={tt("新建：Activity / Java / 调试入口 / XML 布局")}
        aria-label={tt("新建")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>add</span>
      </button>
      {menu}
    </span>
  );
}
