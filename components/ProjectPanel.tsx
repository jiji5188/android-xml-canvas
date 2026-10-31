// components/ProjectPanel.tsx — 左栏「项目管理」面板（M25b 抽出 / M25d 改扁平 + 懒加载）
//
// 两个 tab：
//   项目列表：工作目录的**直接子项**，一行一个项目卡片（图标 + 名称来自项目文件分析），点一下就打开；
//   当前项目：项目结构树，**目录点开才读那一层**（懒加载），不再一次性深扫整棵树。
//
// 树的展开状态、已加载的子项都放在组件内部：它们是纯 UI 状态，没必要塞回 XmlEditor。

import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import type { BrowseEntry, ProjectMeta, ProjectSource } from "@/lib/xml/project-browse";
import { isIconDirRel, isImageName, readEntryImageUrl } from "@/lib/xml/project-browse";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { resOpenAction } from "@/lib/xml/resource-open";
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
  /** M31：当前项目图标（ic_launcher 读出来的 URL），空则回退通用图标 */
  projectIconUrl?: string | null;
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

  /** res 资源区（M30c：资源树已删，onOpenLayout/onPickResDir/onOpenXml/onClearRes 不再需要，
   *  点击行为走 LazyTree 的 onOpenDrawable/onPreviewImage） */
  resExtras: ResourceExtras | null;
  onOpenDrawable: (rel: string, name: string, xml: string) => void;
  onPreviewImage: (rel: string, name: string, url: string) => void;
}

type LoadState = BrowseEntry[] | "loading";

/** M31h：文件行图标 —— res/drawable*|mipmap* 里的图片读文件当缩略图，其余用通用图标 */
function TreeRowIcon(props: { entry: BrowseEntry; isDir: boolean; isOpen: boolean; iconDir: boolean }) {
  const { entry, isDir, isOpen, iconDir } = props;
  const wantThumb = !isDir && iconDir && isImageName(entry.name);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wantThumb) return;
    let alive = true;
    void readEntryImageUrl(entry).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [wantThumb, entry]);
  if (isDir) {
    return (
      <span className="msr axv-ws-item-icon" aria-hidden="true">
        {isOpen ? "folder_open" : "folder"}
      </span>
    );
  }
  if (url) {
    return (
      <span className="axv-ws-item-icon axv-ws-item-thumb" aria-hidden="true">
        <img src={url} alt="" />
      </span>
    );
  }
  return (
    <span className="msr axv-ws-item-icon" aria-hidden="true">
      {isImageName(entry.name) ? "image" : "description"}
    </span>
  );
}

/* ---------------- 懒加载结构树 ---------------- */

function LazyTreeInner(props: {
  source: ProjectSource;
  rev: number;
  currentFileName: string;
  onOpenEntry: (e: BrowseEntry) => void;
  /** M30c：合并资源树的点击行为——drawable/mipmap 里的 xml 走绘制编辑器 / 图片预览 */
  extras: ResourceExtras | null;
  onOpenDrawable: (rel: string, name: string, xml: string) => void;
  onPreviewImage: (rel: string, name: string, url: string) => void;
}) {
  const { source, rev, currentFileName, onOpenEntry, extras, onOpenDrawable, onPreviewImage } = props;
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

  /** M30c：原 axv-restree 的点击分流搬到这里
   *  - res/drawable|mipmap 里的 xml：形状 → 绘制编辑器；vector → 图片预览
   *  - 其余（layout / values / menu…）：照旧用编辑器打开（布局会在预览里画出来） */
  const openEntry = async (e: BrowseEntry) => {
    const path = e.rel.toLowerCase();
    const inResDrawable = isIconDirRel(e.rel);
    // M31h：图片（png/webp/jpg…）直接当图片预览，不去读成文本
    if (isImageName(e.name)) {
      const url = await readEntryImageUrl(e);
      if (url) {
        onPreviewImage(e.rel, e.name.replace(/\.[^.]+$/, ""), url);
        return;
      }
    }
    if (inResDrawable) {
      const text = await source.readText(e.rel);
      if (text) {
        const action = resOpenAction(e.rel, text, extras);
        if (action.kind === "drawable") {
          onOpenDrawable(e.rel, action.name, action.xml);
          return;
        }
        if (action.kind === "image" || action.kind === "vector") {
          onPreviewImage(e.rel, action.name, action.url);
          return;
        }
      }
    }
    onOpenEntry(e);
  };

  const renderRows = (rel: string, depth: number): ReactNode[] => {
    const items = kids[rel];
    const iconDir = isIconDirRel(rel);
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
              onClick={() => (isDir ? toggle(n.rel) : void openEntry(n))}
            >
              <TreeRowIcon entry={n} isDir={isDir} isOpen={isOpen} iconDir={iconDir} />
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">{n.name}</span>
                <span className="axv-ws-item-sub">
                  {isDir ? "文件夹" : editing ? "正在编辑" : isImageName(n.name) ? "图片资源" : "布局文件"}
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
 *  onOpenEntry / onOpenDrawable / onPreviewImage 是内联箭头函数（每帧都是新引用），所以比较时跳过它们。 */
const LazyTree = memo(LazyTreeInner, (a, b) =>
  a.source === b.source &&
  a.rev === b.rev &&
  a.currentFileName === b.currentFileName &&
  a.extras === b.extras,
);

/* ---------------- 面板 ---------------- */

export function ProjectPanel(p: ProjectPanelProps) {
  const { tr, tab, onTab, wsState, wsBusy, wsMsg, projects, metaOf, projectSource } = p;

  return (
    <div className="axv-rail-scroll axv-rail-fill">
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

            <button
              className="axv-ws-mini"
              title="刷新列表"
              onClick={() => void p.onRefresh()}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
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
                          <span className="axv-ws-item-name" title={meta?.name || it.name}>
                            {meta?.name || it.name}
                          </span>
                          <span className="axv-ws-item-sub">
                            {it.kind === "dir"
                              ? meta?.name && meta.name !== it.name
                                ? `项目 · ${it.name}`
                                : "项目"
                              : `单个布局 · ${it.name}`}
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
          {/* M30c：foot 放到 axv-proj-now 的前面 */}
          <div className="axv-proj-now-foot">
            <button className="axv-ws-link" onClick={() => void p.onOpenDir()}>
              {tr("proj.openAnother", "打开其他项目…")}
            </button>
            <button className="axv-ws-link" onClick={() => p.onNewProject(p.projectName || "MyApp")}>
              {tr("proj.new", "新建项目")}
            </button>
          </div>

          {/* M24：当前项目结构 */}
          <div className="axv-proj-now">
            <div className="axv-proj-now-head">
              {/* M31：图标优先用项目自己的 ic_launcher，读不到才回退通用图标 */}
              {p.projectIconUrl ? (
                <img className="axv-proj-now-icon" src={p.projectIconUrl} alt="" aria-hidden="true" />
              ) : (
                <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>work</span>
              )}
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
                extras={p.resExtras}
                onOpenDrawable={p.onOpenDrawable}
                onPreviewImage={p.onPreviewImage}
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
          </div>

          {/* M30c：资源树（axv-restree）已删除——点击行为合并到上方 axv-ws-list axv-proj-tree 的行里；
              原「选择res目录 / 打开xml」按钮行也删了（工具栏都有） */}
          <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "var(--axv-on-surface-variant)", lineHeight: 1.5 }}>
            点上方结构树里的文件直接打开（drawable 形状 → 绘制编辑器，vector/图片 → 预览）。
          </div>
        </>
      )}
    </div>
  );
}
