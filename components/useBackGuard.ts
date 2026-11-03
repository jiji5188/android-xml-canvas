"use client";
// components/useBackGuard.ts — 浮层接入安卓返回键的 React 钩子（M100）
//
// 用法：useBackGuard(open, () => setOpen(false))
//   open=true 时注册，back 一次就调用 onBack（相当于点了「取消/关闭」）
//   多条同时为 true 时，后注册的优先（即视觉上盖在上面的那个）

import { useEffect, useRef } from "react";
import { registerBack } from "@/lib/ui/back-stack";

export function useBackGuard(open: boolean, onBack: () => void, label?: string): void {
  const ref = useRef(onBack);
  const labelRef = useRef(label);
  labelRef.current = label;

  // 每次渲染同步最新回调，避免闭包里拿到旧 state
  useEffect(() => {
    ref.current = onBack;
  });

  useEffect(() => {
    if (!open) return;
    return registerBack(() => ref.current(), labelRef.current);
  }, [open]);
}
