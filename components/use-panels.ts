// components/use-panels.ts — M366（路线 2 拆解）：弹窗/面板 UI state 层
//
// 从 XmlEditor.tsx 抽出（原 498-532 区域）：
//   历史面板 / 工作区提示 / 新建弹窗 / 导出检查 / 并排对比 / 导出报告+模式
// 纯 UI 状态，无跨组逻辑依赖（toggleCompareDevice 的 localStorage 逻辑一起带出），行为不变。
"use client";

import { useState } from "react";
import { COMPARE_DEFAULTS } from "./ComparePreview";
import type { ExportReport, ExportMode } from "./ExportCheckModal";

export interface PanelsState {
  /** M140：历史版本快照面板 */
  histPanelOpen: boolean;
  setHistPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  snapCount: number;
  setSnapCount: React.Dispatch<React.SetStateAction<number>>;
  /** M25b：从项目目录打开的文件名（结构树里标「正在编辑」；应用内文件为空） */
  wsActiveName: string;
  setWsActiveName: React.Dispatch<React.SetStateAction<string>>;
  wsMsg: string;
  setWsMsg: React.Dispatch<React.SetStateAction<string>>;
  addModalOpen: boolean;
  setAddModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** M2s：导出前检查面板 */
  exportOpen: boolean;
  setExportOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** M165：并排对比开关 + 勾选设备（localStorage 记住） */
  compareOpen: boolean;
  setCompareOpen: React.Dispatch<React.SetStateAction<boolean>>;
  compareIds: string[];
  toggleCompareDevice: (id: string, on: boolean) => void;
  exportReport: ExportReport | null;
  setExportReport: React.Dispatch<React.SetStateAction<ExportReport | null>>;
  /** M13：导出模式，compat = 纯平台控件、AIDE 可编译 */
  exportMode: ExportMode;
  setExportMode: React.Dispatch<React.SetStateAction<ExportMode>>;
  /** 导出预览图：download / copy */
  exportAction: "download" | "copy";
  setExportAction: React.Dispatch<React.SetStateAction<"download" | "copy">>;
  dropHint: string | null;
  setDropHint: React.Dispatch<React.SetStateAction<string | null>>;
  /** 运行调试页开合 */
  runOpen: boolean;
  setRunOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function usePanels(): PanelsState {
  const [histPanelOpen, setHistPanelOpen] = useState(false);
  const [snapCount, setSnapCount] = useState(0);
  const [wsActiveName, setWsActiveName] = useState("");
  const [wsMsg, setWsMsg] = useState<string>("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("axv.compareIds");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch {
      /* 静默 */
    }
    return COMPARE_DEFAULTS;
  });
  const toggleCompareDevice = (id: string, on: boolean) => {
    setCompareIds((cur) => {
      const next = on ? [...cur, id] : cur.filter((x) => x !== id);
      const list = next.length > 0 ? next : COMPARE_DEFAULTS;
      try {
        window.localStorage.setItem("axv.compareIds", JSON.stringify(list));
      } catch {
        /* 静默 */
      }
      return list;
    });
  };
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  const [exportMode, setExportMode] = useState<ExportMode>(() => {
    try {
      return window.localStorage.getItem("axv.exportMode") === "compat" ? "compat" : "modern";
    } catch {
      return "modern";
    }
  });

  const [exportAction, setExportAction] = useState<"download" | "copy">("download");
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  return {
    histPanelOpen, setHistPanelOpen, snapCount, setSnapCount,
    wsActiveName, setWsActiveName, wsMsg, setWsMsg,
    addModalOpen, setAddModalOpen, exportOpen, setExportOpen,
    compareOpen, setCompareOpen, compareIds, toggleCompareDevice,
    exportReport, setExportReport, exportMode, setExportMode,
    exportAction, setExportAction,
    dropHint, setDropHint, runOpen, setRunOpen,
  };
}
