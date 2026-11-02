// components/ColorField.tsx —— 带 alpha 的颜色选择器（色块 + 弹窗取色器）
//
// M89d：弹窗内容从旧的 HsvPicker（.axv-cf-mask 那套浮层）统一换成
//      components/ColorPicker.tsx（colorpicker.html 移植版：canvas HSV 面板 + 色相/透明度条
//      + ARGB/RGBA 输入 + 预设 + 确认），全站只有这一套取色器了。
//      对外 API 没变，AttrPanel / ShapeEditor / SettingsPanel / ValuesEditor / DrawablePicker
//      等所有用到 ColorField 的地方自动升级。
//
// 输出永远是 CSS 颜色串：alpha=1 → #rrggbb，否则 rgba(r,g,b,a)。
import { useEffect, useState } from "react";
import { ColorPicker } from "./ColorPicker";
import { parseColorOr, toArgbHex, toCssColor } from "@/lib/xml/color-argb";

export interface ColorFieldProps {
  /** 当前颜色（任意 CSS 颜色串） */
  value: string;
  /** 解析不出来时的回退值 */
  fallback?: string;
  onChange: (next: string) => void;
  /** 无障碍标题 */
  label: string;
  disabled?: boolean;
  /** 允许「透明」这一档（如选中文字色）：把透明度拖到 0 即可 */
  allowTransparent?: boolean;
  /** 在整页浮层/弹窗里用时抬高层级 */
  aboveModal?: boolean;
}

export function ColorField(props: ColorFieldProps) {
  const { value, fallback, onChange, label, disabled, aboveModal } = props;
  const rgba = parseColorOr(value, fallback);
  const [open, setOpen] = useState(false);

  const css = toCssColor(rgba);
  const argb = toArgbHex(rgba);

  // Esc 关闭（ColorPicker 自己没有监听 Esc）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
      {open ? (
        <ColorPicker
          value={css}
          label={label}
          abovePage={aboveModal}
          presets={["#ffffff", "#000000", "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#3498db", "#9b59b6"]}
          onConfirm={(next) => {
            // ColorPicker 回的是 Android 写法（#RRGGBB / #AARRGGBB），这里转回 CSS 串
            onChange(toCssColor(parseColorOr(next, css)));
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}
