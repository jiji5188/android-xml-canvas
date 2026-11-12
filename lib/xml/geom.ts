// lib/xml/geom.ts — 渲染模型上的几何小工具（从 components/XmlEditor.tsx 抽出）
//
// 这两个是纯函数，之前被塞进 5000+ 行的组件体里，既拖长了文件，
// 又让「组件内部定义、组件前面调用」这种 hoisting 依赖变得难读。

import type { ResolvedNode } from "./types";
import type { CBox } from "./autoconstrain";

/** style 里的 "123px" / 123 → 数字；百分比、auto 返回 null */
export function pxNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (/^-?[0-9.]+$/.test(s)) return parseFloat(s);
  const m = /^(-?[0-9.]+)px$/.exec(s);
  return m ? parseFloat(m[1]) : null;
}

/** 从渲染模型取绝对盒子（仅当 style 里有 px 定位，即 ConstraintLayout 子项） */
export function boxOf(n: ResolvedNode | null | undefined): CBox | null {
  if (!n) return null;
  const width = pxNum(n.style.width);
  const height = pxNum(n.style.height);
  if (width === null || height === null) return null;
  // 未约束的 CL 子项没有 left/top（按静态位置渲染）→ 当 0 处理
  const left = pxNum(n.style.left) ?? 0;
  const top = pxNum(n.style.top) ?? 0;
  return { left, top, width, height };
}
