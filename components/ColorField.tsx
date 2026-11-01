// components/ColorField.tsx — M49：带 alpha 的颜色选择器（ARGB）
//
// `<input type="color">` 只有 RGB，调不出半透明。这里包一层：
//   · 小色块（棋盘格打底，能看出透明度）
//   · 点开换成浮层：原生取色器选 RGB + Alpha 滑杆 + #AARRGGBB 文本框 + 棋盘预览
//   · 浮层用 portal 挂到 .axv-main（侧边栏有 overflow 裁剪，直接放会看不见）
// 输出永远是 CSS 颜色串：alpha=1 时 #rrggbb，否则 rgba(r,g,b,a)。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  parseColor,
  parseColorOr,
  toArgbHex,
  toCssColor,
  toRgbHex,
  withAlpha,
} from "@/lib/xml/color-argb";

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
}

export function ColorField(props: ColorFieldProps) {
  const { value, fallback, onChange, label, disabled, allowTransparent } = props;
  const rgba = parseColorOr(value, fallback);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  /** 文本框里的草稿（输入过程中不要立刻回写，等合法了再提交） */
  const [draft, setDraft] = useState<string | null>(null);

  const css = toCssColor(rgba);
  const argb = toArgbHex(rgba);
  const alphaPct = Math.round(rgba.a * 100);

  const openPop = () => {
    const r = btnRef.current?.getBoundingClientRect();
    const w = 214;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const x = Math.max(8, Math.min((r?.left ?? 8), vw - w - 8));
    const y = Math.min((r?.bottom ?? 40) + 6, vh - 150);
    setPos({ x, y });
    setDraft(null);
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

  const commit = (next: string) => onChange(next);

  const pop = open ? (
    <div
      className="axv-cf-pop"
      ref={popRef}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={label}
    >
      <div className="axv-cf-preview">
        <span className="axv-cf-checker" aria-hidden="true" />
        <span className="axv-cf-layer" style={{ background: css }} aria-hidden="true" />
      </div>
      <label className="axv-cf-row">
        <span>取色</span>
        <input
          className="axv-cf-native"
          type="color"
          value={toRgbHex(rgba)}
          aria-label={`${label} RGB`}
          onChange={(e) => {
            const c = parseColor(e.target.value);
            if (c) commit(toCssColor({ ...c, a: rgba.a }));
          }}
        />
      </label>
      <label className="axv-cf-row">
        <span>Alpha</span>
        <input
          className="axv-cf-alpha"
          type="range"
          min={0}
          max={100}
          step={1}
          value={alphaPct}
          aria-label={`${label} 透明度`}
          onChange={(e) => commit(toCssColor(withAlpha(rgba, Number(e.target.value) / 100)))}
        />
        <b className="axv-cf-pct">{alphaPct}%</b>
      </label>
      <input
        className="axv-cf-hex"
        spellCheck={false}
        aria-label={`${label} ARGB`}
        placeholder="#AARRGGBB"
        value={draft ?? argb}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const c = parseColor(t);
          if (c) commit(toCssColor(c));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setDraft(null);
            setOpen(false);
          }
        }}
      />
      {allowTransparent ? (
        <button
          className="axv-cf-trans"
          onClick={() => {
            commit("transparent");
            setDraft(null);
          }}
        >
          透明
        </button>
      ) : null}
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
