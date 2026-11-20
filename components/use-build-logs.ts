// components/use-build-logs.ts — M366（路线 2 拆解）：构建/运行日志 + 底部抽屉状态
//
// 从 XmlEditor.tsx 抽出（原 2604-2640 区域）：
//   buildLogs / apkForceView / runtimeLogs / drawerOpen + 运行日志桥订阅 + clearRuntimeLogsCb + pushApkBuildLog
// 无外部依赖，纯搬移，行为不变。
"use client";

import { useCallback, useEffect, useState } from "react";
import { installRuntimeLogBridge, subscribeRuntimeLog, clearRuntimeLog, type RuntimeLogEntry } from "@/lib/xml/runtime-log";
import { nativeAvailable } from "@/lib/xml/native-save";
import { useSoftKeyboard } from "./use-soft-keyboard";

export interface BuildLogEntry {
  id: string;
  ok: boolean;
  stage?: string;
  ms?: number;
  log?: string;
  logFile?: string;
  files?: number;
  bytes?: number;
  /** M440：日志类型——build（默认，进「构建日志」tab）/ debug（Java 调试运行，进「运行日志」tab） */
  kind?: "build" | "debug";
}

export interface BuildLogsState {
  /** M188b：构建日志（真机渲染 pipeline，新在前），给底部抽屉「构建日志」tab */
  buildLogs: BuildLogEntry[];
  setBuildLogs: React.Dispatch<React.SetStateAction<BuildLogEntry[]>>;
  /** M252：打包（APK）完成后，把日志推进抽屉并自动打开到「构建日志」tab */
  apkForceView: { open: boolean; tab: "problems" | "build-log" | "runtime" } | null;
  setApkForceView: React.Dispatch<React.SetStateAction<{ open: boolean; tab: "problems" | "build-log" | "runtime" } | null>>;
  /** M288：运行日志（被打出来的 App 通过广播发到编辑器的） */
  runtimeLogs: RuntimeLogEntry[];
  setRuntimeLogs: React.Dispatch<React.SetStateAction<RuntimeLogEntry[]>>;
  /** M256：抽屉展开状态（手机端代码区要腾出高度，别被遮） */
  drawerOpen: boolean;
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** M438b：软键盘弹起中（只在原生壳检测；APK 弹输入法 → 抽屉收起 + 悬浮错误面板隐藏） */
  kbHide: boolean;
  clearRuntimeLogsCb: () => void;
  /** M366：构建日志条目进 buildLogs 列表（新在前，留 20 条），并自动打开抽屉到「构建日志」tab */
  pushApkBuildLog: (entry: BuildLogEntry) => void;
  /** M440：Java 调试日志进 buildLogs（不弹抽屉，只亮角标）：
   *   kind="build" → 「构建日志」tab（调试编译日志，跟打包编译日志同性质）；
   *   kind="debug" → 「运行日志」tab（调试运行输出，跟 App 运行日志同性质）。 */
  pushDebugLog: (entry: Omit<BuildLogEntry, "kind">, kind?: "build" | "debug") => void;
}

export function useBuildLogs(): BuildLogsState {
  const [buildLogs, setBuildLogs] = useState<BuildLogEntry[]>([]);
  const [apkForceView, setApkForceView] = useState<{ open: boolean; tab: "problems" | "build-log" | "runtime" } | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);
  useEffect(() => {
    installRuntimeLogBridge();
    const unsub = subscribeRuntimeLog((entries) => setRuntimeLogs([...entries].reverse()));
    return () => {
      unsub();
    };
  }, []);
  const clearRuntimeLogsCb = useCallback(() => {
    clearRuntimeLog();
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** M438b：软键盘检测（visualViewport 缩水 + focusin 双路，web 不启用零开销）；
   *  抽屉状态归这里管，键盘检测结果跟它一起发出去，XmlEditor 不再重复挂监听。 */
  const kbHide = useSoftKeyboard(nativeAvailable());
  const pushApkBuildLog = useCallback(
    (entry: BuildLogEntry) => {
      setBuildLogs((prev) => [entry, ...prev].slice(0, 20));
      setApkForceView({ open: true, tab: "build-log" });
    },
    [],
  );
  /** M440：Java 调试日志 → buildLogs（不主动弹抽屉，只亮 tab 角标）
   *  kind="build"（默认）→ 「构建日志」tab；kind="debug" → 「运行日志」tab */
  const pushDebugLog = useCallback(
    (entry: Omit<BuildLogEntry, "kind">, kind: "build" | "debug" = "build") => {
      const withKind: BuildLogEntry = { ...entry, kind };
      setBuildLogs((prev) => [withKind, ...prev].slice(0, 20));
    },
    [],
  );

  return {
    buildLogs,
    setBuildLogs,
    apkForceView,
    setApkForceView,
    runtimeLogs,
    setRuntimeLogs,
    drawerOpen,
    setDrawerOpen,
    kbHide,
    clearRuntimeLogsCb,
    pushApkBuildLog,
    pushDebugLog,
  };
}
