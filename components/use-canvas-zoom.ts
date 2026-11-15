// components/use-canvas-zoom.ts — M303：从 XmlEditor.tsx 抽出的画布缩放域
// 负责：scale / zoomHud 状态、缩放锚点纠正、Ctrl+滚轮 / 双指捏合、Ctrl +/-/0 快捷键。

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

export interface UseCanvasZoomOptions {
  /** 手机外壳 DOM（缩放锚点换算用） */
  phoneRef: React.RefObject<HTMLDivElement | null>;
  /** 当前移动端 tab（只有 preview 时才挂手势监听） */
  mobileTab: string;
}

export function useCanvasZoom({ phoneRef, mobileTab }: UseCanvasZoomOptions) {
  const [scale, setScale] = useState(1);
  /** M6g：缩放锚点（Ctrl+滚轮/双指捻合后把鼠标下的点维持在原位） */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const zoomAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const [zoomHud, setZoomHud] = useState<number | null>(null);

  const applyZoom = useCallback(
    (next: number, anchor?: { cx: number; cy: number }) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
      const ph = phoneRef.current;
      if (anchor && ph) {
        const r = ph.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) {
          zoomAnchor.current = {
            cx: anchor.cx,
            cy: anchor.cy,
            px: (anchor.cx - r.left) / r.width,
            py: (anchor.cy - r.top) / r.height,
          };
        }
      }
      setScale(z);
      setZoomHud(z);
    },
    [phoneRef],
  );

  /** 缩放后纠正滚动位置：把锚点那个内容点拉回鼠标处 */
  useEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const st = stageRef.current;
    const ph = phoneRef.current;
    if (!a || !st || !ph) return;
    const r = ph.getBoundingClientRect();
    st.scrollLeft += r.left + a.px * r.width - a.cx;
    st.scrollTop += r.top + a.py * r.height - a.cy;
  }, [scale, phoneRef]);

  /** 缩放百分比浮层：停手 900ms 后自动消失 */
  useEffect(() => {
    if (zoomHud === null) return;
    const t = window.setTimeout(() => setZoomHud(null), 900);
    return () => window.clearTimeout(t);
  }, [zoomHud]);

  /** M6g：Ctrl/Cmd+滚轮、双指捏合（必须原生非 passive 监听才能 preventDefault） */
  useEffect(() => {
    if (mobileTab !== "preview") return;
    const st = stageRef.current;
    if (!st) return;
    let pinch0 = 0;
    let pinchScale0 = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({
      cx: (t[0].clientX + t[1].clientX) / 2,
      cy: (t[0].clientY + t[1].clientY) / 2,
    });
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const mag = Math.abs(e.deltaY * unit);
      const step = ZOOM_STEP * Math.min(3, Math.max(0.5, mag / 100));
      applyZoom(scaleRef.current - Math.sign(e.deltaY) * step, { cx: e.clientX, cy: e.clientY });
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinch0 = dist(e.touches);
      pinchScale0 = scaleRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch0 <= 0) return;
      e.preventDefault();
      applyZoom(pinchScale0 * (dist(e.touches) / pinch0), mid(e.touches));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch0 = 0;
    };
    st.addEventListener("wheel", onWheel, { passive: false });
    st.addEventListener("touchstart", onTouchStart, { passive: true });
    st.addEventListener("touchmove", onTouchMove, { passive: false });
    st.addEventListener("touchend", onTouchEnd, { passive: true });
    st.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      st.removeEventListener("wheel", onWheel);
      st.removeEventListener("touchstart", onTouchStart);
      st.removeEventListener("touchmove", onTouchMove);
      st.removeEventListener("touchend", onTouchEnd);
      st.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [mobileTab, applyZoom]);

  /** M6g：快捷键 Ctrl/Cmd + = / - / 0 控制画布缩放 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key;
      if (k === "=" || k === "+") {
        e.preventDefault();
        applyZoom(scaleRef.current + ZOOM_STEP);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        applyZoom(scaleRef.current - ZOOM_STEP);
      } else if (k === "0") {
        e.preventDefault();
        applyZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyZoom]);

  return { scale, setScale, scaleRef, stageRef, zoomAnchor, zoomHud, setZoomHud, applyZoom };
}
