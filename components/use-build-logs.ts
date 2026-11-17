// components/use-build-logs.ts — M366（路线 2 拆解）：构建/运行日志 + 底部抽屉状态
//
// 从 XmlEditor.tsx 抽出（原 2604-2640 区域）：
//   buildLogs / apkForceView / runtimeLogs / drawerOpen + 运行日志桥订阅 + clearRuntimeLogsCb + pushApkBuildLog
// 无外部依赖，纯搬移，行为不变。
"use client";

import { useCallback, useEffect, useState } from "react";
import { installRuntimeLogBridge, subscribeRuntimeLog, clearRuntimeLog, type RuntimeLogEntry } from "@/lib/xml/runtime-log";

export interface BuildLogEntry {
  id: string;
  ok: boolean;
  stage?: string;
  ms?: number;
  log?: string;
  logFile?: string;
  files?: number;
  bytes?: number;
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
  clearRuntimeLogsCb: () => void;
  pushApkBuildLog: (entry: BuildLogEntry) => void;
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
  const pushApkBuildLog = useCallback(
    (entry: BuildLogEntry) => {
      setBuildLogs((prev) => [entry, ...prev].slice(0, 20));
      setApkForceView({ open: true, tab: "build-log" });
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
    clearRuntimeLogsCb,
    pushApkBuildLog,
  };
}
