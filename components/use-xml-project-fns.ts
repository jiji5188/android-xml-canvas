// components/use-xml-project-fns.ts — M366 step8（路线 2 拆解）：项目管理 B 集群「函数层」
//
// 从 XmlEditor.tsx 抽出（原 ~1651-2075 区域）的 13 个项目操作函数 + activeProjectRef 的镜像
// （activeProjectRef 本体留在壳，因 useProjectRename 等仍在壳内引用，经 getter 传入）。
//
// 关键：这些函数重度依赖 A 集群（编辑核心）+ C 集群（画布）+ 壳内晚声明的 ref
//（xmlRef/projectRef 在壳 ~2949 行才定义），故用「deps-getter」模式（仓库先例 useFileImport/
// useProjectCreate）：hook 收 `() => Deps`，函数体运行时才解引用 getter，避开 TDZ + 保持壳顺序。
// 纯库函数（multi-file / project-browse / storage / history / sample-projects / i18n）直接 import，
// 不进 getter。
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { clearResIndex } from "@/lib/xml/res-index";
import { invalidateNativeProjectCache } from "@/lib/xml/workspace";
import {
  activeFile,
  updateFileXml,
  addFile,
  renameFile,
  removeFile,
  switchFile,
  type Project,
  type ProjectFile,
} from "@/lib/xml/multi-file";
import {
  findMainLayout,
  nativeProjectSource,
  readProjectMetaNative,
  readProjectMetaFromSource,
  type BrowseEntry,
  type ProjectSource,
} from "@/lib/xml/project-browse";
import {
  openProjectFolder,
  openProjectFromItem,
  restoreProjectFolder,
  type OpenedProject,
} from "@/lib/xml/project";
import { saveBaseline } from "@/lib/xml/safe-write";
import { writeLastRel, readLastRel } from "@/lib/xml/last-rel";
import { LS_KEY_LAST_FILE, LS_KEY_SAMPLE, lsSet, lsSetJson } from "@/lib/xml/storage";
import { diffHistoryInit, type DiffHistory } from "@/lib/xml/history";
import { SAMPLE_BLANKS, sampleProjectByKey } from "@/lib/xml/sample-projects";
import { wsOpenProject, type WsProject } from "@/lib/xml/workspace";
import { t as tt } from "@/lib/i18n-src";
import type { ActiveProject } from "./XmlEditor";

/** 壳内（或 E/历史/画布/面板）定义、函数体运行时才需要的依赖。纯库函数不在此列。 */
export interface XmlProjectFnsDeps {
  // E（编辑核心共享）
  xml: string;
  setXml: React.Dispatch<React.SetStateAction<string>>;
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  // 历史（useDiffHistory）
  histRef: React.MutableRefObject<DiffHistory>;
  syncHist: () => void;
  flushTextTimer: () => void;
  // A 编辑核心
  setSelectedPath: (v: string | null) => void;
  setExportNote: (v: string) => void;
  setOpenRel: (v: string | null) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  applyExternalState: (f: ProjectFile | undefined) => void;
  openRelRef: React.MutableRefObject<string | null>;
  xmlRef: React.MutableRefObject<string>;
  projectRef: React.MutableRefObject<Project>;
  // C 画布
  setGeneratedDrawables: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSampleValues: (v: string) => void;
  // 面板
  setWsActiveName: (v: string) => void;
  setWsMsg: (v: string) => void;
  // B state（use-xml-project.ts）
  activeProjectRef: React.MutableRefObject<ActiveProject | null>;
  setSaveOrigin: React.Dispatch<
    React.SetStateAction<{ kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null>
  >;
  setActiveProject: React.Dispatch<React.SetStateAction<ActiveProject | null>>;
  setProjectRev: React.Dispatch<React.SetStateAction<number>>;
  setProjectTab: React.Dispatch<React.SetStateAction<"projects" | "current">>;
  projMeta: Record<string, { name?: string } | undefined>;
  refreshWorkspace: (opts?: { quiet?: boolean }) => Promise<void>;
  setWsBusy: (v: boolean) => void;
  /** M16i：工作目录状态（unsupported 时 openProjectDir 给不同取消提示） */
  wsState: import("@/lib/xml/workspace").WsInfo | null;
}

export interface XmlProjectFns {
  loadEntry: (source: ProjectSource, entry: BrowseEntry) => Promise<void>;
  openProjectEntry: (entry: BrowseEntry) => void;
  handlePkgSynced: (oldPkg: string, newPkg: string) => void;
  activateProject: (opened: OpenedProject, preferRel?: string | null) => Promise<void>;
  openWsProject: (item: WsProject) => Promise<void>;
  openProjectDir: () => Promise<void>;
  refreshActiveProject: () => Promise<void>;
  applySampleProject: (key: string) => void;
  applyBlankTemplate: (key: string) => void;
  selectFile: (id: string) => void;
  renameActiveFile: () => void;
  deleteActiveFile: () => void;
  closeActiveFile: () => void;
}

export function useXmlProjectFns(getDeps: () => XmlProjectFnsDeps): XmlProjectFns {
  // ⚠ 不能用 const D = getDeps()：本 hook 调用点（壳 ~1655 行）早于 xmlRef/projectRef（~2949 行）
  // 声明，渲染期即 evaluate getter 会撞 TDZ（"Cannot access 'xmlRef' before initialization"）。
  // → 用稳定 Proxy + 每次 commit 后刷新的 ref：回调执行时（挂载后）才解引用，既避开 TDZ 又拿最新值。
  const depsRef = useRef<XmlProjectFnsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as XmlProjectFnsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // getDeps 是壳内内联箭头（每渲染变），但 Proxy 只在首次创建即可（只要有首个有效访问）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const loadEntry = useCallback(
    async (source: ProjectSource, entry: BrowseEntry) => {
      try {
        const extMeta = { rel: entry.rel, target: entry.target, handle: entry.handle, sourceId: source.name };
        const cur = D.projectRef.current;
        const existing = cur.files.find(
          (f) => (entry.rel && f.ext?.rel === entry.rel) || (entry.target && f.ext?.target === entry.target),
        );
        if (existing) {
          D.flushTextTimer();
          D.setProject((p) => switchFile(updateFileXml(p, p.activeId, D.xmlRef.current), existing.id));
          D.setXml(existing.xml);
          D.histRef.current = diffHistoryInit(existing.xml);
          D.syncHist();
          D.setSelectedPath(null);
          saveBaseline(existing.ext?.rel || existing.ext?.target || existing.name, existing.xml);
          D.setWsActiveName(existing.name);
          D.setOpenRel(existing.ext?.rel ?? null);
          if (existing.ext?.target) D.setSaveOrigin({ kind: "native", target: existing.ext.target, name: existing.name });
          else if (existing.ext?.handle) D.setSaveOrigin({ kind: "handle", handle: existing.ext.handle as any, name: existing.name });
          else D.setSaveOrigin(null);
          D.setWsMsg(tt("已打开 {name}", { name: existing.name }));
          D.setWsActiveName(existing.name);
          return;
        }
        const text = await source.readText(entry.rel);
        if (text === null) {
          D.setWsMsg(tt("打不开《{name}》：文件已不存在或目录权限被收回", { name: entry.name }));
          return;
        }
        D.flushTextTimer();
        D.setProject((p) => {
          const { project: next, id } = addFile(p, entry.name, text);
          if (!id) return p;
          return {
            ...next,
            files: next.files.map((f) => (f.id === id ? { ...f, ext: extMeta } : f)),
          };
        });
        D.setXml(text);
        D.histRef.current = diffHistoryInit(text);
        D.syncHist();
        D.setSelectedPath(null);
        saveBaseline(entry.rel || entry.target || entry.name, text);
        D.setWsActiveName(entry.name);
        D.setOpenRel(entry.rel || null);
        if (entry.target) D.setSaveOrigin({ kind: "native", target: entry.target, name: entry.name });
        else if (entry.handle) D.setSaveOrigin({ kind: "handle", handle: entry.handle, name: entry.name });
        else D.setSaveOrigin(null);
        D.setWsMsg(tt("已打开 {name}", { name: entry.name }));
        D.setWsActiveName(entry.name);
      } catch (e) {
        D.setWsMsg(tt("打开失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      }
      try {
        const cur = D.activeProjectRef.current;
        if (cur?.source && entry.rel) {
          lsSetJson(LS_KEY_LAST_FILE, {
            dirPath: cur.dirPath ?? null,
            rootPath: cur.rootPath ?? null,
            project: cur.name,
            rel: entry.rel,
            name: entry.name,
          });
          writeLastRel(cur.dirPath || cur.name, entry.rel);
        }
      } catch {
        /* 静默 */
      }
    },
    [D],
  );

  /** 结构树里点一个 xml */
  const openProjectEntry = useCallback(
    (entry: BrowseEntry) => {
      const src = D.activeProjectRef.current?.source;
      if (src) void loadEntry(src, entry);
    },
    [loadEntry, D],
  );

  /** M219c：包名同步后，把"当前打开文件"的路径重映射到新包目录（如果它在旧包目录里）。
   *  否则编辑器 buffer 指向旧路径，Ctrl+S 会把旧包目录 + 旧 package 声明重新写回来。
   *  嵌套改名（com.a → com.a.b）不重映射（目录没动），也不动 buffer。 */
  const handlePkgSynced = useCallback(
    (oldPkg: string, newPkg: string) => {
      const cur = D.openRelRef.current;
      const src = D.activeProjectRef.current?.source;
      if (!cur || !src) return;
      if (!newPkg || !oldPkg || newPkg === oldPkg) return;
      const oldDir = oldPkg.replace(/\./g, "/");
      const newDir = newPkg.replace(/\./g, "/");
      // 嵌套改名不能自动挪（M219b 已 guard），不重映射
      if (newDir.startsWith(oldDir + "/") || newDir === oldDir) return;
      // 通用匹配：<任何源码根>/(java|kotlin)/<旧包路径>/...（不限 app/ 与 main）
      const m = cur.match(/^(.*\/(?:java|kotlin))\/(.+)$/);
      if (!m) return; // 不在 java/kotlin 源树里（如 manifest/strings）→ 路径没变，不动
      const root = m[1];
      const rest = m[2];
      if (!(rest === oldDir || rest.startsWith(oldDir + "/"))) return; // 不在旧包目录下
      {
        const tail = rest.slice(oldDir.length).replace(/^\//, "");
        const newRel = tail ? `${root}/${newDir}/${tail}` : `${root}/${newDir}`;
        // 重读盘上内容（同步后已是新 package 声明）并接管为当前文件
        void (async () => {
          const text = await src.readText(newRel).catch(() => null);
          if (text === null) {
            D.setWsMsg(tt("包名已改，当前文件《{name}》没找到新路径，请手动重新打开", { name: cur.split("/").pop() || "" }));
            D.setOpenRel(null);
            return;
          }
          D.setXmlAndTrack(text);
          saveBaseline(newRel, text);
          D.setWsActiveName(cur.split("/").pop() || "");
          D.setOpenRel(newRel);
          try {
            const ap = D.activeProjectRef.current;
            if (ap?.source) {
              lsSetJson(LS_KEY_LAST_FILE, {
                dirPath: ap.dirPath ?? null,
                rootPath: ap.rootPath ?? null,
                project: ap.name,
                rel: newRel,
                name: newRel.split("/").pop() || "",
              });
              writeLastRel(ap.dirPath || ap.name, newRel);
            }
          } catch {
            /* 静默 */
          }
          D.setWsMsg(tt("包名已改，《{name}》已切换到新路径 {rel}", { name: newRel.split("/").pop() || "", rel: newRel }));
        })();
      }
    },
    [D],
  );

  /** 激活一个已打开的项目：切到「当前项目」tab，并自动载入主布局（找不到就只显示结构树） */
  const activateProject = useCallback(
    async (opened: OpenedProject, preferRel?: string | null) => {
      // M31：标题显示 app 名称（读 res/values/strings.xml 的 app_name），并取 ic_launcher 做图标
      let name = opened.name;
      let iconUrl: string | null = null;
      try {
        const meta = await readProjectMetaFromSource(opened.source, opened.name);
        name = meta.name;
        iconUrl = meta.iconUrl ?? null;
        // M31：APK 里扁平列表只含 xml，图标读不到 → 按项目绝对路径直试 ic_launcher*
        if (!iconUrl && opened.dirPath) {
          const nm = await readProjectMetaNative(opened.name, opened.dirPath);
          if (nm.name && nm.name !== opened.name) name = nm.name;
          iconUrl = nm.iconUrl ?? null;
        }
      } catch {
        /* 读不到就用目录名 */
      }
      D.setActiveProject({ ...opened, name, iconUrl });
      D.setProjectRev((n) => n + 1);
      D.setProjectTab("current");
      D.setWsActiveName("");
      // M459：切项目时清理跨项目缓存——res-index 模块级 60s 缓存 + workspace 原生缓存，
      //  避免把上一个项目的资源索引 / 文件列表带进当前项目
      clearResIndex();
      invalidateNativeProjectCache();
      // M466：切项目时清空上一项目的文件 tabs（Project.files），避免新页面还留着旧项目的已打开文件误导用户
      D.setProject({ name, files: [], activeId: "" });
      // M144：优先恢复「上次打开的文件」，读不到才退回主布局
      const prefer = preferRel ?? readLastRel(opened.dirPath || opened.name);
      let restored = false;
      if (prefer) {
        const text = await opened.source.readText(prefer).catch(() => null);
        if (text !== null) {
          const bn = prefer.split("/").pop() || prefer;
          await loadEntry(opened.source, { kind: "file", name: bn, rel: prefer });
          restored = true;
        }
      }
      const main = restored ? null : await findMainLayout(opened.source);
      if (main) await loadEntry(opened.source, main);
      else if (!restored) D.setWsMsg(tt("已打开《{name}》，但里面没找到 layout xml", { name }));
    },
    [loadEntry, D],
  );

  /** M25d：项目列表里点一项 —— 打开这个项目（网页端也能直接读工作目录里的文件夹） */
  const openWsProject = useCallback(
    async (item: WsProject) => {
      D.setWsBusy(true);
      // M459：打开新项目前清缓存（res-index 60s 模块缓存 + workspace 原生缓存）
      clearResIndex();
      invalidateNativeProjectCache();
      try {
        if (item.kind === "file") {
          const r = await wsOpenProject(item);
          if (!r) {
            D.setWsMsg(tt("打不开《{name}》：文件已不存在或目录权限被收回", { name: item.name }));
            return;
          }
          D.setXmlAndTrack(r.text);
          D.setWsActiveName(item.name);
          // M466：清掉上一项目残留的文件 tabs，避免跨项目误导
          D.setProject({ name: item.name, files: [], activeId: "" });
          if (item.target) D.setSaveOrigin({ kind: "native", target: item.target, name: item.name });
          else if (item.handle) D.setSaveOrigin({ kind: "handle", handle: item.handle, name: item.name });
          else D.setSaveOrigin(null);
          D.setWsMsg(tt("已打开 {name}", { name: item.name }));
          return;
        }
        const opened = await openProjectFromItem(item);
        if (!opened) {
          D.setWsMsg(tt("打不开《{name}》：目录权限可能已失效，请重新选目录", { name: item.name }));
          return;
        }
        const shownName = D.projMeta[item.rel]?.name || item.name;
        await activateProject({ ...opened, name: shownName });
      } catch (e) {
        D.setWsMsg(tt("打开失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        D.setWsBusy(false);
      }
    },
    [activateProject, D],
  );

  /** M24：打开一个项目目录（弹系统选择器），成功后切到「当前项目」 */
  const openProjectDir = useCallback(async () => {
    D.setWsBusy(true);
    D.setWsMsg(tt("正在等你选项目文件夹…"));
    try {
      const proj = await openProjectFolder();
      if (!proj) {
        D.setWsMsg(
          D.wsState?.mode === "unsupported"
            ? tt("当前环境不支持选目录，请用 Chrome / Edge 或 APK")
            : tt("已取消打开"),
        );
        return;
      }
      await activateProject(proj);
      window.setTimeout(() => void D.refreshWorkspace({ quiet: true }), 600);
    } catch (e) {
      D.setWsMsg(tt("打开项目失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      D.setWsBusy(false);
    }
  }, [activateProject, D]);

  /** M24：重读当前项目结构（手动刷新）——M25d：只重置懒加载缓存，不深扫 */
  const refreshActiveProject = useCallback(async () => {
    if (D.activeProjectRef.current?.source) {
      D.setProjectRev((n) => n + 1);
      D.setWsMsg(tt("已刷新项目结构"));
      return;
    }
    try {
      const p = await restoreProjectFolder();
      if (p) {
        // M31：刷新时重读 app_name / 图标
        let name = p.name;
        let iconUrl: string | null = null;
        try {
          const meta = await readProjectMetaFromSource(p.source, p.name);
          name = meta.name;
          iconUrl = meta.iconUrl ?? null;
          if (!iconUrl && p.dirPath) {
            const nm = await readProjectMetaNative(p.name, p.dirPath);
            if (nm.name && nm.name !== p.name) name = nm.name;
            iconUrl = nm.iconUrl ?? null;
          }
        } catch {
          /* 用目录名 */
        }
        D.setActiveProject({ ...p, name, iconUrl });
        D.setProjectRev((n) => n + 1);
        D.setWsMsg(tt("已刷新《{name}》", { name }));
      } else {
        D.setWsMsg(tt("刷新失败：项目目录权限可能已失效，请重新「打开」"));
      }
    } catch (e) {
      D.setWsMsg(e instanceof Error ? e.message : String(e));
    }
  }, [D]);

  /** 载入完整示例项目：布局 + 自带 drawable + values 一起换（合并语义：用户已有资源不会被覆盖） */
  const applySampleProject = useCallback(
    (key: string) => {
      const p = sampleProjectByKey(key);
      if (!p) return;
      D.setXmlAndTrack(p.layout);
      D.setGeneratedDrawables((m) => ({ ...p.drawables, ...m }));
      D.setSampleValues(p.values ?? "");
      // M149：记住示例项目，重启后恢复它的 values/drawable（不记 key 就全裸显示 @string/@drawable）
      lsSet(LS_KEY_SAMPLE, key);
      D.setSelectedPath(null);
      // M466：载入示例/新模板时清掉上一项目残留的文件 tabs
      D.setProject({ name: p.name, files: [], activeId: "" });
      D.setExportNote(
        tt("已载入示例项目「{name}」· {lib}，自带 {n} 个 drawable", { name: p.name, lib: p.library, n: Object.keys(p.drawables).length }),
      );
      window.setTimeout(() => D.setExportNote(""), 4600);
    },
    [D],
  );

  const applyBlankTemplate = useCallback(
    (key: string) => {
      const b = SAMPLE_BLANKS.find((t) => t.key === key);
      if (!b) return;
      D.setXmlAndTrack(b.layout);
      D.setSelectedPath(null);
      // M466：清掉上一项目残留的文件 tabs
      D.setProject({ name: b.name ?? "new", files: [], activeId: "" });
    },
    [D],
  );

  /** M9：多文件切换 —— 先把当前编辑内容回写到项目，再切到目标文件，撤销栈跟着文件走 */
  const selectFile = useCallback(
    (id: string) => {
      D.flushTextTimer();
      D.setProject((p) => {
        const withSaved = updateFileXml(p, p.activeId, D.xml);
        const next = switchFile(withSaved, id);
        const target = activeFile(next);
        if (target && target.id !== p.activeId) {
          D.setXml(target.xml);
          D.histRef.current = diffHistoryInit(target.xml);
          D.syncHist();
          D.setSelectedPath(null);
          D.applyExternalState(target);
        }
        return next;
      });
    },
    [D],
  );

  const renameActiveFile = useCallback(() => {
    const cur = activeFile(D.project);
    if (!cur) return;
    const input = window.prompt(tt("重命名「{name}」", { name: cur.name }), cur.name);
    if (!input || input === cur.name) return;
    D.setProject((p) => renameFile(p, cur.id, input));
  }, [D]);

  const deleteActiveFile = useCallback(() => {
    const cur = activeFile(D.project);
    if (!cur || D.project.files.length <= 1) {
      D.setExportNote(tt("项目里只剩最后一个文件，删不了（先新建一个）"));
      window.setTimeout(() => D.setExportNote(""), 3600);
      return;
    }
    if (!window.confirm(tt("删除「{name}」？该文件内容会丢失。", { name: cur.name }))) return;
    D.flushTextTimer();
    D.setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, D.xml);
      const next = removeFile(withSaved, cur.id);
      const target = activeFile(next)!;
      D.setXml(target.xml);
      D.histRef.current = diffHistoryInit(target.xml);
      D.syncHist();
      D.setSelectedPath(null);
      D.applyExternalState(target);
      return next;
    });
    D.setExportNote(tt("已删除「{name}」", { name: cur.name }));
    window.setTimeout(() => D.setExportNote(""), 2400);
  }, [D]);

  /** M291：关闭当前文件 tab（不确认、不删盘，仅从项目里摘掉；剩最后一个时不动） */
  const closeActiveFile = useCallback(() => {
    const cur = activeFile(D.project);
    if (!cur || D.project.files.length <= 1) return;
    D.flushTextTimer();
    D.setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, D.xml);
      const next = removeFile(withSaved, cur.id);
      const target = activeFile(next)!;
      D.setXml(target.xml);
      D.histRef.current = diffHistoryInit(target.xml);
      D.syncHist();
      D.setSelectedPath(null);
      D.applyExternalState(target);
      return next;
    });
    D.setExportNote(tt("已关闭「{name}」", { name: cur.name }));
    window.setTimeout(() => D.setExportNote(""), 2400);
  }, [D]);

  return {
    loadEntry,
    openProjectEntry,
    handlePkgSynced,
    activateProject,
    openWsProject,
    openProjectDir,
    refreshActiveProject,
    applySampleProject,
    applyBlankTemplate,
    selectFile,
    renameActiveFile,
    deleteActiveFile,
    closeActiveFile,
  };
}
