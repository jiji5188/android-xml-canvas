// components/use-export-render.ts — M313：从 XmlEditor.tsx 抽出的「导出 / 真机渲染」域
// doExportProject（整项目 zip）/ doDownloadResZip（res 包或写进项目 res）/ doRealRender（设备端 aapt2 渲染）

"use client";

import { useCallback } from "react";
import {
  buildSaveFiles,
  buildRealRenderFiles,
  downloadResZip,
} from "@/lib/xml/save-flow";
import { renderReal } from "@/lib/xml/native-render";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { exportProjectZip } from "@/lib/xml/project-export";
import { readPublishInfo } from "@/lib/xml/gradle-publish";
import { readSigningFromGradle } from "@/lib/xml/signing";
import { readAppGradle, projectSaveRoot, saveResFiles, type ProjectSaveRoot } from "@/lib/xml/project-save";
import { t as tt } from "@/lib/i18n-src";

export interface ExportRenderDeps {
  aiFileIo: unknown;
  flashNote: (msg: string, ms?: number) => void;
  activeProject: { name?: string } | null;
  setExportNote: (v: string) => void;
  codeOnly: boolean;
  projRoot: ProjectSaveRoot | null;
  currentSaveInput: (name?: string) => unknown;
  bumpResCache: () => void;
  openRel: string | null;
  realRenderBusy: boolean;
  setRealRenderBusy: (v: boolean) => void;
  setBuildLogs: (updater: any) => void;
}

export function useExportRender(getDeps: () => ExportRenderDeps) {
  const doExportProject = useCallback(async () => {
    const d = getDeps();
    const { aiFileIo, flashNote, activeProject, setExportNote } = d;
    if (!aiFileIo) {
      flashNote(tt("先打开一个项目目录，再导出"), 3200);
      return;
    }
    const name = activeProject?.name || "project";
    const found = await readAppGradle(projectSaveRoot(activeProject as never));
    const gradleTxt = found?.text ?? null;
    const info = gradleTxt ? readPublishInfo(gradleTxt) : null;
    const sign = gradleTxt ? readSigningFromGradle(gradleTxt) : null;
    setExportNote(tt("正在打包项目…"));
    try {
      const r = await exportProjectZip({
        io: aiFileIo as never,
        projectName: name,
        pkg: info?.applicationId || info?.namespace || null,
        versionName: info?.versionName || null,
        storeFile: sign?.storeFile || null,
        alias: sign?.alias || null,
      });
      if (!r.ok) {
        setExportNote(tt("导出失败：{reason}", { reason: r.error || "未知错误" }));
        return;
      }
      setExportNote(
        tt("已导出 {name}（{n} 个文件，{mb} MB）", {
          name: r.filename || "",
          n: r.files,
          mb: (r.bytes / 1024 / 1024).toFixed(2),
        }) +
          (r.skipped.length ? tt("；跳过 {n} 项（见包内「跳过文件清单.txt」）", { n: r.skipped.length }) : ""),
      );
      window.setTimeout(() => setExportNote(""), 6000);
    } catch (e) {
      setExportNote(tt("导出失败：{reason}", { reason: e instanceof Error ? e.message : String(e) }));
    }
  }, [getDeps]);

  const doDownloadResZip = useCallback(() => {
    const d = getDeps();
    const { codeOnly, flashNote, projRoot, currentSaveInput, bumpResCache, setExportNote, activeProject } = d as any;
    // M37b：非布局文件没有「res 包」概念，直接阻止
    if (codeOnly) {
      flashNote(tt("当前文件不是布局，无法导出 res 包；直接「保存」写回原文件即可"), 4600);
      return;
    }
    // M36：有打开的项目 → 直接写进它的 res 目录，不再丢一个 res.zip 在工作目录根
    if (projRoot) {
      void saveResFiles(projRoot, buildSaveFiles(currentSaveInput() as never)).then(
        (r: { ok: boolean; written: number; total: number; failed: string[] }) => {
          if (r.ok && r.written > 0) bumpResCache();
          setExportNote(
            r.ok
              ? tt("已写入《{name}》的 app/src/main/res/：{n}/{total} 个文件", {
                  name: activeProject?.name || tt("项目"),
                  n: r.written,
                  total: r.total,
                }) + (r.failed.length ? tt("（失败 {n}）", { n: r.failed.length }) : "")
              : tt("写入项目失败：{reason}", { reason: r.failed[0] || tt("目录不可写") }),
          );
          window.setTimeout(() => setExportNote(""), 4800);
        },
      );
      return;
    }
    const { count, missing } = downloadResZip(currentSaveInput() as never);
    setExportNote(
      tt("已导出 res.zip（{n} 个文件）", { n: count }) +
        (missing.length
          ? tt("；还有 {n} 个 @drawable 引用未覆盖：{list}{more}（需上传 res 目录补齐）", {
              n: missing.length,
              list: missing.slice(0, 5).join(", "),
              more: missing.length > 5 ? " …" : "",
            })
          : tt("；布局里引用的图标资源已全部包含")),
    );
    window.setTimeout(() => setExportNote(""), 4200);
  }, [getDeps]);

  /** M154：真机渲染——把当前 xml + 依赖资源交给设备端 aapt2 现场编译，
   *  再用系统 LayoutInflater 渲染（不是 CSS 模拟，能对照出 canvas 的偏差）。 */
  const doRealRender = useCallback(() => {
    const d = getDeps();
    const {
      realRenderBusy,
      currentSaveInput,
      openRel,
      aiFileIo,
      setRealRenderBusy,
      setBuildLogs,
      setExportNote,
    } = d;
    if (realRenderBusy) return;
    const input = currentSaveInput();
    const name = ((input as { name?: string }).name || "activity_main.xml").replace(/\.xml$/i, "");
    const base = buildRealRenderFiles(input as never);
    setRealRenderBusy(true);
    setExportNote(tt("正在收集布局引用的资源…"));
    void collectProjectRes(aiFileIo as never, openRel, base)
      .then((collected) => {
        const stubNote = collected.stubbed?.length
          ? tt("；{n} 个资源项目里没有，已用透明占位顶住", { n: collected.stubbed.length })
          : "";
        setExportNote(
          (collected.added
            ? tt("已补齐 {n} 个项目资源，正在用设备上的 aapt2 编译…", { n: collected.added })
            : tt("正在用设备上的 aapt2 编译资源包…")) + stubNote,
        );
        return renderReal(name, collected.files);
      })
      .then((r) => {
        setRealRenderBusy(false);
        setBuildLogs((prev: any[]) =>
          [
            {
              id: String(Date.now()),
              ok: !!r.ok,
              stage: r.ok
                ? tt("真机渲染")
                : tt("真机渲染（{stage}）", { stage: r.stage || tt("未知") }),
              ms: r.ms,
              log: r.log,
              logFile: r.logFile,
              files: r.files,
              bytes: r.bytes,
            },
            ...prev,
          ].slice(0, 20),
        );
        if (r.ok) {
          setExportNote(
            tt("真机渲染：{n} 个文件 → 资源包 {kb} KB（编译 {ms} ms），已打开真控件预览\n日志：{log}", {
              n: r.files ?? 0,
              kb: Math.round((r.bytes ?? 0) / 1024),
              ms: r.ms ?? 0,
              log: r.logFile || tt("（无）"),
            }),
          );
        } else {
          setExportNote(
            tt("真机渲染失败（{stage}）：{log}\n完整日志：{file}", {
              stage: r.stage || tt("未知"),
              // M170：错误正文都在日志尾部（前面是 framework/compile 的例行行），
              // 显示尾部 700 字比显示前 300 字有用得多
              log: "…" + (r.log || "").slice(-700),
              file: r.logFile || tt("（写日志失败）"),
            }),
          );
        }
        window.setTimeout(() => setExportNote(""), r.ok ? 5200 : 12000);
      })
      .catch((e) => {
        setRealRenderBusy(false);
        setExportNote(tt("真机渲染失败：{reason}", { reason: String(e) }));
        window.setTimeout(() => setExportNote(""), 8000);
      });
  }, [getDeps]);

  return { doExportProject, doDownloadResZip, doRealRender };
}
