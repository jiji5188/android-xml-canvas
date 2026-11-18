// components/use-canvas-render.ts — M366 step14（路线 2 拆解）：画布渲染几何计算域
//
// 从 XmlEditor.tsx 抽出（原 ~1560-1611 区域）：
//   selectedNode / widthPx / heightPx / PHONE_BORDER / outerW / outerH /
//   STATUS_BAR_H / NAV_BAR_H / phoneTheme / phoneBg / phoneFg / vw / fitRatio /
//   shortTag / findResolved
//
// 纯计算 + 1 个 resize useState/useEffect，无跨集群函数纠缠（可直接搬）。
// 几何常量与 xml-canvas.css 的 .axv-phone border 必须保持一致（见 PHONE_BORDER 注释）。
// SCALE/DPX 在壳内是本地 const（1dp=2px），作为参数传入保持同步。
"use client";

import { useEffect, useMemo, useState } from "react";
import { findResolvedNode } from "@/lib/xml/paths";
import { readableOn, deviceById } from "@/lib/xml/theme";
import type { ResolvedNode, RenderModel } from "@/lib/xml/types";

type Device = ReturnType<typeof deviceById>;

export interface CanvasRenderInput {
  selectedPath: string | null;
  model: RenderModel | null;
  device: Device;
  isMobile: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  scale: number;
  /** 壳内 1dp=2px（本地 const，非 import） */
  SCALE: number;
  DPX: number;
}

export interface CanvasRenderResult {
  selectedNode: ResolvedNode | null;
  widthPx: number;
  heightPx: number;
  PHONE_BORDER: number;
  outerW: number;
  outerH: number;
  STATUS_BAR_H: number;
  NAV_BAR_H: number;
  phoneTheme: { bg: string; fg: string };
  phoneBg: string;
  phoneFg: string;
  vw: number;
  fitRatio: number;
  shortTag: (t: string) => string;
  findResolved: typeof findResolvedNode;
}

export function useCanvasRender({
  selectedPath, model, device, isMobile, leftOpen, rightOpen, scale, SCALE, DPX,
}: CanvasRenderInput): CanvasRenderResult {
  const selectedNode: ResolvedNode | null = useMemo(() => {
    if (!selectedPath || !model) return null;
    return findResolvedNode(model.root, selectedPath);
  }, [selectedPath, model]);

  // M187：外壳布局 px 固定（不乘 scale），缩放靠 transform
  const widthPx = Math.round(device.w * SCALE);
  const heightPx = Math.round(device.h * SCALE);
  /** 手机外壳边框宽（px）；内容区保持 412x892dp 不被边框吃掉
   *  M12：必须和 xml-canvas.css 里 `.axv-phone` 的 `border: 8px` 一致。 */
  const PHONE_BORDER = 8;
  const outerW = widthPx + PHONE_BORDER * 2;
  const outerH = heightPx + PHONE_BORDER * 2;
  /** 状态栏 24dp（Android 默认高度） */
  const STATUS_BAR_H = Math.round(24 * DPX);
  /** 三键导航栏 48dp */
  const NAV_BAR_H = Math.round(48 * DPX);
  /** 按根布局背景色推导状态栏/导航栏文字颜色（深底浅字 / 浅底深字） */
  const phoneTheme = readableOn(
    String(model?.root?.style?.backgroundColor ?? model?.root?.style?.background ?? ""),
  );
  const phoneBg = phoneTheme.bg;
  const phoneFg = phoneTheme.fg;

  /** 窄屏：把 824px 的机屏等比缩到可视宽度内（保留 dp→px 内部尺寸不变） */
  const [vw, setVw] = useState(0);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const fitRatio = (() => {
    if (!vw) return 1;
    const panels = isMobile ? 0 : (leftOpen ? 320 : 0) + (rightOpen ? 320 : 0);
    const avail = vw - panels - (isMobile ? 28 : 48);
    // M20i：用户要求复原为之前的实现（基准装入比 × 用户缩放）
    const baseW = device.w * SCALE + PHONE_BORDER * 2;
    const fitBase = Math.min(1, avail / Math.max(1, baseW));
    // M187：不再钳 1 —— 钳了以后放大档等于没放大（外壳变大 + transform 缩回，内容却没变）
    return fitBase * scale;
  })();

  function shortTag(t: string): string {
    return t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
  }

  /** 在渲染模型里按 path 找节点（findResolvedNode 的别名，历史命名保留） */
  const findResolved = findResolvedNode;

  return {
    selectedNode, widthPx, heightPx, PHONE_BORDER, outerW, outerH,
    STATUS_BAR_H, NAV_BAR_H, phoneTheme, phoneBg, phoneFg, vw, fitRatio,
    shortTag, findResolved,
  };
}
