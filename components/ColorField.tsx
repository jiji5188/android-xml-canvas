// components/ColorField.tsx — 带 alpha 的颜色选择器（色块 + 居中弹层）
//
// M63：浮层内容换成 HSV 取色器（components/HsvPicker.tsx），原来的
//      「原生 input[type=color] + Alpha 滑杆」手感太差（调不出饱和度/明度，手机上难用）。
// M63c：浮层改为「全屏蒙版 + 居中弹层」（max 300px），不再按锚点算 x/y。
//      手机上色块常在屏幕边缘，跟随定位很容易出界，居中反而稳。
// ColorField 对外 API 没变，AttrPanel / DrawablePicker / ShapeEditor / SettingsPanel 全自动升级。
//
// 输出永远是 CSS 颜色串：alpha=1 时 #rrggbb，否则 rgba(r,g,b,a)。

import { useEffect, useState } from "react";
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
  /** 弹层挂在更高层级（弹窗里用时避免被 backdrop 盖住） */
  aboveModal?: boolean;
}

export function ColorField(props: ColorFieldProps) {
  const { value, fallback, onChange, label, disabled, allowTransparent, aboveModal } = props;
  const rgba = parseColorOr(value, fallback);
  const [open, setOpen] = useState(false);

  const css = toCssColor(rgba);
  const argb = toArgbHex(rgba);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const commit = (next: Rgba) => onChange(toCssColor(next));

  const pop = open ? (
    <div
      className={"axv-cf-mask" + (aboveModal ? " is-above-modal" : "")}
      onPointerDown={(e) => {
        // 点蒙版空白处关闭（点弹层内部不关）
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="axv-cf-pop" role="dialog" aria-label={label} aria-modal="true">
        <HsvPicker
          rgba={rgba}
          label={label}
          allowTransparent={allowTransparent}
          onChange={commit}
          onDone={() => setOpen(false)}
        />
      </div>
    </div>
  ) : null;

  const host =
    typeof document !== "undefined" ? document.querySelector(".axv-main") || document.body : null;

  return (
    <span className="axv-cf">
      <button
        type="button"
        className="axv-cf-swatch"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={argb}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="axv-cf-checker" aria-hidden="true" />
        <span className="axv-cf-layer" style={{ background: css }} aria-hidden="true" />
      </button>
      {pop && host ? createPortal(pop, host) : null}
    </span>
  );
}
