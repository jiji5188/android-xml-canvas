// components/ProjectPanel.tsx — 左栏「项目管理」面板（M25b 从 XmlEditor.tsx 抽出）
//
// 两个 tab：项目列表（工作目录扫描）/ 当前项目（结构树 + res 资源区）。
// 纯展示 + 回调，状态全在 XmlEditor 里；树节点渲染函数也放这里，省得主文件再长。

import type { ReactNode } from "react";
import { ResTree } from "./ResTree";
import { buildProjectTree, type ProjectNode } from "@/lib/xml/project";
import type { WsNode } from "@/lib/xml/wstree";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ResourceExtras } from "@/lib/xml/resdir";
import type { OpenedProject } from "@/lib/xml/project";
import type { Project } from "@/lib/xml/multi-file";

export interface ProjectPanelProps {
  tr: (key: string, fallback: string) => string;

  /** 当前 tab */
  tab: "projects" | "current";
  onTab: (t: "projects" | "current") => void;

  /** 项目列表 */
  wsState: WsInfo | null;
  wsBusy: boolean;
  wsMsg: string;
  wsProjects: WsProject[];
  wsTree: WsNode[];
  wsOpen: Set<string>;
  onToggleOpen: (rel: string) => void;
  /** 点列表项：目录=展开/收起，文件/带布局目录=打开 */
  onOpenItem: (item: WsProject) => void;
  onRefresh: () => void;
  onOpenDir: () => void;
  onRequestAllFiles: () => void;

  /** 当前项目 */
  project: Project;
  activeProject: OpenedProject | null;
  onSelectFile: (id: string) => void;
  onRefreshProject: () => void;
  onNewProject: (suggestName: string) => void;
  /** 当前正在编辑的文件名（结构树里标「正在编辑」用） */
  currentFileName: string;

  /** res 资源区 */
  resExtras: ResourceExtras | null;
  generatedDrawables: Record<string, string>;
  onPickResDir: () => void;
  onOpenXml: () => void;
  onClearRes: () => void;
  onOpenLayout: (fileName: string, content: string) => void;
  onOpenDrawable: (rel: string, name: string, xml: string) => void;
  onPreviewImage: (rel: string, name: string, url: string) => void;
  resourceFragment: string;
  onResourceFragment: (v: string) => void;
}

export function ProjectPanel(p: ProjectPanelProps) {
  const {
    tr,
    tab,
    onTab,
    wsState,
    wsBusy,
    wsMsg,
    wsProjects,
    wsTree,
    onRefresh,
    onOpenDir,
    onRequestAllFiles,
    project,
    activeProject,
    onSelectFile,
    onRefreshProject,
    onNewProject,
    resExtras,
    generatedDrawables,
    onPickResDir,
    onOpenXml,
    onClearRes,
    onOpenLayout,
    onOpenDrawable,
    onPreviewImage,
    resourceFragment,
    onResourceFragment,
  } = p;

  /** M20n：把树拍平成行（文件夹可折叠，缩进表示层级） */
  const renderWsRows = (nodes: WsNode[], depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (const n of nodes) {
      const isDir = n.kind === "dir";
      const open = p.wsOpen.has(n.rel);
      rows.push(
        <li key={n.rel + ":" + n.kind}>
          <div className="axv-ws-row" style={{ paddingLeft: depth * 14 }}>
            {isDir ? (
              <button
                className="axv-ws-caret"
                title={open ? "折叠" : "展开"}
                aria-label={open ? "折叠" : "展开"}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleOpen(n.rel);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                  {open ? "expand_more" : "chevron_right"}
                </span>
              </button>
            ) : (
              <span className="axv-ws-caret" aria-hidden="true" />
            )}
            <button className="axv-ws-item" onClick={() => p.onOpenItem(n.item)} title={n.rel}>
              <span className="msr axv-ws-item-icon" aria-hidden="true">
                {isDir ? (open ? "folder_open" : "folder") : "description"}
              </span>
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">{n.name}</span>
                <span className="axv-ws-item-sub">{isDir ? `${n.layoutCount} 个布局` : "单个 xml"}</span>
              </span>
            </button>
            {isDir && n.layoutCount > 0 ? (
              <button
                className="axv-ws-open"
                title="打开这个文件夹里的主布局"
                aria-label="打开项目"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onOpenItem(n.item);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                  play_arrow
                </span>
              </button>
            ) : null}
          </div>
        </li>,
      );
      if (isDir && open && n.children.length > 0) rows.push(...renderWsRows(n.children, depth + 1));
    }
    return rows;
  };

  /** M24：当前项目结构树（目录可折叠，xml 点一下就当打开） */
  const renderProjRows = (nodes: ProjectNode[], depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (const n of nodes) {
      const isDir = n.kind === "dir";
      const open = p.wsOpen.has(n.rel);
      rows.push(
        <li key={n.rel + ":" + n.kind}>
          <div className="axv-ws-row" style={{ paddingLeft: depth * 14 }}>
            {isDir ? (
              <button
                className="axv-ws-caret"
                title={open ? "折叠" : "展开"}
                aria-label={open ? "折叠" : "展开"}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleOpen(n.rel);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                  {open ? "expand_more" : "chevron_right"}
                </span>
              </button>
            ) : (
              <span className="axv-ws-caret" aria-hidden="true" />
            )}
            <button
              className="axv-ws-item"
              title={n.rel}
              onClick={() => (isDir ? p.onToggleOpen(n.rel) : p.onOpenItem(n.item))}
            >
              <span className="msr axv-ws-item-icon" aria-hidden="true">
                {isDir ? (open ? "folder_open" : "folder") : "description"}
              </span>
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">{n.name}</span>
                <span className="axv-ws-item-sub">
                  {isDir
                    ? `${n.layoutCount} 个布局`
                    : n.name.toLowerCase() === (p.currentFileName ?? "").toLowerCase()
                      ? "正在编辑"
                      : "布局文件"}
                </span>
              </span>
            </button>
          </div>
        </li>,
      );
      if (isDir && open && n.children.length > 0) rows.push(...renderProjRows(n.children, depth + 1));
    }
    return rows;
  };

  return (
    <div className="axv-rail-scroll">
      {/* M16i：项目管理两个 tab（M24：「工作目录」→「项目列表」） */}
      <div className="axv-proj-tabs">
        <button
          className={"axv-proj-tab" + (tab === "projects" ? " on" : "")}
          onClick={() => {
            onTab("projects");
            void onRefresh();
          }}
        >
          {tr("proj.list", "项目列表")}
        </button>
        <button
          className={"axv-proj-tab" + (tab === "current" ? " on" : "")}
          onClick={() => onTab("current")}
        >
          {tr("proj.current", "当前项目")}
        </button>
      </div>

      {tab === "projects" ? (
        <div className="axv-ws-panel">
          <div className="axv-ws-path">
            <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>folder_open</span>
            <span className="axv-ws-path-text" title={wsState?.label || ""}>
              {wsState?.mode === "native"
                ? wsState.label || "AndroidUIIDE/Project"
                : wsState?.mode === "unsupported"
                  ? "当前浏览器不支持读本地目录"
                  : wsState?.custom
                    ? wsState.label
                    : "未授权目录"}
            </span>
            <button
              className="axv-ws-mini"
              title="刷新列表"
              onClick={() => void onRefresh()}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
            </button>
          </div>

          <div className="axv-ws-actions">
            <button
              className="axv-rail-mini-btn"
              onClick={() => void onOpenDir()}
              title="选一个项目文件夹（含 layout/*.xml）作为当前项目"
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>folder_open</span>
              {tr("proj.open", "打开")}
            </button>
            <button
              className="axv-rail-mini-btn"
              onClick={() => { onNewProject(project.name || "MyApp") }}
              title="新建一个带 activity_main.xml 的空项目"
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>add_box</span>
              {tr("proj.new", "新建项目")}
            </button>
          </div>

          {wsState?.mode === "native" && wsState.allFiles === false ? (
            <div className="axv-ws-warn">
              默认目录在存储根下，需要「所有文件访问」权限才能读取。
              <button className="axv-ws-link" onClick={onRequestAllFiles}>
                去开启
              </button>
            </div>
          ) : null}
          {wsState?.mode === "unsupported" ? (
            <div className="axv-ws-warn">
              请用 Chrome / Edge 打开网页版，或安装 APK（APK 默认目录：/AndroidUIIDE/Project）。
            </div>
          ) : null}
          {wsState?.mode === "web" && !wsState.custom ? (
            <div className="axv-ws-hint">
              点「打开」授权一个项目文件夹，授权会被记住，下次打开不用再选。
            </div>
          ) : null}
          {wsState?.permission === "prompt" ? (
            <div className="axv-ws-warn">
              目录权限需要重新确认（浏览器安全策略）。
              <button className="axv-ws-link" onClick={() => void onRefresh()}>
                重新授权
              </button>
            </div>
          ) : null}

          {wsBusy ? <div className="axv-ws-hint">正在读取…</div> : null}

          {wsProjects.length > 0 ? (
            <ul className="axv-ws-list">{renderWsRows(wsTree, 0)}</ul>
          ) : !wsBusy && (wsState?.mode === "native" || wsState?.custom) ? (
            <div className="axv-ws-hint">
              目录里还没有项目。把项目文件夹（内含 layout/*.xml）放到这个目录下，点刷新即可。
            </div>
          ) : null}

          {wsMsg ? <div className="axv-ws-hint">{wsMsg}</div> : null}
        </div>
      ) : (
        <>
          {/* M24：当前项目结构 */}
          <div className="axv-proj-now">
            <div className="axv-proj-now-head">
              <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>work</span>
              <b className="axv-proj-now-name" title={activeProject?.name || project.name}>
                {activeProject?.name || project.name || tr("proj.untitled", "未命名项目")}
              </b>
              <span className="axv-proj-now-sub">
                {activeProject && activeProject.entries.length > 0
                  ? `${activeProject.entries.filter((e) => e.kind === "file").length} 个文件`
                  : `${project.files.length} 个布局`}
              </span>
              <button
                className="axv-ws-mini"
                title={tr("proj.refresh", "刷新项目结构")}
                onClick={() => void onRefreshProject()}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>
            {activeProject && activeProject.entries.length > 0 ? (
              <ul className="axv-ws-list axv-proj-tree">
                {renderProjRows(buildProjectTree(activeProject.entries), 0)}
              </ul>
            ) : (
              <ul className="axv-ws-list axv-proj-tree">
                <li>
                  <div className="axv-ws-row" style={{ paddingLeft: 0 }}>
                    <span className="axv-ws-caret" aria-hidden="true" />
                    <span className="axv-ws-item axv-ws-item-static">
                      <span className="msr axv-ws-item-icon" aria-hidden="true">folder_open</span>
                      <span className="axv-ws-item-main">
                        <span className="axv-ws-item-name">layout/</span>
                        <span className="axv-ws-item-sub">{project.files.length} 个布局</span>
                      </span>
                    </span>
                  </div>
                </li>
                {project.files.map((f) => (
                  <li key={f.id}>
                    <div className="axv-ws-row" style={{ paddingLeft: 14 }}>
                      <span className="axv-ws-caret" aria-hidden="true" />
                      <button
                        className="axv-ws-item"
                        onClick={() => onSelectFile(f.id)}
                        title={f.name}
                      >
                        <span className="msr axv-ws-item-icon" aria-hidden="true">description</span>
                        <span className="axv-ws-item-main">
                          <span className="axv-ws-item-name">
                            {f.id === project.activeId ? "● " : ""}
                            {f.name}
                          </span>
                          <span className="axv-ws-item-sub">布局文件</span>
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="axv-proj-now-foot">
              <button className="axv-ws-link" onClick={() => void onOpenDir()}>
                {tr("proj.openAnother", "打开其他项目…")}
              </button>
              <button
                className="axv-ws-link"
                onClick={() => { onNewProject(project.name || "MyApp") }}
              >
                {tr("proj.new", "新建项目")}
              </button>
            </div>
          </div>

          {/* 资源操作按钮（横向排列，树形框上方） */}
          <div style={{ display: "flex", gap: 8, padding: "8px 12px 6px" }}>
        <button
          className="axv-rail-mini-btn"
          title="选择整个 res 目录（推荐：一次导入 drawable / values / mipmap）"
          onClick={() => onPickResDir()}
        >
          📁 选择res目录
        </button>
        <button
          className="axv-rail-mini-btn"
          title="打开 XML 文件"
          onClick={onOpenXml}
        >
          📄 打开xml
        </button>
        {resExtras ? (
          <button
            className="axv-rail-mini-btn axv-rail-mini-btn-danger"
            style={{ flex: "0 0 auto" }}
            title="清除已上传的 res 资源"
            onClick={onClearRes}
          >
            ✖
          </button>
        ) : null}
      </div>
      {resExtras?.tree ? (
        <ResTree
          tree={resExtras.tree}
          layouts={resExtras.layouts}
          extras={resExtras}
          onOpenLayout={onOpenLayout}
          onOpenDrawable={onOpenDrawable}
          onPreviewImage={onPreviewImage}
          generated={generatedDrawables}
        />
      ) : (
        <>
          <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "var(--axv-on-surface-variant)", lineHeight: 1.5 }}>
            上传 res/ 目录后可在这里以树形浏览资源文件，点击 layout/*.xml 直接预览。
          </div>
          <div className="axv-res-box">
            <textarea
              value={resourceFragment}
              onChange={(e) => onResourceFragment(e.target.value)}
              placeholder={'<resources>\n  <string name="app_name">My App</string>\n  <dimen name="margin_small">8dp</dimen>\n  <color name="primary">#FF0000</color>\n</resources>'}
            />
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
