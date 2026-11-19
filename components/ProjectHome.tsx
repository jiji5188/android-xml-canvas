"use client";
// components/ProjectHome.tsx — M412：项目管理入口页
//
// 入口架构：app/xml 默认渲染本页（项目列表），点项目才进编辑器。
// 好处（和用户讨论定下的）：
//   1. 页面边界 = 状态生命周期边界：编辑器卸载即释放 activeProject/xml/res 内存，
//      不需要 store 也能避免「跨页共享状态」
//   2. 返回/退出天然有挂点：编辑器 dirty 时走 useUnsavedLeave 三态提示（M141 现成）
//   3. 工作区逻辑全部复用 use-xml-project / use-workspace-refresh（零新逻辑）
//
// 本页刻意保持「哑」：不含打开项目的实现（openWsProject 在编辑器里），
// 点卡片只把 WsProject 交给 shell，由 shell 切视图 + 编辑器自动打开。
// 新建项目也先留在编辑器里（编辑器的 createNewProject 依赖编辑器 state），
// 「新建 / 更多」暂时进编辑器操作。

import { useEffect } from "react";
import { useXmlProjectState } from "./use-xml-project";
import type { WsProject } from "@/lib/xml/workspace";
import { t as tt } from "@/lib/i18n-src";

export interface ProjectHomeProps {
  /** 点开一个项目 → shell 切到编辑器并自动打开 */
  onOpenProject: (item: WsProject) => void;
  /** 不选项目直接进编辑器（老入口：新建项目 / 打开文件 / 示例都在编辑器里） */
  onOpenEditor: () => void;
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#F5F4F7",
    color: "#1B1B1F",
    fontFamily: "Roboto, system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "24px 16px 48px",
  },
  head: { width: "100%", maxWidth: 560, display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: 0.2 },
  sub: { fontSize: 12, color: "#6B6F76" },
  dirRow: { width: "100%", maxWidth: 560, fontSize: 12, color: "#6B6F76", margin: "2px 0 12px", display: "flex", gap: 8, alignItems: "center" },
  actions: { width: "100%", maxWidth: 560, display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  btn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px", borderRadius: 10, border: "1px solid #D8DCE3",
    background: "#FFFFFF", color: "#1B1B1F", fontSize: 14, cursor: "pointer",
  },
  btnPrimary: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px", borderRadius: 10, border: "none",
    background: "#04409F", color: "#FFFFFF", fontSize: 14, cursor: "pointer",
  },
  list: { width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 10 },
  card: {
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    padding: "12px 14px", borderRadius: 14, border: "1px solid #E3E6EB",
    background: "#FFFFFF", cursor: "pointer", textAlign: "left",
  },
  icon: { width: 40, height: 40, borderRadius: 10, background: "#EEF1F6", display: "grid", placeItems: "center", overflow: "hidden", flexShrink: 0 },
  iconImg: { width: 28, height: 28, objectFit: "contain" },
  cardName: { fontSize: 15, fontWeight: 600 },
  cardSub: { fontSize: 12, color: "#6B6F76", marginTop: 2 },
  empty: { width: "100%", maxWidth: 560, padding: "32px 16px", borderRadius: 14, border: "1px dashed #C9CFD8", textAlign: "center", color: "#6B6F76", fontSize: 14, lineHeight: 1.8 },
  msg: { width: "100%", maxWidth: 560, fontSize: 12, color: "#B3541E", minHeight: 16, marginBottom: 8 },
};

export function ProjectHome({ onOpenProject, onOpenEditor }: ProjectHomeProps) {
  const {
    wsState, wsProjects, wsBusy, projMeta,
    refreshWorkspace, pickCustomDir,
  } = useXmlProjectState({ leftView: "res", setWsMsg: () => {} });

  // 进页面刷一次；12s 静默轮询由 use-workspace-refresh 自带（leftView=res）
  useEffect(() => {
    void refreshWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unsupported = wsState?.mode === "unsupported";

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div style={S.title}>{tt("我的项目")}</div>
        <button type="button" style={{ ...S.btn, border: "none", background: "transparent", color: "#04409F" }} onClick={onOpenEditor}>
          {tt("进入编辑器")}
        </button>
      </div>
      <div style={S.dirRow}>
        <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>folder</span>
        <span>
          {unsupported
            ? tt("当前环境不支持选目录，请用 Chrome / Edge 或 APK")
            : (wsState?.label || tt("工作目录读取中…")) + (wsState?.custom ? tt("（自选）") : "")}
        </span>
      </div>

      <div style={S.actions}>
        <button type="button" style={S.btnPrimary} onClick={() => void pickCustomDir()}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>create_new_folder</span>
          {tt("打开项目目录")}
        </button>
        <button type="button" style={S.btn} onClick={() => void refreshWorkspace()} disabled={wsBusy}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>refresh</span>
          {wsBusy ? tt("读取中…") : tt("刷新")}
        </button>
        <button type="button" style={S.btn} onClick={onOpenEditor}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>add</span>
          {tt("新建 / 示例项目")}
        </button>
      </div>

      <div style={S.msg}>{wsBusy ? tt("正在读取工作目录…") : ""}</div>

      {wsProjects.length === 0 && !wsBusy ? (
        <div style={S.empty}>
          {unsupported
            ? tt("这个浏览器拿不到目录权限。点右上角「进入编辑器」仍可编辑单文件。")
            : tt("工作目录里还没有项目。把 Android 项目文件夹放进工作目录后点「刷新」，或直接打开一个项目目录。")}
        </div>
      ) : null}

      <div style={S.list}>
        {wsProjects.map((it) => {
          const meta = projMeta[it.rel];
          return (
            <button
              key={it.kind + ":" + it.rel}
              type="button"
              style={S.card}
              onClick={() => onOpenProject(it)}
            >
              <span style={S.icon}>
                {meta?.iconUrl ? (
                  <img src={meta.iconUrl} alt="" style={S.iconImg} />
                ) : (
                  <span className="msr" aria-hidden="true" style={{ fontSize: 22, color: "#8A93A0" }}>
                    {it.kind === "dir" ? "folder" : "description"}
                  </span>
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...S.cardName, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {meta?.name || it.name}
                </span>
                <span style={{ ...S.cardSub, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.rel}
                  {it.kind === "dir" && it.layoutCount > 0 ? tt(" · {n} 个布局", { n: it.layoutCount }) : ""}
                </span>
              </span>
              <span className="msr" aria-hidden="true" style={{ fontSize: 20, color: "#C0C6CF" }}>chevron_right</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
