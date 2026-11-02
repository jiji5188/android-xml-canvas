"use client";

// components/ColorPicker.tsx — M79：从 D:\android-xml-canvas\colorpicker.html 移植的“弹窗式”颜色选择器
// 差异/增强：
//   - 保留原页面的遮罩 + 居中弹窗、canvas HSV 面板、色相/透明度滑杆、ARGB/RGBA 输入、预设、复制/确认
//   - 改成 React 受控组件，方便在图标编辑器里直接替换旧 ColorField
//   - 输出保持为项目里的 Android 颜色字符串（#RRGGBB / #AARRGGBB），由 parseColorOr/toAndroidHex 转换
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  colorToPickerColor,
  defaultPickerColor,
  hsvToRgb,
  parsePickerInputToColor,
  rgbaToArgbHex,
  rgbaText,
  rgbToHsv,
  type PickerColor,
} from "@/lib/xml/color-picker-hsv";
import { parseColorOr, toAndroidHex } from "@/lib/xml/color-argb";

export interface ColorPickerProps {
  /** 当前颜色（项目里的 Android hex 或 CSS 颜色均可） */
  value: string;
  /** 标题 */
  label: string;
  /** 点「确认选择」时回调，返回值是 Android 颜色串（alpha=1 → #RRGGBB，否则 #AARRGGBB） */
  onConfirm: (next: string) => void;
  /** 关闭弹窗（不确认） */
  onClose: () => void;
  /** 预设颜色（不传则用默认 8 色） */
  presets?: string[];
  /** 是否显示「取消」按钮（M88：原「复制色值」改为「取消」） */
  showCancel?: boolean;
  /** 弹出层级：在整页编辑器（z 3000）里要用 abovePage */
  abovePage?: boolean;
}

const DEFAULT_PRESETS = [
  "#ffffff", "#000000", "#e74c3c", "#e67e22",
  "#f1c40f", "#2ecc71", "#3498db", "#9b59b6",
];

/** 外部颜色（比如 #1D1B20 / #FF3498DB / rgba(...)）→ 内部 HSV 状态 */
function initialPickerColor(value: string): PickerColor {
  const rgba = parseColorOr(value, "#3498db");
  return colorToPickerColor(rgba.r, rgba.g, rgba.b, rgba.a);
}

export function ColorPicker({ value, label, onConfirm, onClose, presets = DEFAULT_PRESETS, showCancel = true, abovePage }: ColorPickerProps) {
  const [picker, setPicker] = useState<PickerColor>(() => initialPickerColor(value));
  const [argbText, setArgbText] = useState("#FF3498DB");
  const [rgbaInput, setRgbaInput] = useState("rgba(52,152,219,1)");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  /** ARGB 输入框被手改过：确认时以输入框为准，否则以 HSV 状态为准（避免读到过期 state） */
  const argbDirty = useRef(false);

  // 外部 value 变化时，若用户没有正在输入框里编辑，则同步
  useEffect(() => {
    setPicker(initialPickerColor(value));
  }, [value]);

  /** 依据当前 picker 状态重算所有 UI（canvas、dot、滑杆、预览、输入框、按钮文案） */
  const syncUi = useCallback((p: PickerColor) => {
    const { r, g, b } = hsvToRgb(p.h, p.s, p.v);
    setArgbText(rgbaToArgbHex(r, g, b, p.a));
    setRgbaInput(rgbaText(r, g, b, p.a));
    // 画布重绘
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas && wrap && wrap.clientWidth > 0 && wrap.clientHeight > 0) {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const img = ctx.createImageData(W, H);
        const data = img.data;
        for (let y = 0; y < H; y++) {
          const v = 1 - y / H;
          for (let x = 0; x < W; x++) {
            const s = x / W;
            const c = hsvToRgb(p.h, s, v);
            const idx = (y * W + x) * 4;
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const dotX = p.s * W;
      const dotY = (1 - p.v) * H;
      const dot = wrap.querySelector<HTMLElement>(".cp-dot");
      if (dot) {
        dot.style.left = `${dotX - 7}px`;
        dot.style.top = `${dotY - 7}px`;
      }
      const alphaBar = wrap.querySelector<HTMLElement>(".cp-alpha-bar");
      if (alphaBar) {
        alphaBar.style.background = `linear-gradient(90deg, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`;
      }
    }
  }, []);

  // 初次打开/画布尺寸确定后同步一次（等 layout 完）
  useEffect(() => {
    const t = requestAnimationFrame(() => syncUi(picker));
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听 resize 重绘
  useEffect(() => {
    const onResize = () => syncUi(picker);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [picker, syncUi]);

  const pickAt = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;
    x = Math.max(0, Math.min(x, rect.width));
    y = Math.max(0, Math.min(y, rect.height));
    const s = x / rect.width;
    const v = 1 - y / rect.height;
    setPicker((cur) => {
      const next = { ...cur, s, v };
      argbDirty.current = false;
      syncUi(next);
      return next;
    });
  };

  const onDown = (e: React.PointerEvent) => {
    dragRef.current = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 兼容 */ }
    pickAt(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    pickAt(e.clientX, e.clientY);
  };
  const onUp = () => { dragRef.current = false; };

  const setHue = (h: number) => {
    setPicker((cur) => {
      const next = { ...cur, h };
      argbDirty.current = false;
      syncUi(next);
      return next;
    });
  };
  const setAlpha = (a: number) => {
    setPicker((cur) => {
      const next = { ...cur, a };
      argbDirty.current = false;
      syncUi(next);
      return next;
    });
  };

  const applyArgbText = (raw: string) => {
    argbDirty.current = true;
    setArgbText(raw);
    const next = parsePickerInputToColor("argb", raw, picker);
    if (next) {
      setPicker(next);
      const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
      setRgbaInput(rgbaText(r, g, b, next.a));
    }
  };
  const applyRgbaText = (raw: string) => {
    setRgbaInput(raw);
    const next = parsePickerInputToColor("rgba", raw, picker);
    if (next) {
      setPicker(next);
      const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
      setArgbText(rgbaToArgbHex(r, g, b, next.a));
    }
  };

  const pickPreset = (hex: string) => {
    const rgb = hexToRgbSafe(hex);
    if (!rgb) return;
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const next = { ...hsv, a: 1 };
    argbDirty.current = false;
    setPicker(next);
    const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
    setArgbText(rgbaToArgbHex(r, g, b, 1));
    setRgbaInput(rgbaText(r, g, b, 1));
  };



  const confirm = () => {
    if (argbDirty.current) {
      onConfirm(toAndroidHex(parseColorOr(argbText, "#FF3498DB")));
      return;
    }
    // 以 HSV 状态为准：预设 / 画布 / 滑杆刚改完时 argbText 可能还没同步过来
    const { r, g, b } = hsvToRgb(picker.h, picker.s, picker.v);
    onConfirm(toAndroidHex({ r, g, b, a: picker.a }));
  };

  const previewRgb = hsvToRgb(picker.h, picker.s, picker.v);
  const pop = (
    <div
      className={"axv-cp-mask" + (abovePage ? " is-above-page" : "")}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-cp" role="dialog" aria-label={label} aria-modal="true">
        <div className="cp-header">
          <div className="cp-title">{label}</div>
          <button className="cp-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cp-body">
          <div
            className="cp-canvas-wrap"
            ref={wrapRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <canvas ref={canvasRef} />
            <div className="cp-dot" />
          </div>

          <div className="cp-row">
            <label>色相 H <span>{Math.round(picker.h)}°</span></label>
            <input
              type="range"
              min={0}
              max={360}
              value={Math.round(picker.h)}
              onChange={(e) => setHue(Number(e.target.value))}
              className="cp-slider cp-hue"
            />
          </div>
          <div className="cp-row">
            <label>透明度 A <span>{picker.a.toFixed(2)}</span></label>
            <div className="cp-alpha-wrap">
              <div className="cp-checker-bg" />
              <div className="cp-alpha-bar" style={{ background: `linear-gradient(90deg, rgba(${previewRgb.r},${previewRgb.g},${previewRgb.b},0), rgb(${previewRgb.r},${previewRgb.g},${previewRgb.b}))` }} />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(picker.a * 100)}
                onChange={(e) => setAlpha(Number(e.target.value) / 100)}
                className="cp-slider cp-alpha"
              />
            </div>
          </div>

          <div className="cp-preview-row">
            <div className="cp-preview-box">
              <div className="cp-checker-bg" />
              <div className="cp-preview-layer" style={{ background: rgbaText(previewRgb.r, previewRgb.g, previewRgb.b, picker.a) }} />
            </div>
            <div className="cp-inputs">
              <div className="cp-input-group">
                <label>ARGB</label>
                <input value={argbText} onChange={(e) => applyArgbText(e.target.value)} />
              </div>
              <div className="cp-input-group">
                <label>RGBA</label>
                <input value={rgbaInput} onChange={(e) => applyRgbaText(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="cp-preset-title">预设颜色</div>
          <div className="cp-preset-grid">
            {presets.map((c) => (
              <div key={c} className="cp-preset" style={{ background: c }} onClick={() => pickPreset(c)} title={c} />
            ))}
          </div>

          <div className="cp-actions">
            {showCancel ? (
              <button type="button" className="cp-btn cp-copy" onClick={onClose}>
                取消
              </button>
            ) : null}
            <button type="button" className="cp-btn cp-confirm" onClick={confirm}>
              确认选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const host = typeof document !== "undefined" ? document.body : null;
  if (!host) return null;
  return createPortal(pop, host);
}

function hexToRgbSafe(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** 供调用方在色块上显示当前颜色 */
export function pickerSwatchColor(value: string): string {
  return toAndroidHex(parseColorOr(value, "#3498db"));
}
