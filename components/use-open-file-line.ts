// components/use-open-file-line.ts — M445：构建日志错误定位 → 打开文件并跳到行
//
// 从 XmlEditor.tsx 抽出（行数护栏 M408：主文件只留挂载）。
// 与 ResourcePanel.onOpenFile 同逻辑：native 项目用 rootPath 拼绝对路径，
// web 项目 loadEntry 按 rel 打开；已是当前文件则只跳行。
"use client";

import type { ProjectSource, BrowseEntry } from "@/lib/xml/project-browse";

export interface OpenFileLineDeps {
  /** 当前活跃项目的 source（null = 没打开项目目录） */
  activeProject: { source?: ProjectSource | null } | null | undefined;
  /** 当前打开的文件 rel */
  openRel: string | null;
  /** 打开项目内文件（同 useProjectOps.loadEntry） */
  loadEntry: (source: ProjectSource, entry: BrowseEntry) => Promise<void>;
  /** 跳到当前文件的指定行 */
  jumpToCodeLine: (line: number) => void;
  /** 底部提示 */
  setExportNote: (v: string) => void;
  /** i18n */
  tt: (key: string, vars?: Record<string, string | number>) => string;
}

/** 返回 (rel, line) => void：打开 rel 文件并跳到 line（line<=0 只打开不跳） */
export function makeOpenFileLine(D: OpenFileLineDeps): (rel: string, line: number) => void {
  return (rel, line) => {
    const src = D.activeProject?.source;
    if (!src) {
      D.setExportNote(D.tt("先打开一个项目目录，才能跳转到构建错误位置"));
      window.setTimeout(() => D.setExportNote(" "), 3000);
      return;
    }
    if (D.openRel === rel) {
      if (line > 0) D.jumpToCodeLine(line);
      return;
    }
    const rootPath = src.rootPath;
    // native 路径分隔符用 /（Linux/Android）
    const target = rootPath ? rootPath.replace(/[\\/]+$/, "") + "/" + rel : undefined;
    void D.loadEntry(src, { kind: "file", name: rel.split("/").pop() || rel, rel, target }).then(() => {
      if (line > 0) D.jumpToCodeLine(line);
    });
  };
}
