// components/use-inspector.ts — M366 step15（路线 2 拆解）：右侧「检查器」tab 域
//
// 从 XmlEditor.tsx 抽出（原 ~1418-1454 区域）：
//   rightTab（属性/检查器 tab）/ inspMeasured（DOM 实测 → dp）/ ResizeObserver effect /
//   inspWarnings
//
// 纯 DOM 测量 + 两个 lib 纯函数（collectMeasurements / inspectorWarningsOf）。
// 依赖壳的 stageRef/phoneRef（useRef）+ treeRoot/previewActive/scale（derived）+ SCALE（本地 const）。
"use client";

import { useEffect, useMemo, useState } from "react";
import { collectMeasurements, inspectorWarningsOf, type MeasuredNode } from "@/lib/xml/inspector";
import type { XmlNode } from "@/lib/xml/types";

export interface InspectorInput {
  stageRef: React.MutableRefObject<HTMLElement | null>;
  phoneRef: React.MutableRefObject<HTMLElement | null>;
  treeRoot: XmlNode | null;
  previewActive: boolean;
  scale: number;
  /** 壳本地 1dp=2px（非 import） */
  SCALE: number;
}

export interface InspectorResult {
  rightTab: "attrs" | "inspector";
  setRightTab: (v: "attrs" | "inspector") => void;
  inspMeasured: MeasuredNode[];
  inspWarnings: ReturnType<typeof inspectorWarningsOf>;
}

export function useInspector({
  stageRef, phoneRef, treeRoot, previewActive, scale, SCALE,
}: InspectorInput): InspectorResult {
  /** M186：右侧面板当前页签（属性 / 检查器） */
  const [rightTab, setRightTab] = useState<"attrs" | "inspector">("attrs");
  /** M186：右侧「检查器」tab 数据（DOM 实测 → dp，纯函数在 lib/xml/inspector.ts） */
  const [inspMeasured, setInspMeasured] = useState<MeasuredNode[]>([]);
  useEffect(() => {
    const st = stageRef.current;
    if (!st || !treeRoot || !previewActive) {
      setInspMeasured([]);
      return;
    }
    const take = () => {
      const els = st.querySelectorAll<HTMLElement>("[data-path]");
      // M187：dp = 视觉 px ÷ (SCALE × vs)，两层就够
      //   ① SCALE：1dp = 2px（用户缩放 scale 已经算进布局 px 里了，别再除一次）
      //   ② vs = 视觉宽 ÷ 布局宽 = 手机外壳 transform: scale(fitRatio) 的压缩比，实测比自己推 fitRatio 稳
      // 原点用 .axv-phone-body：量的是「相对画布内容区左上角」，不是含留白的整个 stage
      const body = st.querySelector<HTMLElement>(".axv-phone-body");
      const ref = body && body.offsetWidth > 0 ? body : st;
      const vs = ref.offsetWidth > 0 ? ref.getBoundingClientRect().width / ref.offsetWidth : 1;
      const pxPerDp = SCALE * (vs > 0 ? vs : 1);
      setInspMeasured(collectMeasurements(ref, els, pxPerDp, () => ""));
    };
    take();
    const obs = new ResizeObserver(take);
    obs.observe(st);
    // M187：缩放改变的是手机外壳大小（stage 容器本身不变），单独盯外壳才跟得上
    const ph = phoneRef.current;
    if (ph) obs.observe(ph);
    const t = window.setTimeout(take, 300);
    return () => {
      obs.disconnect();
      window.clearTimeout(t);
    };
    // scale 进依赖：缩放一变就重新量（ResizeObserver 是兜底）
  }, [treeRoot, previewActive, scale]);
  const inspWarnings = useMemo(
    () => (treeRoot ? inspectorWarningsOf(treeRoot, inspMeasured) : []),
    [treeRoot, inspMeasured],
  );

  return { rightTab, setRightTab, inspMeasured, inspWarnings };
}
