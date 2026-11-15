"use client";

// components/ToolbarRunMenu.tsx — M290：工具栏「运行 ▾」下拉菜单
//
// 把原来单击即「模拟界面」的运行按钮改成四选一：
//   模拟界面 / 布局编译预览 / 打包并运行 / 签名打包发布
//
// 实现上和 ToolbarMoreMenu 同款：菜单 portal 到 .axv-main（工具栏中区 overflow-x:auto
// 会裁掉挂在下方的菜单），宽度自适应，下方放不下翻到按钮上方。
// 区别：菜单项支持 disabled（不可用的能力灰显 + 提示），触发按钮带 ▾ 小箭头。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as tt } from "@/lib/i18n-src";

export type RunMenuItem = {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** 禁用原因（灰显时在 hint 下再补一行） */
  disabledHint?: string;
  onClick: () => void;
};

export function ToolbarRunMenu({ items, busy }: { items: RunMenuItem[]; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 240 });
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

    // 宽度：理想 240（两行文字 + 图标），窄容器收窄到 180
    const width = Math.max(180, Math.min(240, hostW - 16));
    const left = Math.max(8, Math.min(br.right - hostLeft - width, hostW - width - 8));

    const estH = Math.min(items.length, 10) * 48 + 12;
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
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
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
                type="button"
                className={"axv-tb-menu-item" + (it.disabled ? " axv-tb-menu-item-off" : "")}
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                aria-label={it.label}
                title={it.disabled ? it.disabledHint || it.label : it.hint || it.label}
                disabled={it.disabled}
                onClick={() => {
                  if (it.disabled) return;
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>{it.icon}</span>
                <span className="axv-tb-menu-text">
                  <span className="axv-tb-menu-label">{it.label}</span>
                  {it.hint ? <span className="axv-tb-menu-hint">{it.hint}</span> : null}
                  {it.disabled && it.disabledHint ? (
                    <span className="axv-tb-menu-hint axv-tb-menu-hint-off">{it.disabledHint}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>,
          host,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"axv-tb-btn axv-tb-run" + (busy ? " axv-tb-busy" : "")}
        title={tt("运行 ▾：模拟界面 / 编译预览 / 打包运行 / 签名发布")}
        aria-label={tt("运行")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy ? true : undefined}
        onClick={toggle}
      >
        <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>{busy ? "autorenew" : "play_arrow"}</span>
      </button>
      {menu}
    </>
  );
}
