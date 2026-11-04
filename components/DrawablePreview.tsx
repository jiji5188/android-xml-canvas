"use client";

// components/DrawablePreview.tsx — drawable 图层预览 + 触摸/点击演示（M118）
//
// 干什么：
//   把 drawable-node 的图层树按当前视图状态画出来，并允许在图上按下：
//     - selector 会切到 state_pressed="true" 那支
//     - ripple 会长出波纹（松开淡出）
//     - 可以手动切「禁用」看 state_enabled="false" 那支
//   预览用的就是「最终要写进 XML 的那棵树」，不是另一套近似样式。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flattenDrawable,
  type DrawableNode,
  type RenderLayer,
  type ViewState,
} from "@/lib/xml/drawable-node";
import { argbColorsForPreview, specToCss } from "@/lib/xml/shape-gen";
import { androidColorToCss } from "@/lib/xml/color-argb";
import { t as tt } from "@/lib/i18n-src";

export interface DrawablePreviewProps {
  doc: DrawableNode | null;
  /** 预览区宽度（px） */
  width?: number;
  /** 预览区高度（px） */
  height?: number;
  /** dp → px 系数（画布是 2） */
  scale?: number;
  /** @drawable/x → xml 文本 */
  resolveRef?: (name: string) => string | null;
  /** 允许按下预览 */
  interactive?: boolean;
  /** 显示底部的状态提示/开关 */
  showStateBar?: boolean;
  /** 棋盘格 / 白 / 深 */
  backdrop?: "checker" | "white" | "dark";
  className?: string;
  /** 状态变化回调（外部想同步显示时用） */
  onStateChange?: (s: ViewState) => void;
}

export function DrawablePreview({
  doc,
  width = 220,
  height = 120,
  scale = 1,
  resolveRef,
  interactive = true,
  showStateBar = true,
  backdrop = "checker",
  className,
  onStateChange,
}: DrawablePreviewProps) {
  const [pressed, setPressed] = useState(false);
  const [disabled, setDisabled] = useState(false);
  /** 松开后保留一小段做淡出 */
  const [fading, setFading] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state: ViewState = useMemo(
    () => ({ pressed, enabled: !disabled }),
    [pressed, disabled],
  );

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  useEffect(
    () => () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    },
    [],
  );

  const layers = useMemo(
    () => (doc ? flattenDrawable(doc, { state, resolveRef }) : []),
    [doc, state, resolveRef],
  );

  const down = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setOrigin({
        x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100,
        y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100,
      });
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      setFading(false);
      setPressed(true);
      // 触屏上按下就锁住，避免滚动时误触发
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 老浏览器忽略 */
      }
    },
    [interactive, disabled],
  );

  const up = useCallback(() => {
    if (!pressed) return;
    setPressed(false);
    setFading(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setFading(false), 280);
  }, [pressed]);

  const rippleLayer = layers.find((l) => l.kind === "ripple");
  /** 松开后图层会随 pressed=false 消失，但要留住最后那个波纹色做淡出 */
  const lastRippleColor = useRef<string | null>(null);
  if (pressed && rippleLayer?.color) lastRippleColor.current = rippleLayer.color;
  const showRipple = fading ? lastRippleColor.current !== null : !!rippleLayer;
  const rippleColor = rippleLayer?.color ?? lastRippleColor.current ?? "#33FFFFFF";
  /** 波纹要贴着最上层的形状裁（近似） */
  const clipRadius = topShapeRadius(layers);

  return (
    <div className={"axv-dp" + (className ? " " + className : "")} style={{ width, height }}>
      <div
        className={
          "axv-dp-box" +
          (interactive && !disabled ? " is-live" : "") +
          (disabled ? " is-disabled" : "")
        }
        style={{
          width,
          height,
          background: backdropStyle(backdrop),
        }}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      >
        {layers.map((l) => (
          <LayerView key={l.key} layer={l} scale={scale} boxW={width} boxH={height} />
        ))}

        {showRipple ? (
          <div
            className="axv-dp-ripple-mask"
            style={{ borderRadius: clipRadius, opacity: pressed ? 1 : 0 }}
          >
            <span
              key={pressed ? "on" : "off"}
              className={"axv-dp-ripple" + (pressed ? " is-on" : " is-fading")}
              style={
                {
                  // 注意：Android 的 #AARRGGBB 直接交给 CSS 会被当成 #RRGGBBAA，必须转换
                  background: androidColorToCss(rippleColor),
                  left: `${origin.x}%`,
                  top: `${origin.y}%`,
                  ["--axv-dp-ripple-size" as string]: `${Math.max(width, height) * 2}px`,
                } as React.CSSProperties
              }
            />
          </div>
        ) : null}

        {!interactive ? (
          <div className="axv-dp-lock" title={tt("只读预览")}>
            <span className="msr" aria-hidden="true">lock</span>
          </div>
        ) : null}
      </div>

      {showStateBar ? (
        <div className="axv-dp-state">
          <span className={"axv-dp-badge" + (pressed ? " on" : "")}>
            {pressed ? tt("按下") : tt("常态")}
          </span>
          {layers.some((l) => l.kind === "ripple") || pressed ? (
            <span className="axv-dp-hint">{tt("按住看波纹")}</span>
          ) : (
            <span className="axv-dp-hint">{tt("点击试效果")}</span>
          )}
          <button
            type="button"
            className={"axv-dp-toggle" + (disabled ? " on" : "")}
            onClick={() => setDisabled((v) => !v)}
            title={tt("预览禁用态")}
          >
            {tt("禁用")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 单层渲染：shape 走 specToCss，color 直接铺色 */
function LayerView({
  layer,
  scale,
  boxW,
  boxH,
}: {
  layer: RenderLayer;
  scale: number;
  boxW: number;
  boxH: number;
}) {
  if (layer.kind === "ripple") return null;

  const px = (dp: number) => `${dp * scale}px`;
  const inset = layer.inset;
  const style: React.CSSProperties = {
    position: "absolute",
    left: px(inset.l),
    top: px(inset.t),
    right: px(inset.r),
    bottom: px(inset.b),
    opacity: layer.alpha,
    pointerEvents: "none",
  };
  if (layer.size?.w !== undefined || layer.size?.h !== undefined) {
    if (layer.size.w !== undefined) style.width = px(layer.size.w);
    if (layer.size.h !== undefined) style.height = px(layer.size.h);
  }

  if (layer.kind === "shape" && layer.spec) {
    const css = specToCss(argbColorsForPreview(layer.spec));
    return (
      <div
        className="axv-dp-layer"
        data-kind="shape"
        data-path={layer.path}
        style={{
          ...style,
          background: css.background,
          borderRadius: css.borderRadius,
          border: css.border,
          clipPath: css.clipPath,
          boxShadow: css.boxShadow,
        }}
      />
    );
  }

  if (layer.kind === "color") {
    return (
      <div
        className="axv-dp-layer"
        data-kind="color"
        data-path={layer.path}
        style={{ ...style, background: androidColorToCss(layer.color ?? "#00000000") }}
      />
    );
  }

  // unsupported / vector / bitmap：画个虚线占位，标出层级，不假装能渲染
  return (
    <div
      className="axv-dp-layer axv-dp-unknown"
      data-kind={layer.kind}
      data-path={layer.path}
      style={style}
      title={`${tt("暂不支持预览")}：${layer.path}（${boxW}×${boxH}）`}
    />
  );
}

/** 取最上层 shape 的圆角，用来裁剪波纹 */
function topShapeRadius(layers: RenderLayer[]): string {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.kind === "shape" && l.spec) {
      const css = specToCss(argbColorsForPreview(l.spec));
      return css.borderRadius ?? "0px";
    }
  }
  return "0px";
}

function backdropStyle(kind: "checker" | "white" | "dark"): string {
  if (kind === "white") return "#FFFFFF";
  if (kind === "dark") return "#3A3A3A";
  return "repeating-conic-gradient(#d9d9d9 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px";
}
