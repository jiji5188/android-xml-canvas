// components/ProjectPanel.tsx — 左栏「项目管理」面板（M25b 抽出 / M25d 改扁平 + 懒加载）
//
// 两个 tab：
//   项目列表：工作目录的**直接子项**，一行一个项目卡片（图标 + 名称来自项目文件分析），点一下就打开；
//   当前项目：项目结构树，**目录点开才读那一层**（懒加载），不再一次性深扫整棵树。
//
// 树的展开状态、已加载的子项都放在组件内部：它们是纯 UI 状态，没必要塞回 XmlEditor。

import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { ResTree } from "./ResTree";
import type { BrowseEntry, ProjectMeta, ProjectSource } from "@/lib/xml/project-browse";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ResourceExtras } from "@/lib/xml/resdir";
import type { Project } from "@/lib/xml/multi-file";

export interface ProjectPanelProps {
  tr: (key: string, fallback: string) => string;

  /** 当前 tab */
  tab: "projects" | "current";
  onTab: (t: "projects" | "current") => void;

  /** 项目列表（扁平：工作目录的直接子项） */
  wsState: WsInfo | null;
  wsBusy: boolean;
  wsMsg: string;
  projects: WsProject[];
  /** 项目分析结果（app_name / 图标），还没分析完的先不给 */
  metaOf: (p: WsProject) => ProjectMeta | undefined;
  onOpenProject: (p: WsProject) => void;
  onRefresh: () => void;
  onOpenDir: () => void;
  onRequestAllFiles: () => void;

  /** 当前项目 */
  projectName: string;
  projectSource: ProjectSource | null;
  /** 手动刷新时外部 +1，用来清掉懒加载缓存重新读 */
  projectRev: number;
  currentFileName: string;
  onOpenEntry: (e: BrowseEntry) => void;
  onRefreshProject: () => void;
  onNewProject: (suggestName: string) => void;

  /** 应用内多文件（没有项目目录时的兜底列表） */
  appProject: Project;
  onSelectFile: (id: string) => void;

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

type LoadState = BrowseEntry[] | "loading";

/* ---------------- 懒加载结构树 ---------------- */

function LazyTreeInner(props: {
  source: ProjectSource;
  rev: number;
  currentFileName: string;
  onOpenEntry: (e: BrowseEntry) => void;
}) {
  const { source, rev, currentFileName, onOpenEntry } = props;
  const [kids, setKids] = useState<Record<string, LoadState>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""]));

  /** 读某一层（已读过就不重复读） */
  const load = useCallback(
    async (rel: string) => {
      setKids((prev) => (prev[rel] === "loading" ? prev : { ...prev, [rel]: "loading" }));
      const items = await source.listChildren(rel);
      setKids((prev) => ({ ...prev, [rel]: items }));
    },
    [source],
  );

  // 换项目 / 手动刷新：清缓存，只读根这一层
  useEffect(() => {
    let alive = true;
    setKids({});
    setOpen(new Set([""]));
    void source.listChildren("").then((items) => {
      if (alive) setKids({ "": items });
    });
    return () => {
      alive = false;
    };
  }, [source, rev]);

  const toggle = (rel: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (kids[rel] === undefined) void load(rel);
  };

  const renderRows = (rel: string, depth: number): ReactNode[] => {
    const items = kids[rel];
    if (items === "loading") {
      return [
        <li key={`${rel}:loading`}>
          <div className="axv-ws-row axv-ws-row-loading" style={{ paddingLeft: depth * 14 + 26 }}>
            <span className="axv-ws-spin" aria-hidden="true" />
            <span className="axv-ws-item-sub">正在读取…</span>
          </div>
        </li>,
      ];
    }
    if (!items || items.length === 0) {
      if (rel === "") return [];
      return [
        <li key={`${rel}:empty`}>
          <div className="axv-ws-row axv-ws-row-loading" style={{ paddingLeft: depth * 14 + 26 }}>
            <span className="axv-ws-item-sub">（没有可预览的 xml）</span>
          </div>
        </li>,
      ];
    }
    const rows: ReactNode[] = [];
    for (const n of items) {
      const isDir = n.kind === "dir";
      const isOpen = isDir && open.has(n.rel);
      const editing = !isDir && currentFileName && n.name.toLowerCase() === currentFileName.toLowerCase();
      rows.push(
        <li key={n.rel + ":" + n.kind}>
          <div className="axv-ws-row" style={{ paddingLeft: depth * 14 }}>
            {isDir ? (
              <button
                className="axv-ws-caret"
                title={isOpen ? "折叠" : "展开"}
                aria-label={isOpen ? "折叠" : "展开"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.rel);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                  {isOpen ? "expand_more" : "chevron_right"}
                </span>
              </button>
            ) : (
              <span className="axv-ws-caret" aria-hidden="true" />
            )}
            <button
              className="axv-ws-item"
              title={n.rel}
              onClick={() => (isDir ? toggle(n.rel) : onOpenEntry(n))}
            >
              <span className="msr axv-ws-item-icon" aria-hidden="true">
                {isDir ? (isOpen ? "folder_open" : "folder") : "description"}
              </span>
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">{n.name}</span>
                <span className="axv-ws-item-sub">
                  {isDir ? "文件夹" : editing ? "正在编辑" : "布局文件"}
                </span>
              </span>
            </button>
          </div>
        </li>,
      );
      if (isOpen) rows.push(...renderRows(n.rel, depth + 1));
    }
    return rows;
  };

  return <ul className="axv-ws-list axv-proj-tree">{renderRows("", 0)}</ul>;
}

/** M30：树只关心「换了项目 / 手动刷新 / 当前文件名」，父组件其它 state 变化不该让它重建。
 *  onOpenEntry 是内联箭头函数（每帧都是新引用），所以比较时跳过它。 */
const LazyTree = memo(LazyTreeInner, (a, b) =>
  a.source === b.source && a.rev === b.rev && a.currentFileName === b.currentFileName,
);

/* ---------------- 面板 ---------------- */

export function ProjectPanel(p: ProjectPanelProps) {
  const { tr, tab, onTab, wsState, wsBusy, wsMsg, projects, metaOf, projectSource } = p;

  return (
    <div className="axv-rail-scroll">
      {/* M16i：项目管理两个 tab（M24：「工作目录」→「项目列表」） */}
      <div className="axv-proj-tabs">
        <button
          className={"axv-proj-tab" + (tab === "projects" ? " on" : "")}
          onClick={() => {
            onTab("projects");
            void p.onRefresh();
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
              onClick={() => void p.onRefresh()}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
            </button>
          </div>

          <div className="axv-ws-actions">
            <button
              className="axv-rail-mini-btn"
              onClick={() => void p.onOpenDir()}
              title="选一个项目文件夹（含 layout/*.xml）作为当前项目"
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>folder_open</span>
              {tr("proj.open", "打开")}
            </button>
            <button
              className="axv-rail-mini-btn"
              onClick={() => p.onNewProject(p.projectName || "MyApp")}
              title="新建一个带 activity_main.xml 的空项目"
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>add_box</span>
              {tr("proj.new", "新建项目")}
            </button>
          </div>

          {wsState?.mode === "native" && wsState.allFiles === false ? (
            <div className="axv-ws-warn">
              默认目录在存储根下，需要「所有文件访问」权限才能读取。
              <button className="axv-ws-link" onClick={p.onRequestAllFiles}>
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
              <button className="axv-ws-link" onClick={() => void p.onRefresh()}>
                重新授权
              </button>
            </div>
          ) : null}

          {wsBusy ? <div className="axv-ws-hint">正在读取…</div> : null}

          {projects.length > 0 ? (
            <ul className="axv-ws-list">
              {projects.map((it) => {
                const meta = metaOf(it);
                return (
                  <li key={it.rel + ":" + it.kind}>
                    <div className="axv-proj-card">
                      <button
                        className="axv-proj-card-btn"
                        title={it.rel}
                        onClick={() => p.onOpenProject(it)}
                      >
                        <span className="axv-proj-card-ico" aria-hidden="true">
                          {meta?.iconUrl ? (
                            <img src={meta.iconUrl} alt="" />
                          ) : (
                            <span className="msr">{it.kind === "dir" ? "apps" : "description"}</span>
                          )}
                        </span>
                        <span className="axv-ws-item-main">
                          <span className="axv-ws-item-name">{meta?.name || it.name}</span>
                          <span className="axv-ws-item-sub">
                            {it.kind === "dir" ? "项目" : "单个布局"} · {it.name}
                          </span>
                        </span>
                        <span className="msr axv-proj-card-go" aria-hidden="true">chevron_right</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
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
              <b className="axv-proj-now-name" title={p.projectName}>
                {p.projectName || tr("proj.untitled", "未命名项目")}
              </b>
              <button
                className="axv-ws-mini"
                title={tr("proj.refresh", "刷新项目结构")}
                onClick={() => void p.onRefreshProject()}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>

            {projectSource ? (
              <LazyTree
                source={projectSource}
                rev={p.projectRev}
                currentFileName={p.currentFileName}
                onOpenEntry={p.onOpenEntry}
              />
            ) : (
              <ul className="axv-ws-list axv-proj-tree">
                <li>
                  <div className="axv-ws-row" style={{ paddingLeft: 0 }}>
                    <span className="axv-ws-caret" aria-hidden="true" />
                    <span className="axv-ws-item axv-ws-item-static">
                      <span className="msr axv-ws-item-icon" aria-hidden="true">folder_open</span>
                      <span className="axv-ws-item-main">
                        <span className="axv-ws-item-name">layout/</span>
                        <span className="axv-ws-item-sub">{p.appProject.files.length} 个布局</span>
                      </span>
                    </span>
                  </div>
                </li>
                {p.appProject.files.map((f) => (
                  <li key={f.id}>
                    <div className="axv-ws-row" style={{ paddingLeft: 14 }}>
                      <span className="axv-ws-caret" aria-hidden="true" />
                      <button
                        className="axv-ws-item"
                        onClick={() => p.onSelectFile(f.id)}
                        title={f.name}
                      >
                        <span className="msr axv-ws-item-icon" aria-hidden="true">description</span>
                        <span className="axv-ws-item-main">
                          <span className="axv-ws-item-name">
                            {f.id === p.appProject.activeId ? "● " : ""}
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
              <button className="axv-ws-link" onClick={() => void p.onOpenDir()}>
                {tr("proj.openAnother", "打开其他项目…")}
              </button>
              <button className="axv-ws-link" onClick={() => p.onNewProject(p.projectName || "MyApp")}>
                {tr("proj.new", "新建项目")}
              </button>
            </div>
          </div>

          {/* 资源操作按钮（横向排列，树形框上方） */}
          <div style={{ display: "flex", gap: 8, padding: "8px 12px 6px" }}>
            <button
              className="axv-rail-mini-btn"
              title="选择整个 res 目录（推荐：一次导入 drawable / values / mipmap）"
              onClick={() => p.onPickResDir()}
            >
              📁 选择res目录
            </button>
            <button className="axv-rail-mini-btn" title="打开 XML 文件" onClick={p.onOpenXml}>
              📄 打开xml
            </button>
            {p.resExtras ? (
              <button
                className="axv-rail-mini-btn axv-rail-mini-btn-danger"
                style={{ flex: "0 0 auto" }}
                title="清除已上传的 res 资源"
                onClick={p.onClearRes}
              >
                ✖
              </button>
            ) : null}
          </div>
          {p.resExtras?.tree ? (
            <ResTree
              tree={p.resExtras.tree}
              layouts={p.resExtras.layouts}
              extras={p.resExtras}
              onOpenLayout={p.onOpenLayout}
              onOpenDrawable={p.onOpenDrawable}
              onPreviewImage={p.onPreviewImage}
              generated={p.generatedDrawables}
            />
          ) : (
            <>
              <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "var(--axv-on-surface-variant)", lineHeight: 1.5 }}>
                上传 res/ 目录后可在这里以树形浏览资源文件，点击 layout/*.xml 直接预览。
              </div>
              <div className="axv-res-box">
                <textarea
                  value={p.resourceFragment}
                  onChange={(e) => p.onResourceFragment(e.target.value)}
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
