// components/use-workspace-refresh.ts — M309：从 XmlEditor.tsx 抽出的「工作目录刷新/轮询」域
// 包含：5 个防重入签名 ref、refreshWorkspace、3 个自动刷新 useEffect、1 个「恢复上次项目」effect

"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  wsInfo,
  wsListTopProjects,
  wsSubscribeTopProjects,
  type WsInfo,
  type WsProject,
} from "@/lib/xml/workspace";
import { restoreProjectFolder, type OpenedProject } from "@/lib/xml/project";
import { yieldToUi } from "@/lib/xml/native-async";

export type LeftViewLite = "parts" | "layers" | "ai" | "assets" | "res" | "libs" | "settings" | "about";

export interface WorkspaceRefreshDeps {
  leftView: string;
  wsState: WsInfo | null;
  activeProject: { name: string } | null;
  setActiveProject: (p: OpenedProject | null) => void;
  setWsBusy: (v: boolean) => void;
  setWsMsg: (v: string) => void;
  setWsState: (v: WsInfo) => void;
  setWsProjects: (v: WsProject[]) => void;
  analyzeProjects: (list: WsProject[]) => void | Promise<void>;
}

export function useWorkspaceRefresh(d: WorkspaceRefreshDeps) {
  const { leftView, wsState, activeProject, setActiveProject, setWsBusy, setWsMsg, setWsState, setWsProjects, analyzeProjects } = d;

  /* ===== M16i：工作目录 ===== */
  const wsSigRef = useRef<string>("");
  /** M30：工作目录状态签名（避免 4s 轮询把同一个 info 重设成新对象 → 整面板重渲染） */
  const wsInfoSigRef = useRef<string>("");
  /** M30：静默轮询用上次的 info，不再每轮都问一次 bridge */
  const wsInfoRef = useRef<WsInfo | null>(null);
  /** M30：轮询重入锁（上一次还在读文件就不再发新的） */
  const wsTickingRef = useRef(false);
  /** M48：手动刷新防重入 */
  const wsBusyRef = useRef(false);

  const refreshWorkspace = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = !!opts?.quiet;
      // M63k：浏览器不支持选目录时，刷新毫无意义——直接不进循环，
      // 否则非静默刷新会把 wsBusy 抬一下，「正在读取…」就一直闪
      if (!quiet && wsInfoRef.current?.mode === "unsupported") return;
      if (quiet && wsTickingRef.current) return;
      if (quiet) wsTickingRef.current = true;
      if (!quiet) {
        // M48：手点刷新时防重入（连续点两下不再排队跑两次 JNI）
        if (wsBusyRef.current) return;
        wsBusyRef.current = true;
        setWsBusy(true);
      }
      try {
        // M47：非静默刷新一开始先让出一帧，让「点 tab」的点击动画先画完，
        // 后面的同步 JNI（wsInfo / listTopProjects）不再挡在点击帧前面
        if (!quiet) await yieldToUi();
        // M30：静默轮询复用上次 info（native 下 getWorkspaceInfo 每次都要走 JNI），
        // 只有手动刷新才重新问一次。
        const info: WsInfo = quiet && wsInfoRef.current ? wsInfoRef.current : await wsInfo();
        wsInfoRef.current = info;
        const infoSig = `${info.mode}:${info.label}:${info.custom ? 1 : 0}:${info.allFiles ? 1 : 0}`;
        if (!quiet || infoSig !== wsInfoSigRef.current) {
          wsInfoSigRef.current = infoSig;
          setWsState(info);
        }
        let next: WsProject[] = [];
        if (info.mode === "unsupported") {
          next = [];
        } else if (info.mode === "native" || info.custom) {
          // M25d：只读一层（不再深扫整个工作目录）
          // M58：顶层列表走 12s 内存缓存（mtime 没变就不重新探测，轮询/切 tab 都是免费）
          next = await wsListTopProjects();
        }
        // 自动刷新时列表没变就不 setState（否则卡片/树一直重建）
        const sig = next.map((p) => `${p.kind}:${p.rel}`).join("|");
        if (!quiet || sig !== wsSigRef.current) {
          wsSigRef.current = sig;
          setWsProjects(next);
          void analyzeProjects(next);
        }
      } catch (e) {
        if (!quiet) setWsMsg(e instanceof Error ? e.message : String(e));
      } finally {
        if (!quiet) {
          wsBusyRef.current = false;
          setWsBusy(false);
        }
        wsTickingRef.current = false;
      }
    },
    [analyzeProjects, setWsBusy, setWsMsg, setWsProjects, setWsState],
  );

  useEffect(() => {
    // M63k：不支持选目录的环境（比如非 Chromium 浏览器）就别再刷了
    if (wsState?.mode === "unsupported") return;
    // M47：项目管理 tab 才刷工作目录；设置 tab 只往从未加载过工作目录信息时补一次
    //（旧逻辑两个 tab 都无条件刷 → 手机上每次点「设置」都走一遍同步 JNI）
    if (leftView === "res") void refreshWorkspace();
    else if (leftView === "settings" && !wsState) void refreshWorkspace();
  }, [leftView, refreshWorkspace, wsState]);

  /* M60：订阅「后台补齐的完整项目列表」——快速列表先出卡片，完整探测回来后
     自动替换成带 mainPath/精确计数的版本（并继续跑图标/名称分析） */
  useEffect(() => {
    const unsub = wsSubscribeTopProjects((full) => {
      setWsProjects(full);
      void analyzeProjects(full);
    });
    return unsub;
  }, [analyzeProjects, setWsProjects]);

  /* M24/M30：项目列表自动刷新 —— 12s 一次（原来 4s，在手机上频繁走 JNI 会卡）；
     切回页面/窗口获得焦点时立即刷一次。 */
  useEffect(() => {
    if (leftView !== "res") return;
    // M63k：不支持选目录 → 不起轮询（否则「正在读取…」每 12s 闪一次）
    if (wsState?.mode === "unsupported") return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshWorkspace({ quiet: true });
    };
    const timer = window.setInterval(tick, 12000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leftView, refreshWorkspace, wsState?.mode]);

  /** M24：打开项目面板时恢复上次的项目结构（不弹窗，权限失效就当没有） */
  useEffect(() => {
    if (leftView !== "res") return;
    if (activeProject) return;
    let alive = true;
    void (async () => {
      // M47：先让出画面，再走 JNI（restoreProjectFolder 内部会同步调 wsInfo/wsListProjects）
      await yieldToUi();
      try {
        const p = await restoreProjectFolder();
        if (alive && p) setActiveProject(p);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [leftView, activeProject, setActiveProject]);

  return { refreshWorkspace };
}
