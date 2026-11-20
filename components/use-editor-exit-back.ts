// components/use-editor-exit-back.ts — M456：编辑器最底层返回键（拆出 XmlEditor 以守 M408 行数护栏）
//
// 入口页模式（onExit 传了）时，按安卓返回键：
//   有未保存 → leaveGuard.gate 弹「保存并继续 / 不保存 / 取消」，保存或放弃后才回项目列表
//   干净     → 直接 onExit。非入口模式不注册，保持旧行为（原生 canGoBack/finish）。
//
// 壳里只留 1 行挂载：`const { leaveGuardRef, dirtyRef } = useEditorExitBack(onExit);`
// 返回键触发前把创建后的 leaveGuard/dirty 写进返回的 ref（渲染时同步，触发时读最新）。
// 注册顺序关键：壳必须在「浮层 guard 之前」调用本 hook（back-stack 后进先出），返回键才先关面板。
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { registerBack } from "@/lib/ui/back-stack";

type LeaveGuard = { gate: (dirty: boolean, action: () => void) => void };

export interface EditorExitBackRefs {
  /** 壳里 leaveGuard 创建后：`leaveGuardRef.current = leaveGuard;` */
  leaveGuardRef: RefObject<LeaveGuard | null>;
  /** 壳里 dirty 算出后：`dirtyRef.current = () => dirty;` */
  dirtyRef: RefObject<() => boolean>;
}

export function useEditorExitBack(onExit?: () => void): EditorExitBackRefs {
  const leaveGuardRef = useRef<LeaveGuard | null>(null);
  const dirtyRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    if (!onExit) return;
    return registerBack(() => {
      leaveGuardRef.current?.gate(dirtyRef.current(), onExit);
    }, "exit-editor");
  }, [onExit, leaveGuardRef, dirtyRef]);

  return { leaveGuardRef, dirtyRef };
}
