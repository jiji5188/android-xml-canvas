// components/use-xml-project.ts — M366（路线 2 拆解）：项目管理/工作区 state 层
//
// 从 XmlEditor.tsx 抽出（原 444-466 区域）：projectTab/w sState/wsProjects/activeProject/
// projectRev/projMeta/newProj*/saveOrigin。纯 state 归拢，函数仍留壳（后续步再搬）。
// ActiveProject 是 XmlEditor.tsx 的本地导出类型，用 type-only 导入（无运行时循环，use-signing.tsx 已有先例）。
"use client";

import { useCallback, useRef, useState } from "react";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ProjectMeta } from "@/lib/xml/project-browse";
import type { ActiveProject } from "./XmlEditor";
import { readProjectMeta, readProjectMetaNative } from "@/lib/xml/project-browse";
import { wsPickCustom, wsUseDefault } from "@/lib/xml/workspace";
import { yieldToUi } from "@/lib/xml/native-async";
import { t as tt } from "@/lib/i18n-src";
import { useWorkspaceRefresh } from "./use-workspace-refresh";

/** M366：B 集群下沉时需要的壳外依赖（避免 B→C / B→Panels 硬耦合） */
export interface XmlProjectDeps {
  /** 当前左栏视图（res/settings/...），refreshWorkspace 的 effect 依赖它 */
  leftView: string;
  /** 工作区提示文案 setter（在 use-panels 里，壳传入） */
  setWsMsg: (v: string) => void;
}

export interface XmlProjectState {
  /** M16i：工作目录面板 tab（projects = 项目列表 / current = 当前项目） */
  projectTab: "projects" | "current";
  setProjectTab: React.Dispatch<React.SetStateAction<"projects" | "current">>;
  wsState: WsInfo | null;
  setWsState: React.Dispatch<React.SetStateAction<WsInfo | null>>;
  wsProjects: WsProject[];
  setWsProjects: React.Dispatch<React.SetStateAction<WsProject[]>>;
  /** M24：当前项目（项目名 + 懒加载浏览源） */
  activeProject: ActiveProject | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ActiveProject | null>>;
  /** M25d：手动刷新项目结构时 +1，让面板丢掉懒加载缓存重新读根目录 */
  projectRev: number;
  setProjectRev: React.Dispatch<React.SetStateAction<number>>;
  /** M25d：项目卡片分析结果（app_name / 图标），key = 项目 rel */
  projMeta: Record<string, ProjectMeta>;
  setProjMeta: React.Dispatch<React.SetStateAction<Record<string, ProjectMeta>>>;
  /** M24：新建项目对话框 */
  newProjOpen: boolean;
  setNewProjOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newProjName: string;
  setNewProjName: React.Dispatch<React.SetStateAction<string>>;
  /** M31i：新建项目可选图标（data URL 预览 + base64 落盘 + mime；null = 默认自适应图标） */
  newProjIcon: { dataUrl: string; base64: string; mime: string } | null;
  setNewProjIcon: React.Dispatch<React.SetStateAction<{ dataUrl: string; base64: string; mime: string } | null>>;
  /** M176：新建项目时的包名（留空 = 按项目名自动 com.example.xxx） */
  newProjPkg: string;
  setNewProjPkg: React.Dispatch<React.SetStateAction<string>>;
  newProjBusy: boolean;
  setNewProjBusy: React.Dispatch<React.SetStateAction<boolean>>;
  /** M21：当前编辑内容的来源 —— 决定「保存」是写回原路还是弹选择器 */
  saveOrigin: { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null;
  setSaveOrigin: React.Dispatch<
    React.SetStateAction<{ kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null>
  >;
  /** M25d/M31：后台分析项目名/图标（下沉自壳） */
  analyzeProjects: (list: WsProject[]) => Promise<void>;
  /** M48：工作区刷新忙碌态（下沉自壳） */
  wsBusy: boolean;
  setWsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  /** M309：工作目录刷新（来自 use-workspace-refresh） */
  refreshWorkspace: (opts?: { quiet?: boolean }) => Promise<void>;
  /** M16i：手选工作目录 */
  pickCustomDir: () => Promise<void>;
  /** M16i：恢复默认工作目录 */
  useDefaultDir: () => Promise<void>;
}

export function useXmlProjectState(d: XmlProjectDeps): XmlProjectState {
  const { leftView, setWsMsg } = d;
  const [projectTab, setProjectTab] = useState<"projects" | "current">("current");
  const [wsState, setWsState] = useState<WsInfo | null>(null);
  const [wsProjects, setWsProjects] = useState<WsProject[]>([]);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [projectRev, setProjectRev] = useState(0);
  const [projMeta, setProjMeta] = useState<Record<string, ProjectMeta>>({});
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("MyApp");
  const [newProjIcon, setNewProjIcon] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  const [newProjPkg, setNewProjPkg] = useState("");
  const [newProjBusy, setNewProjBusy] = useState(false);
  const [saveOrigin, setSaveOrigin] = useState<
    { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null
  >(null);
  /** M48：工作区刷新忙碌态（原壳 470） */
  const [wsBusy, setWsBusy] = useState(false);

  // M25d/M31 项目分析（原壳 616-673）：analyzed/analyzing refs + analyzeProjects 下沉
  /** M25d：已经分析过名称/图标的项目（rel），避免 4s 轮询重复读文件 */
  const analyzedRef = useRef<Set<string>>(new Set());
  /** M48：分析链重入锁 */
  const analyzingRef = useRef(false);

  /** M25d/M31：后台分析项目名/图标（串行，读不到就跳过，不影响列表渲染）
   *  web：有 DirHandle 走 readProjectMeta；APK：没有句柄，按项目绝对路径试读 strings.xml + ic_launcher */
  const analyzeProjects = useCallback(
    async (list: WsProject[]) => {
      // M48：同一个项目列表只允许一条分析链在跑（轮询和重试可能撞车）
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      // M47：每轮最多分析 4 个，剩下的 200ms 后再来一轮，
      // 避免一打开面板就一口气读十几个项目把主线程啃完（手机上最重的就是这里）
      let count = 0;
      let ok = 0;
      const patch: Record<string, ProjectMeta> = {};
      for (const it of list) {
        if (count >= 4) break;
        if (it.kind !== "dir") continue;
        if (!it.handle && !it.dirPath) continue;
        if (analyzedRef.current.has(it.rel)) continue;
        try {
          const meta = it.handle
            ? await readProjectMeta(it.handle, it.name)
            : await readProjectMetaNative(it.name, it.dirPath);
          // M31d：成功才记账，失败（权限未授权/目录刚变）下一轮轮询再试
          analyzedRef.current.add(it.rel);
          patch[it.rel] = meta;
          count++;
          ok++;
        } catch {
          /* 分析失败就当没有，卡片回退到文件夹名 */
          count++;
        }
        // M33：一个一个来，每个之间让出一帧，列表可以边读边显示（不再整页卡住）
        await yieldToUi();
      }
      // 一次性合并，避免 N 次 setState 引发 N 轮重渲染
      if (Object.keys(patch).length) setProjMeta((prev) => ({ ...prev, ...patch }));
      analyzingRef.current = false;
      // 还有没分析完的 → 200ms 后再来一轮（页面隐藏时不排）
      // M48：一轮里一个都没成功（比如没权限）就不重试，否则会 200ms 一次死循环空转
      const remaining =
        ok > 0
          ? list.filter(
              (it) => it.kind === "dir" && (it.handle || it.dirPath) && !analyzedRef.current.has(it.rel),
            )
          : [];
      if (remaining.length) {
        window.setTimeout(() => {
          if (typeof document !== "undefined" && document.hidden) return;
          void analyzeProjects(list);
        }, 200);
      }
    },
    [],
  );

  // M309：工作目录刷新 / 12s 轮询 / 恢复上次项目 → use-workspace-refresh（下沉自壳 618-628）
  const { refreshWorkspace } = useWorkspaceRefresh({
    leftView,
    wsState,
    activeProject,
    setActiveProject,
    setWsBusy,
    setWsMsg,
    setWsState,
    setWsProjects,
    analyzeProjects,
  });

  // M16i：手选工作目录（原壳 630-639）
  const pickCustomDir = useCallback(async () => {
    const ok = await wsPickCustom();
    if (!ok) {
      setWsMsg(wsState?.mode === "unsupported" ? tt("当前浏览器不支持，请用 Chrome / Edge 或 APK") : tt("已取消选择"));
      return;
    }
    setWsMsg("");
    // 原生选择器是异步回调，给系统一点时间落盘
    window.setTimeout(() => void refreshWorkspace(), 600);
  }, [refreshWorkspace, wsState?.mode, setWsMsg]);

  // M16i：恢复默认工作目录（原壳 641-646）
  const useDefaultDir = useCallback(async () => {
    await wsUseDefault();
    setWsMsg(tt("已恢复默认工作目录"));
    window.setTimeout(() => void refreshWorkspace(), 400);
  }, [refreshWorkspace, setWsMsg]);

  return {
    projectTab, setProjectTab, wsState, setWsState, wsProjects, setWsProjects,
    activeProject, setActiveProject, projectRev, setProjectRev, projMeta, setProjMeta,
    newProjOpen, setNewProjOpen, newProjName, setNewProjName, newProjIcon, setNewProjIcon,
    newProjPkg, setNewProjPkg, newProjBusy, setNewProjBusy, saveOrigin, setSaveOrigin,
    analyzeProjects, wsBusy, setWsBusy, refreshWorkspace, pickCustomDir, useDefaultDir,
  };
}
