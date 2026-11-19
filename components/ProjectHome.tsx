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

import { useEffect, useRef, useState } from "react";
import { useXmlProjectState } from "./use-xml-project";
import type { WsProject } from "@/lib/xml/workspace";
import { fileOpsCtxOf, projectSourceFromWorkspaceItem, type ProjectSource } from "@/lib/xml/project-browse";
import { deleteEntry } from "@/lib/xml/file-ops";
import type { ProjectSaveRoot } from "@/lib/xml/project-save";
import { ProjectPropsDialog } from "@/components/ProjectPropsDialog";
import { t as tt } from "@/lib/i18n-src";

export interface ProjectHomeProps {
  /** 点开一个项目 → shell 切到编辑器并自动打开 */
  onOpenProject: (item: WsProject) => void;
  /** 不选项目直接进编辑器（老入口：新建项目 / 打开文件 / 示例都在编辑器里） */
  onOpenEditor: () => void;
}

/** 稳定的空 setter：不能写成内联箭头（见下方注释） */
const NOOP = () => {};

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
  mask: { position: "fixed", inset: 0, zIndex: 900, background: "transparent" },
  menu: { position: "fixed", zIndex: 901, minWidth: 150, padding: 4, borderRadius: 10, background: "#FFFFFF", border: "1px solid #E3E6EB", boxShadow: "0 4px 16px rgba(0,0,0,.12)" },
  menuItem: { display: "block", width: "100%", padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#1B1B1F", fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left" },
  menuItemDanger: { color: "#B3261E" },
  menuHint: { display: "block", fontSize: 11, color: "#9AA0A8", marginTop: 2, fontWeight: 400 },
};

export function ProjectHome({ onOpenProject, onOpenEditor }: ProjectHomeProps) {
  // ⚠️ 必须是稳定引用：传内联箭头会让 refreshWorkspace(useCallback) 每帧换身份，
  // 进而触发 use-workspace-refresh 里的刷新 effect 无限重跑（卡在「读取中」）。
  const {
    wsState, wsProjects, wsBusy, projMeta,
    refreshWorkspace, pickCustomDir,
  } = useXmlProjectState({ leftView: "res", setWsMsg: NOOP });

  /** M423：卡片长按菜单（打开 / 项目属性 / 删除） */
  const [menu, setMenu] = useState<{ x: number; y: number; item: WsProject } | null>(null);
  /** M423：项目属性弹窗 */
  const [propsFor, setPropsFor] = useState<{ item: WsProject; source: ProjectSource; saveRoot: ProjectSaveRoot | null } | null>(null);
  const [msgLocal, setMsgLocal] = useState("");
  const pressRef = useRef<{ timer: number | null; x: number; y: number; moved: boolean; fired: boolean }>({
    timer: null, x: 0, y: 0, moved: false, fired: false,
  });
  const cancelPress = () => {
    const st = pressRef.current;
    if (st.timer !== null) {
      window.clearTimeout(st.timer);
      st.timer = null;
    }
  };
  useEffect(() => cancelPress, []);

  /** 长按 450ms / 鼠标右键 → 弹菜单（同 ProjectPanel 卡片菜单的模式） */
  const beginPress = (e: React.PointerEvent, it: WsProject) => {
    if (e.button === 2) {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, item: it });
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const st = pressRef.current;
    cancelPress();
    st.x = e.clientX;
    st.y = e.clientY;
    st.moved = false;
    st.fired = false;
    st.timer = window.setTimeout(() => {
      st.timer = null;
      st.fired = true;
      if (st.moved) return;
      setMenu({ x: st.x, y: st.y, item: it });
    }, 450);
    window.addEventListener("pointerup", cancelPress, { once: true });
  };

  /** 属性：从卡片项现读 source（同 ProjectPanel openProps） */
  const openProps = async (it: WsProject) => {
    setMenu(null);
    const src = await projectSourceFromWorkspaceItem(it);
    if (!src) {
      setMsgLocal(tt("这个项目读不了（可能不是目录，或权限已失效）"));
      return;
    }
    const ops = fileOpsCtxOf(it);
    let saveRoot: ProjectSaveRoot | null = null;
    if (ops) {
      if (ops.backend === "native") {
        const base = String(ops.root).replace(/\/+$/, "");
        if (base.startsWith("/")) saveRoot = { kind: "native", base };
      } else {
        saveRoot = { kind: "handle", handle: ops.root };
      }
    }
    setPropsFor({ item: it, source: src, saveRoot });
  };

  /** 删除整个项目目录（仅 native：需要绝对路径的父目录作为操作根） */
  const doDelete = async (it: WsProject) => {
    setMenu(null);
    if (!it.dirPath) {
      setMsgLocal(tt("网页版不支持删项目，请用 APK。"));
      return;
    }
    const clean = it.dirPath.replace(/[/\\]+$/, "");
    const parent = clean.replace(/[/\\][^/\\]+$/, "");
    const base = clean.split(/[/\\]/).pop() || it.name;
    if (!window.confirm(tt("确定删除项目「{name}」？整个目录连同源码一起删，不能撤销。", { name: it.name }))) return;
    const r = await deleteEntry({ backend: "native", root: parent }, base, true);
    if (!r.ok) {
      setMsgLocal(tt("删除失败：{msg}", { msg: r.reason || tt("未知错误") }));
      return;
    }
    setMsgLocal(tt("已删除 {name}", { name: it.name }));
    void refreshWorkspace();
  };

  // 进页面刷一次；12s 静默轮询由 use-workspace-refresh 自带（leftView=res）
  useEffect(() => {
    // 进页面刷一次；12s 静默轮询由 use-workspace-refresh 自带（leftView=res）
    void refreshWorkspace();
    // M413：不再传 refreshWorkspace 作依赖——它的 useCallback deps 里有 setWsMsg，
    // 调用方每帧传新引用会连坐导致本 hook 的 effect 死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unsupported = wsState?.mode === "unsupported";
  /** busy = 正在读取；M413 修好循环后它只会持续几百 ms，不会再卡死 */
  const loading = wsBusy;

  return (
    <div style={S.page} className="axv-home">
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
        <button type="button" style={S.btn} onClick={() => void refreshWorkspace()} disabled={loading}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>refresh</span>
          {loading ? tt("读取中…") : tt("刷新")}
        </button>
        <button type="button" style={S.btn} onClick={onOpenEditor}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>add</span>
          {tt("新建 / 示例项目")}
        </button>
      </div>

      <div style={S.msg}>{msgLocal || (loading ? tt("正在读取工作目录…") : "")}</div>

      {wsProjects.length === 0 && !loading ? (
        <div style={S.empty}>
          {unsupported
            ? tt("这个浏览器拿不到目录权限。点右上角「进入编辑器」仍可编辑单文件。")
            : tt("工作目录里还没有项目。把 Android 项目文件夹放进工作目录后点「刷新」，或直接打开一个项目目录。")}
        </div>
      ) : null}

      <div style={S.list}>
        {wsProjects.map((it) => {
          const meta = projMeta[it.rel];
          const canDelete = !!it.dirPath;
          return (
            <button
              key={it.kind + ":" + it.rel}
              type="button"
              style={S.card}
              onPointerDown={(e) => beginPress(e, it)}
              onPointerMove={(e) => {
                const st = pressRef.current;
                if (st.timer !== null && (Math.abs(e.clientX - st.x) > 10 || Math.abs(e.clientY - st.y) > 10)) {
                  st.moved = true;
                  cancelPress();
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, item: it });
              }}
              onClick={() => {
                // M423：长按已触发菜单时，吞掉随后的 click（否则点菜单位置会把项目也打开）
                if (pressRef.current.fired) {
                  pressRef.current.fired = false;
                  return;
                }
                onOpenProject(it);
              }}
              onPointerCancel={cancelPress}
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

      {/* M423：卡片长按菜单（打开 / 项目属性 / 删除项目） */}
      {menu ? (
        <>
          <div style={S.mask} onClick={() => setMenu(null)} />
          <div
            role="menu"
            style={{
              ...S.menu,
              left: Math.max(6, Math.min(menu.x, window.innerWidth - 156)),
              top: Math.max(6, Math.min(menu.y, window.innerHeight - 150)),
            }}
          >
            <button
              type="button"
              role="menuitem"
              style={S.menuItem}
              onClick={() => {
                setMenu(null);
                onOpenProject(menu.item);
              }}
            >
              {tt("打开")}
            </button>
            <button
              type="button"
              role="menuitem"
              style={S.menuItem}
              onClick={() => void openProps(menu.item)}
            >
              {tt("项目属性")}
            </button>
            <button
              type="button"
              role="menuitem"
              style={{ ...S.menuItem, ...S.menuItemDanger }}
              disabled={!canDeleteOf(menu.item)}
              onClick={() => void doDelete(menu.item)}
            >
              {tt("删除项目")}
              {!canDeleteOf(menu.item) ? <span style={S.menuHint}>{tt("网页版不支持，请用 APK")}</span> : null}
            </button>
          </div>
        </>
      ) : null}

      {/* M423：项目属性弹窗（从卡片菜单进，不带 onRenameProject —— 改目录名走编辑器内） */}
      {propsFor ? (
        <ProjectPropsDialog
          item={propsFor.item}
          source={propsFor.source}
          saveRoot={propsFor.saveRoot}
          fileOpsCtx={fileOpsCtxOf(propsFor.item)}
          onSaved={() => {
            setPropsFor(null);
            void refreshWorkspace();
          }}
          onClose={() => setPropsFor(null)}
        />
      ) : null}
    </div>
  );
}

/** 与 ProjectPanel 卡片菜单同规则：只有 native 目录项目可删 */
function canDeleteOf(it: WsProject): boolean {
  return !!it.dirPath;
}
