// components/use-project-create.ts — M310：从 XmlEditor.tsx 抽出的「新建项目」域
// createNewProject：校验包名 → 切应用内状态 → native/web 双路落盘（含同名/权限/写不进的友好提示）

"use client";

import { useCallback } from "react";
import { createProject } from "@/lib/xml/multi-file";
import {
  createAndroidProject,
  safeProjectName,
  validatePackageName,
} from "@/lib/xml/new-project";
import { wsInfo } from "@/lib/xml/workspace";
import {
  nativeNewProjectIO,
  webNewProjectIO,
  nativeVerifyProject,
} from "@/lib/xml/new-project-io";
import { nativeProjectSource } from "@/lib/xml/project-browse";
import { t as tt } from "@/lib/i18n-src";

export interface ProjectCreateDeps {
  setExportNote: (v: string) => void;
  setProject: (v: any) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  setSelectedPath: (v: any) => void;
  setSaveOrigin: (v: any) => void;
  setActiveProject: (v: any) => void;
  setProjectTab: (v: any) => void;
  setNewProjOpen: (v: any) => void;
  setNewProjBusy: (v: any) => void;
  newProjIcon: { dataUrl: string; base64: string; mime: string } | null;
  setNewProjIcon: (v: any) => void;
  refreshWorkspace: (opts?: { quiet?: boolean }) => Promise<void>;
}

export function useProjectCreate(getDeps: () => ProjectCreateDeps) {
  const createNewProject = useCallback(
    async (rawName: string, pkg?: string) => {
      const d = getDeps();
      const name = safeProjectName(rawName);
      const pkgErr = validatePackageName(pkg ?? "");
      if (pkgErr) {
        d.setExportNote(tt(pkgErr));
        window.setTimeout(() => d.setExportNote(" "), 4000);
        return;
      }
      const finalPkg = pkg!.trim();
      const tpl = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"',
        '    android:layout_width="match_parent"',
        '    android:layout_height="match_parent"',
        '    android:gravity="center"',
        '    android:orientation="vertical">',
        "",
        "    <TextView",
        '        android:id="@+id/tv_hello"',
        '        android:layout_width="wrap_content"',
        '        android:layout_height="wrap_content"',
        `        android:text="Hello ${name}!"`,
        '        android:textSize="20sp" />',
        "",
        "</LinearLayout>",
        "",
      ].join("\n");

      // 先把应用内状态切过去（落盘失败也不影响继续编辑）
      d.setProject((p: any) => ({ ...createProject(name, { name: "activity_main.xml", xml: tpl }), name }));
      d.setXmlAndTrack(tpl);
      d.setSelectedPath(null);
      d.setSaveOrigin(null);
      d.setActiveProject({ name, source: null });
      d.setProjectTab("current");
      d.setNewProjOpen(false);

      // M31i：落盘。native 用默认工作目录（绝对路径）；用户曾自选目录时 Bridge 只能写默认目录，
      // web 用已授权的工作目录句柄；SAF 自选目录写不了，只能保留应用内项目
      d.setNewProjBusy(true);
      const icon = d.newProjIcon;
      d.setNewProjIcon(null);
      let io: ReturnType<typeof nativeNewProjectIO> | (Awaited<ReturnType<typeof webNewProjectIO>>) | null;
      let usedNativeDefault = false;
      let customNote = "";
      let nativeRoot = "";
      try {
        // M35：不依赖可能滞后的 wsState，直接用刚查的 wsInfo；native 时即便 custom 也写默认目录
        const info = await wsInfo();
        if (info.mode === "native" && info.defaultPath) {
          io = nativeNewProjectIO(info.defaultPath, name);
          usedNativeDefault = true;
          nativeRoot = info.defaultPath;
          if (info.custom) customNote = tt("（你自选过工作目录，但原生桥只能写默认目录，项目建在 AndroidUIIDE/Project 下）");
          if (!info.allFiles) customNote += tt(" 未拿到「所有文件访问」权限，可能写不进去");
        } else if (info.mode === "web") {
          io = await webNewProjectIO(name);
        } else {
          io = null;
        }

        if (!io) {
          d.setExportNote(
            tt("已新建项目《{name}》（仅应用内）{note}· 当前目录不支持直接写入，点「保存」可导出文件", {
              name,
              note: customNote,
            }),
          );
          window.setTimeout(() => d.setExportNote(" "), 5200);
          d.setNewProjBusy(false);
          return;
        }

        // M176：已有同名项目目录 → 不覆盖，要求换名（之前会落进同一个 app/ 目录，造成重名无效）
        if (usedNativeDefault) {
          const exist = nativeVerifyProject(nativeRoot, name);
          if (exist > 0) {
            d.setExportNote(tt("工作目录里已有名为《{name}》的项目，请换个项目名（否则会写进同一目录）", { name }));
            window.setTimeout(() => d.setExportNote(" "), 7000);
            d.setNewProjBusy(false);
            return;
          }
        }

        const res = await createAndroidProject(io, name, {
          iconBase64: icon?.base64,
          iconMime: icon?.mime,
          pkg: finalPkg,
        });
        // M35：native 落盘后再 listDir 验一层，确认真的写进去了（没权限/失败时 0）
        if (usedNativeDefault) {
          const dirCount = nativeVerifyProject(nativeRoot, name);
          if (dirCount === 0) {
            d.setExportNote(
              tt("《{name}》工程已生成但目录里没写进任何文件{note}。请确认已授予「所有文件访问」权限", {
                name,
                note: customNote,
              }),
            );
            window.setTimeout(() => d.setExportNote(" "), 7000);
            d.setNewProjBusy(false);
            return;
          }
        }
        if (res.ok) {
          d.setExportNote(
            tt("已创建《{name}》· {n} 个文件已写入 {dir}/{note}", {
              name,
              n: res.written,
              dir: name + "/app/src/main/",
              note: customNote,
            }),
          );
          // M46c：新建项目也要带上目录根，否则结构树写操作（重命名/移动/删除）全被置灰
          if (usedNativeDefault) {
            const projDir = `${nativeRoot.replace(/\/+$/, "")}/${name}`;
            d.setActiveProject((prev: { dirPath?: string; rootPath?: string; source: unknown; name?: string } | null) =>
              prev
                ? {
                    ...prev,
                    dirPath: projDir,
                    rootPath: projDir,
                    source: nativeProjectSource(name, [], projDir),
                  }
                : prev,
            );
          }
          window.setTimeout(() => void d.refreshWorkspace({ quiet: true }), 400);
        } else {
          d.setExportNote(
            tt("《{name}》已创建，但有 {n} 个文件没写进去（{first} 等）{note}", {
              name,
              n: res.failed.length,
              first: res.failed[0],
              note: customNote,
            }),
          );
        }
      } catch (e) {
        d.setExportNote(
          tt("《{name}》已创建，落盘失败：{msg}", {
            name,
            msg: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        d.setNewProjBusy(false);
        window.setTimeout(() => d.setExportNote(" "), 5200);
      }
    },
    [getDeps],
  );

  return { createNewProject };
}
