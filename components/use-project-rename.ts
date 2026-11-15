// components/use-project-rename.ts — M311：从 XmlEditor.tsx 抽出的「改项目名 / 改应用名」域
// renameWsProject：真改目录（native only）+ 同步 settings.gradle / themes.xml / AndroidManifest.xml

"use client";

import { useCallback } from "react";
import {
  dirNameOf,
  readAppName,
  readThemeName,
  renameProjectDirNative,
  renameThemeDef,
  renameThemeRef,
  replaceTailDir,
  setAppName,
  setRootProjectName,
} from "@/lib/xml/project-rename";
import { safeProjectName } from "@/lib/xml/new-project";
import { projectSourceFromWorkspaceItem, nativeProjectSource } from "@/lib/xml/project-browse";
import { projectSaveRoot, saveProjectFile } from "@/lib/xml/project-save";
import { invalidateNativeProjectCache, type WsProject } from "@/lib/xml/workspace";
import { t as tt } from "@/lib/i18n-src";

export interface ProjectRenameDeps {
  activeProjectRef: { current: { name: string; rootPath?: string; dirPath?: string } | null };
  setActiveProject: (v: any) => void;
  setProjectRev: (v: any) => void;
  setProject: (v: any) => void;
}

export function useProjectRename(d: ProjectRenameDeps) {
  const { activeProjectRef, setActiveProject, setProjectRev, setProject } = d;

  /** M176：改项目名称（目录名）与 app 名称（strings.xml 的 app_name）。
   *  路径约定 工作目录/<项目名>/app/src/... —— 改项目名要真改目录（native only），
   *  并同步 settings.gradle 的 rootProject.name、themes.xml 的 Theme.XXX、manifest 的 @style 引用。 */
  const renameWsProject = useCallback(
    async (item: WsProject, rawDirName: string, rawAppName: string): Promise<{ ok: boolean; msg: string }> => {
      if (item.kind !== "dir") return { ok: false, msg: tt("只有目录项目能改名") };
      const oldDir = item.name;
      const newDir = safeProjectName(rawDirName || oldDir);
      const newApp = (rawAppName || "").trim();
      const dirChanged = newDir !== oldDir;
      if (!dirChanged && !newApp) return { ok: false, msg: tt("名称不能为空") };

      const src = await projectSourceFromWorkspaceItem(item);
      if (!src) return { ok: false, msg: tt("读不到项目内容") };

      // 1. 先把要改的文件读出来（改名前后路径不同，统一事前读）
      const readOne = async (rel: string): Promise<string | null> => {
        try {
          return await src.readText(rel);
        } catch {
          return null;
        }
      };
      const stringsRel = "app/src/main/res/values/strings.xml";
      const themesRel = "app/src/main/res/values/themes.xml";
      const manifestRel = "app/src/main/AndroidManifest.xml";
      const settingsRel = "settings.gradle";

      const stringsSrc = await readOne(stringsRel);
      const themesSrc = await readOne(themesRel);
      const manifestSrc = await readOne(manifestRel);
      const settingsSrc = await readOne(settingsRel);

      const oldTheme = themesSrc ? readThemeName(themesSrc) : null;
      const newTheme = dirChanged ? `Theme.${newDir}` : oldTheme;

      const writes: { rel: string; text: string }[] = [];
      if (stringsSrc && newApp && readAppName(stringsSrc) !== newApp) {
        writes.push({ rel: stringsRel, text: setAppName(stringsSrc, newApp) });
      }
      if (dirChanged) {
        if (settingsSrc) {
          const t = setRootProjectName(settingsSrc, newDir);
          if (t !== settingsSrc) writes.push({ rel: settingsRel, text: t });
        }
        if (themesSrc && oldTheme && newTheme) {
          const t = renameThemeDef(themesSrc, oldTheme, newTheme);
          if (t !== themesSrc) writes.push({ rel: themesRel, text: t });
        }
        if (manifestSrc && oldTheme && newTheme) {
          const t = renameThemeRef(manifestSrc, oldTheme, newTheme);
          if (t !== manifestSrc) writes.push({ rel: manifestRel, text: t });
        }
      }

      // 2. 目录改名（web 没有 rename API → 只能改 app 名）
      let base = item.dirPath || "";
      let renamed = false;
      if (dirChanged) {
        if (!base.startsWith("/")) {
          return { ok: false, msg: tt("网页版不支持改项目目录名，请在 APK 里操作（app 名称可以改）") };
        }
        const wsRoot = replaceTailDir(base, "");
        const r = renameProjectDirNative(wsRoot.replace(/\/+$/, ""), oldDir, newDir);
        if (!r.ok) return { ok: false, msg: tt("目录改名失败：{msg}", { msg: r.reason || tt("未知错误") }) };
        base = r.newRoot || replaceTailDir(base, newDir);
        renamed = true;
        invalidateNativeProjectCache();
      }

      // 3. 写回同步过的文件
      const root: ReturnType<typeof projectSaveRoot> = base.startsWith("/")
        ? { kind: "native", base }
        : item.handle
          ? { kind: "handle", handle: item.handle }
          : null;
      if (!root) return { ok: renamed, msg: renamed ? tt("目录已改名，但读不到写入根，gradle/主题没同步") : tt("读不到项目目录") };

      const failed: string[] = [];
      for (const w of writes) {
        const ok = await saveProjectFile(root, w.rel, w.text);
        if (!ok) failed.push(w.rel);
      }

      // 4. 当前正打开这个项目 → 同步 activeProject（否则结构树还指旧路径）
      const cur = activeProjectRef.current;
      const curDir = cur?.rootPath ? dirNameOf(cur.rootPath) : cur?.name;
      if (renamed && curDir === oldDir) {
        setActiveProject((prev: any) =>
          prev
            ? {
                ...prev,
                name: newDir,
                dirPath: base,
                rootPath: base,
                source: nativeProjectSource(newDir, [], base),
              }
            : prev,
        );
        setProjectRev((n: number) => n + 1);
      }
      if (newApp) setProject((prev: any) => ({ ...prev, name: newApp }));

      const parts: string[] = [];
      if (renamed) parts.push(tt("目录 → {name}", { name: newDir }));
      if (newApp) parts.push(tt("应用名 → {name}", { name: newApp }));
      const msg = failed.length
        ? tt("已改 {list}，但 {n} 个文件没写进去（{first}）", {
            list: parts.join(tt("、")),
            n: failed.length,
            first: failed[0],
          })
        : tt("已改 {list}", { list: parts.join(tt("、")) });
      return { ok: failed.length === 0, msg };
    },
    [activeProjectRef, setActiveProject, setProject, setProjectRev],
  );

  return { renameWsProject };
}
