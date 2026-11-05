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
  pickStateItem,
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
  /** M143：@drawable/x → 图片 dataURL（png / jpg / bmp / webp / svg） */
  resolveImage?: (name: string) => string | null;
  /** 允许按下预览 */
  interactive?: boolean;
  /** 显示底部的状态提示/开关 */
  showStateBar?: boolean;
  /** 棋盘格 / 白 / 深 / 不上色（外面自己铺背景时用） */
  backdrop?: "checker" | "white" | "dark" | "none";
  /** M133：显示「整个 drawable 的边界」参照框（选区之外的位置，看图层往哪偏移） */
  showBounds?: boolean;
  /** M135：把「预览框」自己画（棋盘格/纯色底 + 内边距），这样底部状态条
      （常态 / 按下 / 禁用）落在框外面，不会被父层 overflow:hidden 裁掉 */
  frame?: React.CSSProperties;
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
  resolveImage,
  interactive = true,
  showStateBar = true,
  showBounds = false,
  backdrop = "checker",
  frame,
  className,
  onStateChange,
}: DrawablePreviewProps) {
  const [pressed, setPressed] = useState(false);
  const [disabled, setDisabled] = useState(false);
  /** M136：手动锁定的状态位（聚焦/悬停/勾选…），以及「锁定按下」 */
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  /** 松开后保留一小段做淡出 */
  const [fading, setFading] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 文档里真正用到的状态位：只给这些做开关，不拿没用到的状态凑一排按钮 */
  const usedStates = useMemo(() => collectUsedStates(doc), [doc]);
  const livePressed = pressed || !!locked.pressed;

  const state: ViewState = useMemo(() => {
    const extra: Record<string, boolean> = {};
    for (const k of usedStates) extra[k] = !!locked[k];
    return { ...extra, pressed: livePressed, enabled: !disabled };
  }, [usedStates, locked, livePressed, disabled]);

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
    () => (doc ? flattenDrawable(doc, { state, resolveRef, resolveImage }) : []),
    [doc, state, resolveRef, resolveImage],
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
  if (livePressed && rippleLayer?.color) lastRippleColor.current = rippleLayer.color;
  const showRipple = fading ? lastRippleColor.current !== null : !!rippleLayer;
  const rippleColor = rippleLayer?.color ?? lastRippleColor.current ?? "#33FFFFFF";
  /** M136：当前状态下每个 selector 命中了第几项（预览下方显示，解释「为什么画的是这个」） */
  const picks = useMemo(() => (doc ? selectorPicks(doc, state) : []), [doc, state]);
  /** 波纹要贴着最上层的形状裁（近似） */
  const clipRadius = topShapeRadius(layers);

  /** M135：预览框（棋盘格 / 纯色底 + 内边距）由外层传入时，框只包住 drawable，
      底部状态条落在框外 —— 以前框包着整块（含状态条），overflow:hidden 把按钮裁没了 */
  const boxNode = (
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
          style={{ borderRadius: clipRadius, opacity: livePressed ? 1 : 0 }}
        >
          <span
            key={livePressed ? "on" : "off"}
            className={"axv-dp-ripple" + (livePressed ? " is-on" : " is-fading")}
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

      {showBounds ? (
        <div
          className="axv-dp-bounds"
          title={tt("drawable 边界")}
          style={{ width, height, marginLeft: "-2px", marginTop: "-2px" }}
        />
      ) : null}
    </div>
  );

  return (
    // M135：带状态条时高度必须自适应（以前写死 height，状态条被父层 overflow:hidden 裁掉，
    // 「按下 / 禁用」按钮看不到）；只有纯预览（无状态条）才保持严格尺寸
    <div
      className={"axv-dp" + (className ? " " + className : "")}
      style={{ width: frame ? "auto" : width, height: showStateBar ? "auto" : height }}
    >
      {frame ? (
        <div className="axv-dp-frame" style={frame}>
          {boxNode}
        </div>
      ) : (
        boxNode
      )}

      {showStateBar ? (
        <div className="axv-dp-state-wrap">
          <div className="axv-dp-state">
            <span className={"axv-dp-badge" + (livePressed ? " on" : "")}>
              {livePressed ? tt("按下") : tt("常态")}
            </span>
            {usedStates.length === 0 ? (
              <>
                <span className="axv-dp-hint">
                  {layers.some((l) => l.kind === "ripple")
                    ? tt("按住看波纹")
                    : tt("点击试效果")}
                </span>
                <button
                  type="button"
                  className={"axv-dp-toggle" + (disabled ? " on" : "")}
                  onClick={() => setDisabled((v) => !v)}
                  title={tt("预览禁用态")}
                >
                  {tt("禁用")}
                </button>
              </>
            ) : (
              <div className="axv-dp-chips">
                {usedStates.map((k) => {
                  const on = k === "pressed" ? livePressed : !!locked[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      className={"axv-dp-chip" + (on ? " is-on" : "")}
                      onClick={() => setLocked((prev) => ({ ...prev, [k]: !prev[k] }))}
                      title={tt("点亮后预览这个状态")}
                    >
                      {stateText(k)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={"axv-dp-chip axv-dp-chip-off" + (disabled ? " is-on" : "")}
                  onClick={() => setDisabled((v) => !v)}
                  title={tt("预览禁用态")}
                >
                  {tt("禁用")}
                </button>
              </div>
            )}
          </div>
          {picks.length > 0 ? (
            <div className="axv-dp-pick">
              <span className="msr" aria-hidden="true">
                check_circle
              </span>
              <span>
                {tt("命中")}：
                {picks
                  .map((p) =>
                    p.index < 0
                      ? tt("没有状态命中")
                      : tt("第 {n} 项", { n: String(p.index + 1) }),
                  )
                  .join(" · ")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 状态位的展示文案（预览下方的小开关用）；逐条 tt() 便于运行时切语言 */
function stateText(k: string): string {
  switch (k) {
    case "pressed":
      return tt("按下");
    case "focused":
      return tt("聚焦");
    case "hovered":
      return tt("悬停");
    case "checked":
      return tt("勾选");
    case "selected":
      return tt("选中");
    case "activated":
      return tt("激活");
    case "window_focused":
      return tt("窗口聚焦");
    case "enabled":
      return tt("启用");
    default:
      return k;
  }
}

/** 固定顺序，避免每次渲染开关跳位 */
const STATE_ORDER = ["pressed", "focused", "hovered", "checked", "selected", "activated", "window_focused"];

/** 这棵树里所有 selector 到底用了哪些状态位（只给用到的做开关） */
export function collectUsedStates(node: DrawableNode | null): string[] {
  const used = new Set<string>();
  const walk = (n: DrawableNode | null | undefined) => {
    if (!n) return;
    switch (n.t) {
      case "selector":
        for (const it of n.items) {
          for (const k of Object.keys(it.states)) {
            const key = k.replace(/^state_/, "");
            if (key !== "enabled") used.add(key);
          }
          walk(it.node);
        }
        return;
      case "layer":
        n.items.forEach((it) => walk(it.node));
        return;
      case "ripple":
        walk(n.content);
        walk(n.mask);
        return;
      default:
        return;
    }
  };
  walk(node);
  return STATE_ORDER.filter((k) => used.has(k));
}

/** 当前状态下每个 selector 命中第几项（-1 = 都没有命中） */
export function selectorPicks(
  node: DrawableNode | null,
  state: ViewState,
): { index: number; total: number }[] {
  const out: { index: number; total: number }[] = [];
  const walk = (n: DrawableNode | null | undefined) => {
    if (!n) return;
    if (n.t === "selector") {
      const hit = pickStateItem(n.items, state);
      out.push({ index: hit ? n.items.indexOf(hit) : -1, total: n.items.length });
      n.items.forEach((it) => walk(it.node));
      return;
    }
    if (n.t === "layer") n.items.forEach((it) => walk(it.node));
    else if (n.t === "ripple") {
      walk(n.content);
      walk(n.mask);
    }
  };
  walk(node);
  return out;
}

/** M127：把变换链翻成 CSS（内缩已消化成 inset，只剩旋转/缩放/裁剪） */
export function transformToCssStyle(layer: RenderLayer): React.CSSProperties | undefined {
  const chain = layer.transform;
  if (!chain?.length) return undefined;
  const parts: string[] = [];
  let origin = "50% 50%";
  for (const t of chain) {
    if (t.kind === "rotate" || t.kind === "animated-rotate") {
      const from = parseFloat(t.params["fromDegrees"]) || 0;
      parts.unshift(`rotate(${from}deg)`);
      const px = t.params["pivotX"] ?? "50%";
      const py = t.params["pivotY"] ?? "50%";
      if (px !== "50%" || py !== "50%") origin = `${px} ${py}`;
    } else if (t.kind === "scale") {
      const sw = parseFloat(t.params["scaleWidth"]) || 100;
      const sh = parseFloat(t.params["scaleHeight"]) || 100;
      parts.unshift(`scale(${sw / 100}, ${sh / 100})`);
      const g = t.params["scaleGravity"] ?? "center";
      if (g !== "center") origin = g;
    } else if (t.kind === "clip") {
      // 裁剪依赖 level 动态值，静态预览按全量画，不 fake
    }
  }
  const tf = parts.filter(Boolean).join(" ");
  if (!tf) return undefined;
  return { transform: tf, transformOrigin: origin };
}

/**
 * M133：Android Gravity → 对齐因子（0 = 左/上，0.5 = 居中，1 = 右/下）。
 * 没写或写 fill 时按左上锚定；写 center 才居中。
 */
export function parseGravity(gravity?: string): { hz: number; vt: number } {
  const toks = (gravity ?? "fill")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const has = (n: string) => toks.includes(n);
  let hz = 0;
  let vt = 0;
  if (has("center") || has("center_horizontal")) hz = 0.5;
  else if (has("right") || has("end")) hz = 1;
  if (has("center") || has("center_vertical")) vt = 0.5;
  else if (has("bottom")) vt = 1;
  return { hz, vt };
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
  // M133：item 的 width/height + gravity（对齐方式按 Android 的 Gravity 解析）
  const sized = layer.size?.w !== undefined || layer.size?.h !== undefined;
  if (sized) {
    const cw = boxW - (inset.l + inset.r) * scale;
    const ch = boxH - (inset.t + inset.b) * scale;
    const w = layer.size?.w !== undefined ? layer.size.w * scale : cw;
    const h = layer.size?.h !== undefined ? layer.size.h * scale : ch;
    const { hz, vt } = parseGravity(layer.gravity);
    style.width = `${w}px`;
    style.height = `${h}px`;
    style.left = `${inset.l * scale + (cw - w) * hz}px`;
    style.top = `${inset.t * scale + (ch - h) * vt}px`;
    delete style.right;
    delete style.bottom;
  }

  if (layer.kind === "shape" && layer.spec) {
    const css = specToCss(argbColorsForPreview(layer.spec));
    const tf = transformToCssStyle(layer);
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
          ...(tf ?? {}),
        }}
      />
    );
  }

  if (layer.kind === "color") {
    const tf = transformToCssStyle(layer);
    return (
      <div
        className="axv-dp-layer"
        data-kind="color"
        data-path={layer.path}
        style={{ ...style, background: androidColorToCss(layer.color ?? "#00000000"), ...(tf ?? {}) }}
      />
    );
  }

  if (layer.kind === "image" && layer.dataUrl) {
    const tf = transformToCssStyle(layer);
    return (
      <img
        className="axv-dp-layer"
        data-kind="image"
        data-path={layer.path}
        src={layer.dataUrl}
        alt=""
        draggable={false}
        style={{
          ...style,
          // 图片按层盒子铺满（Android 的 bitmap 默认就是拉伸到 item 尺寸）
          objectFit: "fill",
          ...(tf ?? {}),
        }}
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

function backdropStyle(kind: "checker" | "white" | "dark" | "none"): string {
  if (kind === "none") return "transparent";
  if (kind === "white") return "#FFFFFF";
  if (kind === "dark") return "#3A3A3A";
  return "repeating-conic-gradient(#d9d9d9 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px";
}
