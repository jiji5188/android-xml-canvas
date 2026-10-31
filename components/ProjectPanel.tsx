// components/ProjectPanel.tsx — 左栏「项目管理」面板（M25b 抽出 / M25d 改扁平 + 懒加载）
//
// 两个 tab：
//   项目列表：工作目录的**直接子项**，一行一个项目卡片（图标 + 名称来自项目文件分析），点一下就打开；
//   当前项目：项目结构树，**目录点开才读那一层**（懒加载），不再一次性深扫整棵树。
//
// 树的展开状态、已加载的子项都放在组件内部：它们是纯 UI 状态，没必要塞回 XmlEditor。

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BrowseEntry, ProjectMeta, ProjectSource } from "@/lib/xml/project-browse";
import { isIconDirRel, isImageName, readEntryImageUrl, resDirDescription } from "@/lib/xml/project-browse";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { resOpenAction } from "@/lib/xml/resource-open";
import type { Project } from "@/lib/xml/multi-file";
import type { FileOpsCtx } from "@/lib/xml/file-ops";
import {
  checkNameExists,
  copyEntry,
  createEntry,
  deleteEntry,
  listNames,
  moveEntry,
  renameEntry,
  suggestUniqueName,
} from "@/lib/xml/file-ops";
import {
  ConfirmDialog,
  MessageDialog,
  NewEntryDialog,
  RenameDialog,
  TreeFileMenu,
  type MenuAction,
  type TreeNodeRef,
} from "@/components/TreeFileMenu";

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

  /** M46：文件操作后端（null = 拿不到根，不显示长按菜单） */
  fileOps?: FileOpsCtx | null;
  /** M46：写操作完成后通知外部刷新（+1 projectRev 即可） */
  onFilesChanged?: () => void;
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

/** M46：导出供 jsdom 测试直接挂载（正式使用走下方 memo 包装） */
export function LazyTreeInner(props: {
  source: ProjectSource;
  rev: number;
  currentFileName: string;
  onOpenEntry: (e: BrowseEntry) => void;
  /** M30c：合并资源树的点击行为——drawable/mipmap 里的 xml 走绘制编辑器 / 图片预览 */
  extras: ResourceExtras | null;
  onOpenDrawable: (rel: string, name: string, xml: string) => void;
  onPreviewImage: (rel: string, name: string, url: string) => void;
  /** M46：文件操作（null = 不支持，不绑长按） */
  fileOps?: FileOpsCtx | null;
  onFilesChanged?: () => void;
}) {
  const { source, rev, currentFileName, onOpenEntry, extras, onOpenDrawable, onPreviewImage, fileOps } = props;
  const [kids, setKids] = useState<Record<string, LoadState>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""]));

  /* ---- M46：长按菜单 / 弹窗状态 ---- */
  const [menu, setMenu] = useState<{ x: number; y: number; target: TreeNodeRef } | null>(null);
  const [dlg, setDlg] = useState<
    | { kind: "new"; target: TreeNodeRef }
    | { kind: "rename"; target: TreeNodeRef }
    | { kind: "delete"; target: TreeNodeRef }
    | {
        kind: "conflict";
        title: string;
        desc: string;
        initial: string;
        taken: Set<string>;
        node: TreeNodeRef;
        parentRel: string;
        action: "move" | "paste";
      }
    | { kind: "msg"; title: string; text: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  /** 复制标记（M46） */
  const [clipboard, setClipboard] = useState<TreeNodeRef | null>(null);
  /** M46b：移动模式 —— target 为目标父目录（null = 还没选位置） */
  const [moving, setMoving] = useState<{ node: TreeNodeRef; target: string | null } | null>(null);
  /** 拖拽悬停高亮的目标行 rel */
  const [dropHover, setDropHover] = useState<string | null>(null);
  const dragRef = useRef<{ id: number; node: TreeNodeRef; moved: boolean } | null>(null);

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

  /* ---- M46：长按 → 操作菜单 ---- */
  const pressRef = useRef<{ timer: number | null; x: number; y: number; moved: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    moved: false,
  });

  const cancelPress = () => {
    const st = pressRef.current;
    if (st.timer != null) {
      window.clearTimeout(st.timer);
      st.timer = null;
    }
  };

  const beginPress = (e: React.PointerEvent, node: TreeNodeRef) => {
    if (!fileOps || moving) return;
    if (e.button === 2) {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, target: node });
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const st = pressRef.current;
    cancelPress();
    st.x = e.clientX;
    st.y = e.clientY;
    st.moved = false;
    st.timer = window.setTimeout(() => {
      st.timer = null;
      if (st.moved) return;
      setMenu({ x: st.x, y: st.y, target: node });
    }, 450);
    // ⚠ 手机 WebView 长按后自身会派 pointercancel（文本选择/上下文菜单），
    //    所以抬起/取消都不靠行上的事件，直接挂 window；cancel 不清定时器，
    //    只要没真的滑动（pointermove 超阈值）就照常弹菜单。
    window.addEventListener("pointerup", cancelPress, { once: true });
  };

  const movePress = (e: React.PointerEvent) => {
    const st = pressRef.current;
    if (st.timer == null) return;
    if (Math.abs(e.clientX - st.x) > 8 || Math.abs(e.clientY - st.y) > 8) {
      st.moved = true;
      cancelPress();
    }
  };

  /** 取某个目录层已加载的名字集合（查重用） */
  const takenOf = (parentRel: string): Set<string> => {
    const items = kids[parentRel];
    if (!items || items === "loading") return new Set();
    return new Set(items.map((it) => it.name));
  };

  const parentOfRel = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

  /** 写操作完 → 重读父目录（并清掉该目录下子缓存） */
  const refreshDir = async (parentRel: string) => {
    const items = await source.listChildren(parentRel);
    setKids((prev) => {
      const next: Record<string, LoadState> = { ...prev, [parentRel]: items };
      for (const k of Object.keys(next)) {
        if (k !== parentRel && k.startsWith(parentRel ? parentRel + "/" : "")) delete next[k];
      }
      return next;
    });
    props.onFilesChanged?.();
  };

  const runAction = (a: MenuAction) => {
    const target = menu?.target;
    setMenu(null);
    if (!target) return;
    if (a === "new") return setDlg({ kind: "new", target });
    if (a === "rename") return setDlg({ kind: "rename", target });
    if (a === "delete") return setDlg({ kind: "delete", target });
    if (a === "copy") {
      setClipboard(target);
      setDlg({ kind: "msg", title: "已复制", text: `已复制「${target.name}」，到目标位置长按选「粘贴」。` });
      return;
    }
    if (a === "move") {
      // 进入移动模式：树顶部出确定/取消，每行右侧出拖拽图标
      setMoving({ node: target, target: null });
      return;
    }
    if (a === "paste") void doPaste(target);
  };

  /* ================= M46b：粘贴（含同名冲突引导改名） ================= */

  /** 粘贴 / 移动的目标父目录：目标是目录→里面，是文件→它的同层 */
  const parentTargetOf = (t: TreeNodeRef) => (t.isDir ? t.rel : parentOfRel(t.rel));

  const doPaste = async (target: TreeNodeRef) => {
    if (!fileOps || !clipboard) return;
    const parent = parentTargetOf(target);
    // 防把目录粘到自己内部
    if (clipboard.isDir && (parent === clipboard.rel || parent.startsWith(clipboard.rel + "/"))) {
      setDlg({ kind: "msg", title: "不能粘贴", text: "目标位置在源目录内部。" });
      return;
    }
    setBusy(true);
    const exists = await checkNameExists(fileOps, parent, clipboard.name);
    setBusy(false);
    if (exists) {
      // 冲突 → 引导改名（预填一个不重名的建议）
      const names = await listNames(fileOps, parent);
      setDlg({
        kind: "conflict",
        title: "同名冲突",
        desc: `${parent || "项目根"} 下已有「${clipboard.name}」，请改名后再粘贴`,
        initial: suggestUniqueName(clipboard.name, new Set(names)),
        taken: new Set(names),
        node: clipboard,
        parentRel: parent,
        action: "paste",
      });
      return;
    }
    const r = await copyEntry(fileOps, clipboard.rel, parent);
    if (!r.ok) {
      setDlg({ kind: "msg", title: "粘贴失败", text: reasonText(r.reason) });
      return;
    }
    if (parent) setOpen((prev) => new Set(prev).add(parent));
    await refreshDir(parent);
    setDlg({ kind: "msg", title: "已粘贴", text: `已复制到 ${parent || "项目根"}/` });
  };

  /** 冲突弹窗确认：按新名字落地（移动或复制） */
  const doConflict = async (newName: string) => {
    if (!fileOps || dlg?.kind !== "conflict") return;
    const d = dlg;
    setDlg(null);
    setBusy(true);
    const r =
      d.action === "move"
        ? await moveEntry(fileOps, d.node.rel, d.parentRel, newName)
        : await copyEntry(fileOps, d.node.rel, d.parentRel, newName);
    setBusy(false);
    if (!r.ok) {
      setDlg({ kind: "msg", title: d.action === "move" ? "移动失败" : "粘贴失败", text: reasonText(r.reason) });
      return;
    }
    if (d.parentRel) setOpen((prev) => new Set(prev).add(d.parentRel));
    await refreshDir(d.parentRel);
    if (d.action === "move") await refreshDir(parentOfRel(d.node.rel));
    setMoving(null);
  };

  const reasonText = (r?: string) =>
    r === "web" ? "网页版不支持这个操作，请用 APK。" : r || "未知错误";

  /* ================= M46b：移动（拖拽图标 → 选目标 → 确定） ================= */

  const beginDrag = (e: React.PointerEvent, node: TreeNodeRef) => {
    if (!moving) return;
    e.stopPropagation();
    e.preventDefault();
    const id = e.pointerId;
    dragRef.current = { id, node, moved: false };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      dragRef.current && (dragRef.current.moved = true);
      const hit = rowAtPoint(ev.clientX, ev.clientY);
      setDropHover(hit ? (hit.isDir ? hit.rel : parentOfRel(hit.rel)) : "");
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const hit = rowAtPoint(ev.clientX, ev.clientY);
      const parent = hit ? (hit.isDir ? hit.rel : parentOfRel(hit.rel)) : "";
      setDropHover(null);
      dragRef.current = null;
      setMoving((prev) => (prev ? { ...prev, target: parent } : prev));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** 找指针下的树行 → {rel,isDir}；落在树容器空白→项目根("")；不在树里→null */
  const rowAtPoint = (x: number, y: number): TreeNodeRef | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest?.("[data-treerel]") as HTMLElement | null;
    if (row) {
      return {
        rel: row.getAttribute("data-treerel") || "",
        name: row.getAttribute("data-treename") || "",
        isDir: row.getAttribute("data-treedir") === "1",
      };
    }
    const list = document.querySelector(".axv-proj-tree");
    if (list) {
      const r = list.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { rel: "", name: "", isDir: true }; // 树内空白 = 项目根
      }
    }
    return null;
  };

  const confirmMove = async () => {
    if (!fileOps || !moving || moving.target == null) return;
    const { node, target } = moving;
    const srcParent = parentOfRel(node.rel);
    if (target === srcParent) {
      setMoving(null);
      return;
    }
    if (node.isDir && (target === node.rel || target.startsWith(node.rel + "/"))) {
      setDlg({ kind: "msg", title: "不能移动", text: "目标位置在该目录内部。" });
      return;
    }
    setBusy(true);
    const exists = await checkNameExists(fileOps, target, node.name);
    if (exists) {
      const names = await listNames(fileOps, target);
      setBusy(false);
      setDlg({
        kind: "conflict",
        title: "同名冲突",
        desc: `${target || "项目根"} 下已有「${node.name}」，请改名后再移动`,
        initial: suggestUniqueName(node.name, new Set(names)),
        taken: new Set(names),
        node,
        parentRel: target,
        action: "move",
      });
      return;
    }
    const r = await moveEntry(fileOps, node.rel, target);
    setBusy(false);
    if (!r.ok) {
      setDlg({ kind: "msg", title: "移动失败", text: reasonText(r.reason) });
      return;
    }
    setMoving(null);
    if (target) setOpen((prev) => new Set(prev).add(target));
    await refreshDir(target);
    await refreshDir(srcParent);
  };

  const cancelMove = () => {
    setMoving(null);
    setDropHover(null);
    dragRef.current = null;
  };

  const doCreate = async (o: { name: string; isDir: boolean; parentRel: string }) => {
    if (!fileOps) return;
    setDlg(null);
    setBusy(true);
    const r = await createEntry(fileOps, o);
    setBusy(false);
    if (!r.ok) {
      setDlg({
        kind: "msg",
        title: "创建失败",
        text: r.reason === "web" ? "网页版不支持写操作，请用 APK。" : r.reason || "未知错误",
      });
      return;
    }
    if (o.parentRel) setOpen((prev) => new Set(prev).add(o.parentRel));
    await refreshDir(o.parentRel);
  };

  const doRename = async (newName: string) => {
    const target = dlg?.kind === "rename" ? dlg.target : null;
    if (!fileOps || !target) return;
    setDlg(null);
    setBusy(true);
    const r = await renameEntry(fileOps, target.rel, newName);
    setBusy(false);
    if (!r.ok) {
      setDlg({
        kind: "msg",
        title: "重命名失败",
        text: r.reason === "web" ? "网页版不支持重命名，请用 APK。" : r.reason || "未知错误",
      });
      return;
    }
    await refreshDir(parentOfRel(target.rel));
  };

  const doDelete = async () => {
    const target = dlg?.kind === "delete" ? dlg.target : null;
    if (!fileOps || !target) return;
    setDlg(null);
    setBusy(true);
    const r = await deleteEntry(fileOps, target.rel, target.isDir);
    setBusy(false);
    if (!r.ok) {
      setDlg({
        kind: "msg",
        title: "删除失败",
        text: r.reason === "web" ? "网页版不支持删除，请用 APK。" : r.reason || "未知错误",
      });
      return;
    }
    await refreshDir(parentOfRel(target.rel));
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
      const nodeRef: TreeNodeRef = { rel: n.rel, name: n.name, isDir };
      rows.push(
        <li key={n.rel + ":" + n.kind}>
          <div
            className={
              "axv-ws-row" +
              (moving ? " axv-moving" : "") +
              (moving && moving.node.rel === n.rel ? " axv-move-src" : "") +
              (dropHover === n.rel || (dropHover === "" && false) ? " axv-drop" : "")
            }
            data-treerel={n.rel}
            data-treename={n.name}
            data-treedir={isDir ? "1" : "0"}
            style={{ paddingLeft: depth * 14 }}
            onPointerDown={(e) => beginPress(e, nodeRef)}
            onPointerMove={movePress}
            onContextMenu={(e) => {
              if (!fileOps || moving) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, target: nodeRef });
            }}
          >
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
                  {isDir
                    ? resDirDescription(n.rel) ?? "文件夹"
                    : editing
                      ? "正在编辑"
                      : isImageName(n.name)
                        ? "图片资源"
                        : "布局文件"}
                </span>
              </span>
            </button>
            {moving ? (
              <span
                className="axv-move-handle"
                title="按住拖动到目标目录"
                aria-label="拖动移动"
                onPointerDown={(e) => beginDrag(e, nodeRef)}
              >
                <span className="msr" aria-hidden="true">drag_indicator</span>
              </span>
            ) : null}
          </div>
        </li>,
      );
      if (isOpen) rows.push(...renderRows(n.rel, depth + 1));
    }
    return rows;
  };

  return (
    <>
      {moving ? (
        <div className="axv-move-bar">
          <span className="axv-move-tip">
            {moving.target == null
              ? `拖「${moving.node.name}」到目标目录`
              : `将移动到：${moving.target || "项目根"}/`}
          </span>
          <button className="axv-btn" onClick={() => void confirmMove()} disabled={moving.target == null}>
            确定
          </button>
          <button className="axv-btn axv-ghost" onClick={cancelMove}>
            取消
          </button>
        </div>
      ) : null}
      <ul className="axv-ws-list axv-proj-tree">{renderRows("", 0)}</ul>
      {busy ? <div className="axv-ws-hint">正在处理…</div> : null}

      {menu ? (
        <TreeFileMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          canWrite={!!fileOps && fileOps.backend === "native"}
          hasClipboard={!!clipboard}
          onAction={runAction}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {dlg?.kind === "new" ? (
        <NewEntryDialog
          target={dlg.target}
          takenNames={takenOf(dlg.target.isDir && dlg.target.rel ? dlg.target.rel : parentOfRel(dlg.target.rel))}
          onSubmit={(o) => void doCreate(o)}
          onClose={() => setDlg(null)}
        />
      ) : null}

      {dlg?.kind === "rename" ? (
        <RenameDialog
          target={dlg.target}
          takenNames={takenOf(parentOfRel(dlg.target.rel))}
          onSubmit={(n) => void doRename(n)}
          onClose={() => setDlg(null)}
        />
      ) : null}

      {dlg?.kind === "delete" ? (
        <ConfirmDialog
          title="删除"
          text={`确定删除「${dlg.target.name}」？${dlg.target.isDir ? "目录及其内容将被递归删除，" : ""}此操作不可撤销。`}
          danger
          onOk={() => void doDelete()}
          onClose={() => setDlg(null)}
        />
      ) : null}

      {dlg?.kind === "msg" ? (
        <MessageDialog title={dlg.title} text={dlg.text} onClose={() => setDlg(null)} />
      ) : null}

      {dlg?.kind === "conflict" ? (
        <RenameDialog
          title={dlg.title}
          initial={dlg.initial}
          desc={dlg.desc}
          submitLabel={dlg.action === "move" ? "移动" : "粘贴"}
          takenNames={dlg.taken}
          onSubmit={(n) => void doConflict(n)}
          onClose={() => setDlg(null)}
        />
      ) : null}
    </>
  );
}

/** M30：树只关心「换了项目 / 手动刷新 / 当前文件名」，父组件其它 state 变化不该让它重建。
 *  onOpenEntry / onOpenDrawable / onPreviewImage 是内联箭头函数（每帧都是新引用），所以比较时跳过它们。 */
const LazyTree = memo(LazyTreeInner, (a, b) =>
  a.source === b.source &&
  a.rev === b.rev &&
  a.currentFileName === b.currentFileName &&
  a.extras === b.extras &&
  a.fileOps === b.fileOps,
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
                fileOps={p.fileOps ?? null}
                onFilesChanged={p.onFilesChanged}
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
