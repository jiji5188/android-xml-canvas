// components/ColorField.tsx — 带 alpha 的颜色选择器（色块 + 浮层）
//
// M63：浮层内容换成 HSV 取色器（components/HsvPicker.tsx），原来的
//      「原生 input[type=color] + Alpha 滑杆」手感太差（调不出饱和度/明度，手机上难用）。
//      ColorField 对外 API 一点没变，所以 AttrPanel / DrawablePicker / ShapeEditor 全自动升级。
//
// 输出永远是 CSS 颜色串：alpha=1 时 #rrggbb，否则 rgba(r,g,b,a)。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HsvPicker } from "./HsvPicker";
import { parseColorOr, toArgbHex, toCssColor, type Rgba } from "@/lib/xml/color-argb";

export interface ColorFieldProps {
  /** 当前颜色（任意 CSS 颜色串） */
  value: string;
  /** 解析不出来时的回退色 */
  fallback?: string;
  onChange: (next: string) => void;
  /** 无障碍标签 */
  label: string;
  disabled?: boolean;
  /** 允许「透明」这一档（如选中文字色） */
  allowTransparent?: boolean;
  /** 浮层额外样式类（弹窗里用时需要更高 z-index） */
  aboveModal?: boolean;
}

const POP_W = 236;
const POP_H = 380;

export function ColorField(props: ColorFieldProps) {
  const { value, fallback, onChange, label, disabled, allowTransparent, aboveModal } = props;
  const rgba = parseColorOr(value, fallback);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const css = toCssColor(rgba);
  const argb = toArgbHex(rgba);

  const openPop = () => {
    const r = btnRef.current?.getBoundingClientRect();
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const x = Math.max(8, Math.min(r?.left ?? 8, vw - POP_W - 8));
    // 下方放不下就翻到按钮上方（手机上色块常在屏幕下半部）
    const below = (r?.bottom ?? 40) + 6;
    const y = below + POP_H > vh - 8 ? Math.max(8, (r?.top ?? 40) - POP_H - 6) : below;
    setPos({ x, y });
    setOpen(true);
  };

  // 点外面 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (next: Rgba) => onChange(toCssColor(next));

  const pop = open ? (
    <div
      className={"axv-cf-pop" + (aboveModal ? " is-above-modal" : "")}
      ref={popRef}
      style={{ left: pos.x, top: pos.y }}
    >
      <HsvPicker
        rgba={rgba}
        label={label}
        allowTransparent={allowTransparent}
        onChange={commit}
        onDone={() => setOpen(false)}
      />
    </div>
  ) : null;

  const host =
    typeof document !== "undefined" ? document.querySelector(".axv-main") || document.body : null;

  return (
    <span className="axv-cf">
      <button
        ref={btnRef}
        type="button"
        className="axv-cf-swatch"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={argb}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPop())}
      >
        <span className="axv-cf-checker" aria-hidden="true" />
        <span className="axv-cf-layer" style={{ background: css }} aria-hidden="true" />
      </button>
      {pop && host ? createPortal(pop, host) : null}
    </span>
  );
}
