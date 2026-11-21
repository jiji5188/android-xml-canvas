// components/use-save-domain.ts — M312：从 XmlEditor.tsx 抽出的「保存」域
// saveIntoProject / loadDiskIntoEditor / saveBack / saveAsTo / saveRawFile / doSave
// 含 M201 外部改动拦截（conflict 弹窗的 retry/loadDisk 回调也在这里生成）

"use client";

import { useCallback } from "react";
import {
  buildSaveFiles,
  nextSaveAction,
  saveAs as saveAsBundle,
  saveBack as saveBackPure,
  type SaveInput,
} from "@/lib/xml/save-flow";
import { RES_PREFIX, readProjectFile, saveResFiles, saveProjectFile } from "@/lib/xml/project-save";
import { isManifestPath, looksLikeManifest } from "@/lib/xml/manifest-edit";
import { syncManifestGradleAfterSave } from "@/lib/xml/manifest-gradle-sync";
import { planWrite, loadBaseline, snapshotBeforeWrite, saveBaseline } from "@/lib/xml/safe-write";
import { nativeBridge, writeTextNative } from "@/lib/xml/native-save";
import { activeFile } from "@/lib/xml/multi-file";
import { t as tt } from "@/lib/i18n-src";

export interface SaveDomainDeps {
  projRoot: { kind: "native"; base: string } | { kind: "handle"; handle: unknown } | null;
  xml: string;
  saveOrigin: { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null;
  openRel: string | null;
  codeOnly: boolean;
  currentSaveInput: (name?: string) => SaveInput;
  flashNote: (msg: string, ms?: number) => void;
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  markSaved: (text: string) => void;
  activeProject: { name?: string } | null;
  project: unknown;
  bumpResCache: () => void;
  setConflict: (v: { rel: string; disk: string; mine: string; retry: () => void; loadDisk?: () => void } | null) => void;
  liveXmlRef: { current: string | null };
  docRef: { current: string };
  setXml: (v: string) => void;
  setSaveAsName: (v: string) => void;
  setSaveAsOpen: (v: boolean) => void;
}

export function useSaveDomain(getDeps: () => SaveDomainDeps) {
  const saveIntoProject = useCallback(
    async (name?: string, forceExternal = false): Promise<boolean> => {
      const d = getDeps();
      const { projRoot, xml, flashNote, markSaved, activeProject, currentSaveInput, setConflict } = d;
      if (!projRoot) return false;
      const input = currentSaveInput(name);
      const files = buildSaveFiles(input);
      /* M201：写之前先读磁盘主文件，看是不是别人在电脑上改过了。
       * 只在「我们记得上次写了什么」且「磁盘对不上」时拦，首次写不拦。 */
      const primary = files[0];
      const diskRel = primary ? `${RES_PREFIX}/${primary.path}` : "";
      if (primary && diskRel) {
        const disk = await readProjectFile(projRoot, diskRel);
        const plan = planWrite(loadBaseline(diskRel), disk, forceExternal);
        if (plan.conflict) {
          setConflict({
            rel: diskRel,
            disk: disk ?? "",
            mine: primary.text ?? "",
            retry: () => void saveIntoProject(name, true),
            loadDisk: () => loadDiskIntoEditor(disk ?? ""),
          });
          return false;
        }
        snapshotBeforeWrite(diskRel, disk, primary.text ?? "");
      }
      const r = await saveResFiles(projRoot, files);
      if (!r.ok) {
        flashNote(
          tt("写入项目失败（{reason}）。请确认「所有文件访问」已开启、项目目录可写", {
            reason: r.failed[0] || tt("未知原因"),
          }),
          5000,
        );
        return false;
      }
      flashNote(
        tt("已保存《{name}》：{n} 个文件 → app/src/main/res/", {
          name: activeProject?.name || tt("项目"),
          n: r.written,
        }) + (r.failed.length ? tt("（{n} 个失败）", { n: r.failed.length }) : ""),
        4200,
      );
      markSaved(xml);
      // M201：写成功了才更新基线（失败时不更新，下次还能发现外部改动）
      for (const f of files) saveBaseline(`${RES_PREFIX}/${f.path}`, f.text ?? "");
      return true;
    },
    [getDeps],
  );

  /** M201：用户在「文件已被外部修改」弹窗里选「载入磁盘版本」 */
  const loadDiskIntoEditor = useCallback(
    (text: string) => {
      const d = getDeps();
      d.liveXmlRef.current = null;
      d.docRef.current = text;
      d.setXml(text);
      d.markSaved(text);
      d.flashNote(tt("已载入磁盘上的版本（编辑器里的未保存改动已丢弃）"), 4600);
    },
    [getDeps],
  );

  const saveBack = useCallback(
    async (): Promise<boolean> => {
      const d = getDeps();
      const { saveOrigin, xml, tr, flashNote, markSaved, currentSaveInput } = d;
      // M36：有打开的项目 → 优先进项目 res（不依赖 saveOrigin）
      if (d.projRoot && (await saveIntoProject())) return true;
      if (!saveOrigin) return false;
      const input = currentSaveInput();
      const r = await saveBackPure(input, saveOrigin);
      if (!r.ok) return false;
      let depNote = "";
      if (r.depsWritten) depNote = tt("，依赖资源 {n} 个", { n: r.depsWritten });
      else if (r.depsTotal) {
        depNote =
          saveOrigin.kind === "native"
            ? tt("（{n} 个依赖资源没写成，请检查目录权限）", { n: r.depsTotal })
            : tt("；另有 {n} 个依赖资源，可用「另存到文件夹」一起写出", { n: r.depsTotal });
      }
      flashNote(tr("save.doneBack", "已保存 {name}（原路径）", { name: input.name }) + depNote, 4200);
      markSaved(xml);
      return true;
    },
    [getDeps, saveIntoProject],
  );

  /** 另存：走系统文件夹选择器，按 res 结构整包写 */
  const saveAsTo = useCallback(
    async (name: string): Promise<boolean> => {
      const d = getDeps();
      const { xml, tr, flashNote, markSaved, currentSaveInput } = d;
      const r = await saveAsBundle(currentSaveInput(name));
      if (r.ok) {
        flashNote(
          tr("save.doneAs", "已保存到「{dir}」：{n} 个文件（含依赖资源）", {
            dir: r.label || tt("所选文件夹"),
            n: r.count ?? 0,
          }),
          5000,
        );
        markSaved(xml);
        return true;
      }
      if (r.canceled) {
        flashNote(tr("save.canceled", "已取消保存"));
        return false;
      }
      flashNote(tr("save.failed", "保存失败：{reason}", { reason: r.reason || "未知原因" }), 5000);
      return false;
    },
    [getDeps],
  );

  /** M462：manifest 保存成功后，把 package/versionCode/versionName 同步进 build.gradle。
   *  不是 manifest（路径和内容都看）或没有工程根 → 返回 ""。同步成功返回提示后缀。 */
  const syncManifestGradle = useCallback(
    async (xmlText: string): Promise<string> => {
      const d = getDeps();
      if (!d.projRoot) return "";
      if (!isManifestPath(d.openRel) && !looksLikeManifest(xmlText)) return "";
      try {
        const r = await syncManifestGradleAfterSave(d.projRoot, xmlText);
        if (!r.synced || !r.changed.length) return "";
        const label = r.changed.map((c) => (c === "package" ? tt("包名") : c)).join("、");
        return tt("；已同步 build.gradle：{l}", { l: label });
      } catch {
        return "";
      }
    },
    [getDeps],
  );

  /** M37b：非布局文件（manifest / values / menu …）—— 整文件原位写回，不生成任何布局/依赖资源 */
  const saveRawFile = useCallback(
    async (forceExternal = false): Promise<boolean> => {
      const d = getDeps();
      const { saveOrigin, openRel, xml, projRoot, setConflict, flashNote, markSaved, bumpResCache } = d;
      const name = saveOrigin?.name || (openRel ? openRel.split("/").pop() || "" : "") || tt("文件");
      // 1) 原生绝对路径 / content URI
      if (saveOrigin?.kind === "native") {
        /* M201：绝对路径也查一次外部改动（读不到就当首次，不拦） */
        const target = saveOrigin.target;
        let disk: string | null = null;
        try {
          disk = nativeBridge()?.readText?.(target) ?? null;
        } catch {
          disk = null;
        }
        const plan = planWrite(loadBaseline(target), disk, forceExternal);
        if (plan.conflict) {
          setConflict({
            rel: target,
            disk: disk ?? "",
            mine: xml,
            retry: () => void saveRawFile(true),
            loadDisk: () => loadDiskIntoEditor(disk ?? ""),
          });
          return false;
        }
        snapshotBeforeWrite(target, disk, xml);
        if (writeTextNative(target, xml)) {
          saveBaseline(target, xml);
          const syncNote = await syncManifestGradle(xml);
          flashNote(tt("已保存 {name}（原路径）", { name }) + syncNote, 3600);
          markSaved(xml);
          return true;
        }
        flashNote(tt("写入失败：{name} —— 请确认「所有文件访问」已开启", { name }), 5000);
        return false;
      }
      // 2) 项目可写根 + 工程内相对路径（native 拼绝对路径 / web 走目录句柄）
      if (projRoot && openRel) {
        const disk = await readProjectFile(projRoot, openRel);
        const plan = planWrite(loadBaseline(openRel), disk, forceExternal);
        if (plan.conflict) {
          setConflict({
            rel: openRel,
            disk: disk ?? "",
            mine: xml,
            retry: () => void saveRawFile(true),
            loadDisk: () => loadDiskIntoEditor(disk ?? ""),
          });
          return false;
        }
        snapshotBeforeWrite(openRel, disk, xml);
        const ok = await saveProjectFile(projRoot, openRel, xml);
        if (ok) {
          saveBaseline(openRel, xml);
          bumpResCache();
          const syncNote = await syncManifestGradle(xml);
          flashNote(tt("已保存 {name} → {rel}", { name, rel: openRel }) + syncNote, 4200);
          markSaved(xml);
          return true;
        }
        flashNote(tt("写入失败：{rel}（目录不可写？）", { rel: openRel }), 5000);
        return false;
      }
      // 3) 浏览器里打开的文件句柄
      const h = saveOrigin?.kind === "handle" ? saveOrigin.handle : null;
      if (h && typeof (h as { createWritable?: unknown }).createWritable === "function") {
        try {
          const w = await (
            h as { createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }
          ).createWritable();
          await w.write(xml);
          await w.close();
          flashNote(tt("已保存 {name}（原文件）", { name }), 3200);
          markSaved(xml);
          return true;
        } catch {
          /* 往下退 */
        }
      }
      flashNote(
        tt("没有可写回的位置：{name} —— 请用项目目录打开，或先「另存到文件夹」", { name }),
        5200,
      );
      return false;
    },
    [getDeps, syncManifestGradle],
  );

  const doSave = useCallback(async () => {
    const d = getDeps();
    const { codeOnly, projRoot, saveOrigin, tr, flashNote, project, setSaveAsName, setSaveAsOpen } = d;
    // M37b：非布局文件不拼 res 包，直接原文件写回
    if (codeOnly) {
      await saveRawFile();
      return;
    }
    // M36：优先存进当前打开的项目（<项目>/app/src/main/res/）
    if (projRoot && (await saveIntoProject())) return;
    // A) 有来源 → 直接写回原路径
    if (saveOrigin && nextSaveAction(saveOrigin) === "back") {
      if (await saveBack()) return;
      flashNote(tr("save.backFailed", "写回原文件失败，改为另存到文件夹…"), 2600);
    }
    // B) 新建文件 → 先让用户确认文件名，再选文件夹
    setSaveAsName(activeFile(project as never)?.name || "activity_main.xml");
    setSaveAsOpen(true);
  }, [getDeps, saveRawFile, saveIntoProject, saveBack]);

  return { saveIntoProject, loadDiskIntoEditor, saveBack, saveAsTo, saveRawFile, doSave };
}
