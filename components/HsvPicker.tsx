// components/HsvPicker.tsx — M63：HSV 取色弹层（替换 M49 的原生 input[type=color] 方案）
//
// 为什么要换：`<input type="color">` 只有 RGB，没有饱和度/明度面板，手机上还调不出半透明，
// 手感差。这里改成「HSV 面板 + 色相条 + 透明度条 + ARGB/RGBA 输入 + 预设」。
//
// 关键实现（都是踩过的坑）：
//   1. 面板不用 canvas 逐像素算 —— 纯 CSS 三层渐变（hsl 底 + 横白 + 纵黑），
//      拖动时零重算，手机上也不卡；
//   2. 触摸用 Pointer Events + setPointerCapture + touch-action:none，
//      否则 WebView 里手指滑动根本不触发 mousemove（旧版就是拽不动）；
//   3. 只做「受控组件」：颜色状态在调用方，onChange 立刻回写，父层自己决定要不要节流。
//
// 输出：CSS 颜色串（与 ColorField 一致），alpha=1 时 #rrggbb，否则 rgba(...)。

import { useCallback, useEffect, useRef, useState } from "react";
import { hsvPanelBackground, hsvToRgb, rgbToHsvKeepHue, type Hsv } from "@/lib/xml/hsv";
import {
  parseColor,
  toArgbHex,
  toCssColor,
  toRgbHex,
  withAlpha,
  type Rgba,
} from "@/lib/xml/color-argb";

export interface HsvPickerProps {
  /** 当前颜色 */
  rgba: Rgba;
  /** 拖动/输入时立刻回调（调用方更新 value 后这里会拿到新 rgba） */
  onChange: (next: Rgba) => void;
  /** 点「完成」或 Enter 时回调（一般是关弹层） */
  onDone?: () => void;
  /** 允许「透明」档 */
  allowTransparent?: boolean;
  label: string;
}

const PRESETS = [
  "#FFFFFF",
  "#000000",
  "#E74C3C",
  "#E67E22",
  "#F1C40F",
  "#2ECC71",
  "#3498DB",
  "#9B59B6",
];

export function HsvPicker({ rgba, onChange, onDone, allowTransparent, label }: HsvPickerProps) {
  // HSV 内部状态：色相要自己hold住（灰色时 rgb→hsv 丢色相）
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsvKeepHue(rgba.r, rgba.g, rgba.b, 200));
  const [draft, setDraft] = useState<string | null>(null);
  const lastEmit = useRef<string>(toCssColor(rgba));

  /** 外部值变了（预设/输入/其它控件）→ 同步 HSV；自己刚发出去的值跳过，避免抖动 */
  useEffect(() => {
    const css = toCssColor(rgba);
    if (css === lastEmit.current) return;
    lastEmit.current = css;
    setHsv((cur) => rgbToHsvKeepHue(rgba.r, rgba.g, rgba.b, cur.h));
  }, [rgba]);

  const emit = useCallback(
    (next: Hsv, alpha: number) => {
      setHsv(next);
      const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
      const out = { r, g, b, a: alpha };
      lastEmit.current = toCssColor(out);
      onChange(out);
    },
    [onChange],
  );

  /* ---------- HSV 面板拖动 ---------- */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const pickAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const v = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      emit({ h: hsv.h, s, v }, rgba.a);
    },
    [emit, hsv.h, rgba.a],
  );

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 老 WebView 可能不支持，退化为普通拖动 */
      }
      pickAt(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      pickAt(e.clientX, e.clientY);
    };
    const up = () => {
      dragging.current = false;
    };
    // pointerdown 必须在元素上；move/up 在 window 上兜底（手指滑出面板也能跟）
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [pickAt]);

  const css = toCssColor(rgba);
  const argb = toArgbHex(rgba);
  const alphaPct = Math.round(rgba.a * 100);
  const rgbHex = toRgbHex(rgba);
  const rgbaText = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a.toFixed(2)})`;

  /** ARGB 文本框：容错 6 位（当 RGB，alpha 保留）/ 8 位 / # 省略 / 3 位缩写 */
  const applyText = (raw: string) => {
    const t = raw.trim();
    const c = parseColor(t) ?? parseColor(t.startsWith("#") ? t : `#${t}`);
    if (!c) return false;
    // 6 位（或 3 位缩写）= 只说 RGB → alpha 保留当前值；8 位（AARRGGBB）= 连 alpha 一起改
    const hexDigits = t.replace(/[^0-9a-f]/gi, "").length;
    const keepA = hexDigits >= 7 ? c.a : rgba.a;
    const next = { r: c.r, g: c.g, b: c.b, a: keepA };
    setHsv((cur) => rgbToHsvKeepHue(c.r, c.g, c.b, cur.h));
    lastEmit.current = toCssColor(next);
    onChange(next);
    return true;
  };

  return (
    <div className="axv-hsv" role="dialog" aria-label={label}>
      {/* 饱和度/明度面板：纯 CSS 渐变，拖动零重算 */}
      <div
        className="axv-hsv-panel"
        ref={panelRef}
        style={{ background: hsvPanelBackground(hsv.h) }}
        role="slider"
        aria-label={`${label} 饱和度与明度`}
        aria-valuetext={`S ${Math.round(hsv.s * 100)}% V ${Math.round(hsv.v * 100)}%`}
        tabIndex={-1}
      >
        <span
          className="axv-hsv-dot"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          aria-hidden="true"
        />
      </div>

      {/* 色相 */}
      <div className="axv-hsv-row">
        <span className="axv-hsv-lab">色相</span>
        <input
          className="axv-hsv-hue"
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(hsv.h)}
          aria-label={`${label} 色相`}
          onChange={(e) => emit({ ...hsv, h: Number(e.target.value) }, rgba.a)}
        />
        <b className="axv-hsv-num">{Math.round(hsv.h)}°</b>
      </div>

      {/* 透明度 */}
      <div className="axv-hsv-row">
        <span className="axv-hsv-lab">透明</span>
        <span className="axv-hsv-alpha-wrap">
          <span className="axv-hsv-checker" aria-hidden="true" />
          <span
            className="axv-hsv-alpha-bar"
            style={{ background: `linear-gradient(to right, rgba(${rgba.r},${rgba.g},${rgba.b},0), rgb(${rgba.r},${rgba.g},${rgba.b}))` }}
            aria-hidden="true"
          />
          <input
            className="axv-hsv-alpha"
            type="range"
            min={0}
            max={100}
            step={1}
            value={alphaPct}
            aria-label={`${label} 透明度`}
            onChange={(e) => onChange(withAlpha(rgba, Number(e.target.value) / 100))}
          />
        </span>
        <b className="axv-hsv-num">{alphaPct}%</b>
      </div>

      {/* 预览 + 输入 */}
      <div className="axv-hsv-prev-row">
        <span className="axv-hsv-preview">
          <span className="axv-hsv-checker" aria-hidden="true" />
          <span className="axv-hsv-prev-layer" style={{ background: css }} aria-hidden="true" />
        </span>
        <input
          className="axv-hsv-hex"
          spellCheck={false}
          aria-label={`${label} ARGB`}
          placeholder="#AARRGGBB"
          title="支持 #AARRGGBB / #RRGGBB / #RGB"
          value={draft ?? argb}
          onChange={(e) => {
            const t = e.target.value;
            setDraft(t);
            applyText(t);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setDraft(null);
              onDone?.();
            }
          }}
        />
      </div>
      <div className="axv-hsv-sub">{rgbaText}</div>

      {/* 预设 */}
      <div className="axv-hsv-presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="axv-hsv-preset"
            style={{ background: p }}
            title={p}
            aria-label={`预设 ${p}`}
            onClick={() => applyText(p)}
          />
        ))}
      </div>

      <div className="axv-hsv-actions">
        {allowTransparent ? (
          <button
            type="button"
            className="axv-hsv-btn"
            onClick={() => {
              setDraft(null);
              onChange({ r: rgba.r, g: rgba.g, b: rgba.b, a: 0 });
            }}
          >
            透明
          </button>
        ) : null}
        <button
          type="button"
          className="axv-hsv-btn axv-hsv-ok"
          onClick={() => {
            setDraft(null);
            onDone?.();
          }}
        >
          完成
        </button>
      </div>

      {/* 原生取色兜底：某些颜色（屏幕取色）只能靠系统面板 */}
      <label className="axv-hsv-native-row">
        <span>系统取色器</span>
        <input
          className="axv-hsv-native"
          type="color"
          value={rgbHex}
          aria-label={`${label} 系统取色`}
          onChange={(e) => {
            const c = parseColor(e.target.value);
            if (c) applyText(e.target.value);
          }}
        />
      </label>
    </div>
  );
}
