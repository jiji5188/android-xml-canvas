// components/use-export-actions.ts — M366 step19（路线 2 拆解）：导出/保存动作域
//
// 从 XmlEditor.tsx 抽出（原 ~1553-1627 区域）：
//   confirmSaveAs / buildReport / applyExportMode / saveProject / doCopy / copyExportedXml
//
// 全部是事件回调（不在渲染期求值）→ 用 deps-getter + 延迟 Proxy，安全。
"use client";

import { useMemo, useRef, useEffect } from "react";
import { exportLayoutXml, exportChecks } from "@/lib/xml/export";
import { lintXml } from "@/lib/xml/lint";
import { toCompatXml } from "@/lib/xml/compat";
import { fixNamespacePrefixes } from "@/lib/xml/namespace";
import type { ExportMode, ExportReport } from "./ExportCheckModal";

export interface ExportActionsDeps {
  saveAsName: string;
  setSaveAsOpen: (v: boolean) => void;
  saveAsTo: (name: string) => Promise<boolean> | Promise<void>;
  exportMode: ExportMode;
  setExportMode: (m: ExportMode) => void;
  xml: string;
  setCompatNotes: (notes: string[]) => void;
  flashNote: (msg: string, ms?: number) => void;
  tt: (s: string, v?: Record<string, string>) => string;
  codeOnly: boolean;
  setExportAction: (a: "download" | "copy") => void;
  setExportReport: (r: ExportReport) => void;
  setExportOpen: (v: boolean) => void;
  setExportNote: (s: string) => void;
  copyTextNative: (text: string) => boolean;
  doDownload: () => void;
  flushXml: () => void;
}

export interface ExportActionsResult {
  confirmSaveAs: () => Promise<void>;
  buildReport: (mode?: ExportMode) => ExportReport;
  applyExportMode: (m: ExportMode) => void;
  saveProject: () => void;
  doCopy: () => Promise<void>;
  copyExportedXml: () => void;
}

export function useExportActions(getDeps: () => ExportActionsDeps): ExportActionsResult {
  const depsRef = useRef<ExportActionsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as ExportActionsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const confirmSaveAs = async () => {
    const raw = D.saveAsName.trim() || "activity_main.xml";
    const name = /\.xml$/i.test(raw) ? raw : `${raw}.xml`;
    D.setSaveAsOpen(false);
    await D.saveAsTo(name);
  };

  const buildReport = (mode: ExportMode = D.exportMode): ExportReport => {
    // M13：报告基于「真正要导出的内容」算——兼容模式下 CL 约束/库属性都已消失，
    // 拿原始 xml 算会把已不存在的项报成错误
    const body = exportLayoutXml(D.xml, { mode });
    const check = exportChecks(body);
    const lint = lintXml(body);
    if (mode === "compat") {
      const compat = toCompatXml(fixNamespacePrefixes(D.xml));
      D.setCompatNotes(compat.notes);
    }
    return {
      errors: lint.filter((i) => i.level === "error"),
      notes: check.notes,
    };
  };

  /** M13：切换导出模式（面板里点选）——立即重算报告，用户能看到模式带来的差异 */
  const applyExportMode = (m: ExportMode) => {
    D.setExportMode(m);
    try {
      window.localStorage.setItem("axv.exportMode", m);
    } catch {
      /* ignore */
    }
    D.setExportReport(buildReport(m));
  };

  const saveProject = () => {
    D.flushXml(); // M57：先把打字中的最新文本落状态，保存读到的才是当前内容
    if (D.codeOnly) {
      D.flashNote(D.tt("当前文件不是布局，不能走「导出检查」；直接「保存」写回原文件即可"), 4600);
      return;
    }
    D.setExportAction("download");
    D.setExportReport(buildReport());
    D.setExportOpen(true);
  };

  /** M3：复制生成的 XML 到剪贴板（与下载同一份内容） */
  const doCopy = async () => {
    const body = exportLayoutXml(D.xml, { mode: D.exportMode });
    // 原生壳里先走 ClipboardManager（WebView 的 navigator.clipboard 不可靠）
    if (D.copyTextNative(body)) {
      D.setExportNote(D.tt("已复制到剪贴板"));
      window.setTimeout(() => D.setExportNote(""), 2600);
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      D.setExportNote(D.tt("已复制到剪贴板"));
    } catch {
      // 剪贴板 API 不可用（非 https / 旧浏览器）时退化成保存
      D.doDownload();
      D.setExportNote(D.tt("剪贴板不可用，已改为保存文件"));
    }
    window.setTimeout(() => D.setExportNote(""), 2600);
  };

  const copyExportedXml = () => {
    D.setExportAction("copy");
    D.setExportReport(buildReport());
    D.setExportOpen(true);
  };

  return { confirmSaveAs, buildReport, applyExportMode, saveProject, doCopy, copyExportedXml };
}
