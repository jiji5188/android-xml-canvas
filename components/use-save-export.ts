// components/use-save-export.ts — M366 step13（路线 2 拆解）：打开文件 / 保存 / 导出域
//
// 从 XmlEditor.tsx 抽出（原 ~1626-1734 区域）：
//   openProject / openProjectFile（打开 .xml）/
//   doDownload（导出布局 XML）/ currentSaveInput（四条保存路径共用的落盘输入）
//
// deps-getter + 延迟 Proxy（与 use-canvas-ops.ts 同款）。纯 lib 直接 import。
"use client";

import { useEffect, useMemo, useRef } from "react";
import { t as tt } from "@/lib/i18n-src";
import { activeFile, type Project } from "@/lib/xml/multi-file";
import { downloadLayout, type SaveInput } from "@/lib/xml/save-flow";
import type { ResourceExtras } from "@/lib/xml/resdir";
import type { ExportMode } from "./ExportCheckModal";

/** 与壳内 saveOrigin state 同形的联合类型 */
type SaveOriginT =
  | { kind: "native"; target: string; name: string }
  | { kind: "handle"; handle: unknown; name: string }
  | null;

export interface SaveExportDeps {
  // 打开文件
  leaveGuard: { gate: (dirty: boolean, fn: () => void) => void };
  dirty: boolean;
  pickXmlFile: () => Promise<{ text: string; name: string; handle: unknown } | null>;
  loadXmlFile: (f: File) => void;
  setSaveOrigin: React.Dispatch<React.SetStateAction<SaveOriginT>>;
  // 提示
  setExportNote: (v: string) => void;
  flashNote: (msg: string, ms?: number) => void;
  // 导出
  codeOnly: boolean;
  downloadLayout: (input: SaveInput) => { native?: boolean; name: string };
  workspaceLabel: () => string;
  // currentSaveInput
  currentXml: () => string;
  exportMode: ExportMode;
  saveOrigin: SaveOriginT;
  project: Project;
  generatedDrawables: Record<string, string>;
  resExtrasAll: ResourceExtras | null;
  appIconRes: Record<string, string>;
}

export interface SaveExportResult {
  openProject: () => void;
  openProjectFile: () => void;
  doDownload: () => void;
  currentSaveInput: (name?: string) => SaveInput;
}

export function useSaveExport(getDeps: () => SaveExportDeps): SaveExportResult {
  const depsRef = useRef<SaveExportDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as SaveExportDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 当前 xml → 落盘输入（四条保存路径共用） */
  const currentSaveInput = (name?: string): SaveInput => ({
    xml: D.currentXml(),
    mode: D.exportMode,
    name: name || D.saveOrigin?.name || activeFile(D.project)?.name || "activity_main.xml",
    generatedDrawables: D.generatedDrawables,
    extras: D.resExtrasAll,
    extraRes: D.appIconRes,
  });

  const openProjectFile = () => {
    // M21：浏览器支持 File System Access 时带句柄打开 → 之后「保存」能写回原路径
    void (async () => {
      const picked = await D.pickXmlFile();
      if (picked) {
        const fake = new File([picked.text], picked.name, { type: "text/xml" });
        D.loadXmlFile(fake);
        D.setSaveOrigin({ kind: "handle", handle: picked.handle, name: picked.name });
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xml";
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) {
          D.setSaveOrigin(null); // 普通 <input> 拿不到写句柄
          D.loadXmlFile(f);
        }
      };
      input.click();
    })();
  };

  const openProject = () => D.leaveGuard.gate(D.dirty, () => openProjectFile());

  /** M3：生成正式 Android 布局 XML 并下载。导出前检查：结构错误阻断；语义提示允许忽略继续
   *  M2s：改成可视化检查面板（不再用 alert/confirm） */
  const doDownload = () => {
    if (D.codeOnly) {
      D.flashNote(tt("当前文件不是布局，不能导出为布局 XML；直接「保存」就行"), 4600);
      return;
    }
    const r = D.downloadLayout(currentSaveInput("activity_main.xml"));
    D.setExportNote(
      r.native ? tt("已保存 {name}（{dir}）", { name: r.name, dir: D.workspaceLabel() || tt("工作目录") }) : tt("已导出 {name}", { name: r.name }),
    );
    window.setTimeout(() => D.setExportNote(""), 2400);
  };

  return { openProject, openProjectFile, doDownload, currentSaveInput };
}
