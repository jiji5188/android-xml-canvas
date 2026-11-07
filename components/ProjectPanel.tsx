// components/ProjectPanel.tsx — 左栏「项目管理」面板（M25b 抽出 / M25d 改扁平 + 懒加载）
//
// 两个 tab：
//   项目列表：工作目录的**直接子项**，一行一个项目卡片（图标 + 名称来自项目文件分析），点一下就打开；
//   当前项目：项目结构树，**目录点开才读那一层**（懒加载），不再一次性深扫整棵树。
//
// 树的展开状态、已加载的子项都放在组件内部：它们是纯 UI 状态，没必要塞回 XmlEditor。

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t as tt } from "@/lib/i18n-src";
import { groupResDirs, resSearchMatches } from "@/lib/xml/res-search";
import type { BrowseEntry, LibKind, ProjectMeta, ProjectSource } from "@/lib/xml/project-browse";
import { isIconDirRel, isImageName, readEntryImageUrl, resDirDescription, describeFile } from "@/lib/xml/project-browse";
import { parseDrawable, flattenDrawable } from "@/lib/xml/drawable-node";
import { argbColorsForPreview, specToCss } from "@/lib/xml/shape-gen";
import { androidColorToCss } from "@/lib/xml/color-argb";
import { DEFAULT_ICON_URL } from "@/lib/xml/default-icon";
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
  fileOpsCtxOf,
  projectSourceFromWorkspaceItem,
} from "@/lib/xml/project-browse";
import { saveProjectFile, type ProjectSaveRoot } from "@/lib/xml/project-save";
import { ProjectPropsDialog } from "@/components/ProjectPropsDialog";
import {
  ConfirmDialog,
  MessageDialog,
  NewEntryDialog,
  Overlay,
  RenameDialog,
  TreeFileMenu,
  type MenuAction,
  type TreeNodeRef,
} from "@/components/TreeFileMenu";

/**
 * M101：资源路径 → 引用符号（如 `res/drawable/bg_card.xml` → `drawable/bg_card`）。
 * 查不出（非资源路径 / 查不到）返回 null，不阻断删除。
 */
function resSymbolOf(rel: string): string | null {
  const m = /\/res\/(layout|drawable|mipmap|values|raw|font|anim|animator|menu|xml|color|interpolator|transition|navigation)[^/]*\/([^/]+)$/.exec(rel);
  if (!m) return null;
  const type = m[1];
  const name = m[2];
  if (type === "values") {
    // values 里是文件级的（strings.xml 本身没法用一条资源表示），跳过
    return null;
  }
  return `${type}/${name.replace(/\.[^.]+$/, "")}`;
}

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
  /** M176：改项目名（目录名）/ app 名称 */
  onRenameProject?: (p: WsProject, dirName: string, appName: string) => Promise<{ ok: boolean; msg: string }>;

  /** M180：重命名资源文件 → 同步改全项目对它的引用（布局/values/Java） */
  onRenameResource?: (oldRel: string, newName: string) => Promise<{ ok: boolean; msg: string }>;

  /** M180：把图标库里的图标填入选中节点的属性（src/background/foreground…） */
  onFillIconAttr?: (attr: string, resourceName: string, vectorXml: string) => void;

  /** 当前项目 */
  projectName: string;
  /** M31：当前项目图标（ic_launcher 读出来的 URL），空则回退通用图标 */
  projectIconUrl?: string | null;
  projectSource: ProjectSource | null;
  /** 手动刷新时外部 +1，用来清掉懒加载缓存重新读 */
  projectRev: number;
  currentFileName: string;
  onOpenEntry: (e: BrowseEntry) => void;
  /** M144：当前打开的文件在项目内的相对路径（面板要高亮并滚动定位到它） */
  currentRel?: string | null;
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

  /**
   * M101：删除前的影响面查询 —— 给一个资源符号（如 `drawable/bg_card`），
   * 返回“被几处引用 + 前 3 处位置”；查不到或没实现返回 null。
   * 删除确认弹窗里展示，避免删完才发现在别处用了。
   */
  checkDeleteImpact?: (
    symbol: string,
  ) => Promise<{ count: number; samples: { rel: string; line: number }[] } | null>;
}

type LoadState = BrowseEntry[] | "loading";

/** M48：项目列表副标题文案（库类型） */
function libLabel(lib: LibKind | undefined): string {
  if (lib === "androidx") return tt("AndroidX 项目");
  if (lib === "support") return tt("Android Support 项目");
  if (lib === "android") return tt("Android 项目");
  return tt("项目");
}
/** M144：图标目录里的 xml / svg 也要真显示成图标 —— 模级缓存（rel → 缩略图）避免每帧重读文件 */
type IconThumb = { url?: string; css?: React.CSSProperties };
const iconThumbCache = new Map<string, IconThumb>();
const ICON_THUMB_MAX = 120;
function cacheThumb(key: string, v: IconThumb): IconThumb {
  iconThumbCache.delete(key);
  iconThumbCache.set(key, v);
  while (iconThumbCache.size > ICON_THUMB_MAX) {
    const oldest = iconThumbCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    iconThumbCache.delete(oldest);
  }
  return v;
}

/** M144：把一份 drawable xml 变成能画的小图标（vector 转 dataURL，shape/selector 转 CSS） */
function thumbOfDrawableXml(rel: string, text: string, extras: ResourceExtras | null): IconThumb | null {
  const action = resOpenAction(rel, text, extras);
  if (action.kind === "vector" || action.kind === "image") {
    return action.url ? { url: action.url } : null;
  }
  if (action.kind !== "drawable") return null;
  const tree = parseDrawable(action.xml);
  if (!tree) return null;
  const layers = flattenDrawable(tree, {});
  // 从最上层往下找能画的（shape / color）；都没有就返回 null（保持通用图标）
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.kind === "shape" && l.spec) {
      const css = specToCss(argbColorsForPreview(l.spec));
      return {
        css: {
          background: css.background,
          borderRadius: css.borderRadius,
          border: css.border,
          boxShadow: css.boxShadow,
        },
      };
    }
    if (l.kind === "color") {
      return { css: { background: androidColorToCss(l.color ?? "#00000000") } };
    }
  }
  return null;
}

/** M31h + M144：文件行图标 —— 图片读文件当缩略图；图标目录里的 xml/svg 也真画出来 */
function TreeRowIcon(props: {
  entry: BrowseEntry;
  isDir: boolean;
  isOpen: boolean;
  iconDir: boolean;
  source?: ProjectSource;
  extras?: ResourceExtras | null;
}) {
  const { entry, isDir, isOpen, iconDir, source, extras } = props;
  const isImg = !isDir && isImageName(entry.name);
  const isSvg = !isDir && /\.svg$/i.test(entry.name);
  const isXml = !isDir && /\.xml$/i.test(entry.name);
  const wantThumb = !isDir && iconDir && (isImg || isSvg || isXml);
  const [thumb, setThumb] = useState<IconThumb | null>(null);

  useEffect(() => {
    if (!wantThumb) return;
    const key = entry.target || entry.rel;
    const cached = iconThumbCache.get(key);
    if (cached) {
      setThumb(cached);
      return;
    }
    let alive = true;
    void (async () => {
      let out: IconThumb | null = null;
      if (isImg) {
        const u = await readEntryImageUrl(entry);
        out = u ? { url: u } : null;
      } else if (isSvg) {
        // svg 本身就能当图片用，不用 base64
        const text = source ? await source.readText(entry.rel).catch(() => null) : null;
        out = text ? { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}` } : null;
      } else if (isXml) {
        const text = source ? await source.readText(entry.rel).catch(() => null) : null;
        out = text ? thumbOfDrawableXml(entry.rel, text, extras ?? null) : null;
      }
      if (alive) setThumb(out ? cacheThumb(key, out) : null);
    })();
    return () => {
      alive = false;
    };
  }, [wantThumb, isImg, isSvg, isXml, entry, source, extras]);

  if (isDir) {
    return (
      <span className="msr axv-ws-item-icon" aria-hidden="true">
        {isOpen ? "folder_open" : "folder"}
      </span>
    );
  }
  if (thumb?.url) {
    return (
      <span className="axv-ws-item-icon axv-ws-item-thumb" aria-hidden="true">
        <img src={thumb.url} alt="" />
      </span>
    );
  }
  if (thumb?.css) {
    return (
      <span className="axv-ws-item-icon axv-ws-item-thumb" aria-hidden="true">
        <span className="axv-ws-item-thumb-shape" style={thumb.css} />
      </span>
    );
  }
  return (
    <span className="msr axv-ws-item-icon" aria-hidden="true">
      {isImg || isSvg ? "image" : isXml && iconDir ? "palette" : "description"}
    </span>
  );
}

/* ---------------- 懒加载结构树 ---------------- */

/** M144：展开目录的持久化（key = 项目名，值 = 展开的 rel 数组） */
const OPEN_STATE_PREFIX = "axv.tree.open.";
function readOpenState(storeKey: string | undefined): string[] | null {
  if (!storeKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OPEN_STATE_PREFIX + storeKey);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}
function writeOpenState(storeKey: string | undefined, rels: string[]): void {
  if (!storeKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_STATE_PREFIX + storeKey, JSON.stringify(rels));
  } catch {
    /* 配额/隐私模式静默 */
  }
}

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
  /** M101：删除前的影响面查询（可选，查不到就不展示） */
  checkDeleteImpact?: (
    symbol: string,
  ) => Promise<{ count: number; samples: { rel: string; line: number }[] } | null>;
  /** M144：当前打开的文件在项目内的相对路径，用来展开祖先并滚动定位 */
  currentRel?: string | null;
  /** M144：持久化展开状态的 key（按项目区分，换项目不串） */
  storeKey?: string;
  /** M180：重命名资源文件 → 同步改全项目对它的引用（传了才出「重命名」项） */
  onRenameResource?: (oldRel: string, newName: string) => Promise<{ ok: boolean; msg: string }>;
  /** M180：把图标库里的图标填入选中节点的属性（src/background/foreground…） */
  onFillIconAttr?: (attr: string, resourceName: string, vectorXml: string) => void;
}) {
  const {
    source,
    rev,
    currentFileName,
    onOpenEntry,
    extras,
    onOpenDrawable,
    onPreviewImage,
    fileOps,
    checkDeleteImpact,
    currentRel,
    storeKey,
  } = props;
  const [kids, setKids] = useState<Record<string, LoadState>>({});
  const [open, setOpen] = useState<Set<string>>(() => {
    // M144：从 localStorage 恢复上次展开的目录（按 storeKey 区分项目）
    const restored = readOpenState(storeKey);
    return new Set(restored ? ["", ...restored] : [""]);
  });
  /** M144：ul 的 ref，定位当前文件时用 scrollIntoView */
  const listRef = useRef<HTMLUListElement>(null);

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
  /** M180：搜索 + res 目录虚拟分组折叠 */
  const [resQuery, setResQuery] = useState("");
  /** M180：res/ 下按类型折叠的组（展开后看到真实限定符目录） */
  const [resGroupOpen, setResGroupOpen] = useState<Set<string>>(() => new Set());
  /** M180：搜索扫描到的整棵文件列表（首次搜索时拉一次，刷新后失效） */
  const [scanAll, setScanAll] = useState<Array<{ rel: string; name: string; isDir: boolean }> | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  /** 复制标记（M46） */
  const [clipboard, setClipboard] = useState<TreeNodeRef | null>(null);
  /** M46b：移动模式 —— target 为目标父目录（null = 还没选位置） */
  const [moving, setMoving] = useState<{ node: TreeNodeRef; target: string | null } | null>(null);
  /** 拖拽悬停高亮的目标行 rel */
  const [dropHover, setDropHover] = useState<string | null>(null);
  const dragRef = useRef<{ id: number; node: TreeNodeRef; moved: boolean } | null>(null);

  /** 读某一层（已读过就不重复读，也不回退成 loading，避免刷新时闪一下） */
  const load = useCallback(
    async (rel: string) => {
      // M48：只有从没读过才放 loading；重读时保留旧内容直到新结果回来
      setKids((prev) => (prev[rel] === undefined ? { ...prev, [rel]: "loading" } : prev));
      const items = await source.listChildren(rel);
      setKids((prev) => ({ ...prev, [rel]: items }));
    },
    [source],
  );

  // M48：ref 记一下当前项目源，只有真的换了项目才清空缓存；
  // 后台轮询把 rev 顶高时只安静重读根节点，不清 kids / open ——
  // 之前这里是列表频闪「正在读取…」的根源。
  const lastSrcRef = useRef<unknown>(null);
  useEffect(() => {
    let alive = true;
    if (lastSrcRef.current !== source) {
      lastSrcRef.current = source;
      setKids({});
      // M144：换项目时恢复该项目上次展开的目录（没存过就只开根）
      const restored = readOpenState(storeKey) || [];
      setOpen(new Set(["", ...restored]));
      restored.forEach((rel) => {
        void source.listChildren(rel).then((items) => {
          if (alive) setKids((prev) => ({ ...prev, [rel]: items }));
        });
      });
    }
    void source.listChildren("").then((items) => {
      if (alive) setKids((prev) => ({ ...prev, "": items }));
    });
    return () => {
      alive = false;
    };
  }, [source, rev, storeKey]);

  // M144：展开状态变化就存下来（下次进来还是这几层打开）
  useEffect(() => {
    writeOpenState(storeKey, [...open].filter((r) => r !== ""));
  }, [open, storeKey]);

  // M144：当前文件 → 展开它的祖先目录（没有加载过的逐层拉）
  useEffect(() => {
    const rel = currentRel || "";
    if (!rel) return;
    const parts = rel.split("/").filter(Boolean);
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("/"));
    if (!ancestors.length) return;
    setOpen((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const a of ancestors) {
      if (kids[a] === undefined) void load(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRel, source]);

  // M144：树里有当前文件那一行后，滚动到可见位置（居中，不抢焦点）
  useEffect(() => {
    const ul = listRef.current;
    if (!ul || !currentRel) return;
    const rows = Array.from(ul.querySelectorAll("[data-treerel]"));
    const hit = rows.find((el) => el.getAttribute("data-treerel") === currentRel);
    if (!hit) return;
    const scroller = ul.parentElement;
    if (!scroller) return;
    const rowRect = hit.getBoundingClientRect();
    const boxRect = scroller.getBoundingClientRect();
    const top = rowRect.top - boxRect.top + scroller.scrollTop - scroller.clientHeight / 2 + rowRect.height / 2;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      scroller.scrollTop = Math.max(0, top);
    }
  }, [currentRel, kids, open]);

  const toggle = (rel: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (kids[rel] === undefined) void load(rel);
  };

  /* ---- M180：搜索（递归扫盘一次，然后本地过滤） ---- */
  const MAX_SCAN = 900;
  const scanTree = async () => {
    if (scanBusy) return;
    if (scanAll) return;
    setScanBusy(true);
    const out: Array<{ rel: string; name: string; isDir: boolean }> = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > 9 || out.length >= MAX_SCAN) return;
      const items = await source.listChildren(rel);
      for (const it of items) {
        if (out.length >= MAX_SCAN) return;
        out.push({ rel: it.rel, name: it.name, isDir: it.kind === "dir" });
        if (it.kind === "dir") await walk(it.rel, depth + 1);
      }
    };
    await walk("", 0);
    setScanAll(out);
    setScanBusy(false);
  };

  const searchHits = useMemo(
    () => (resQuery.trim() && scanAll ? resSearchMatches(scanAll, resQuery, 200) : []),
    [resQuery, scanAll],
  );

  // 刷新时代（rev 变）才让搜索缓存失效；不能看 source 对象引用，否则每帧都清空
  const scanRevRef = useRef(rev);
  useEffect(() => {
    if (scanRevRef.current !== rev) {
      scanRevRef.current = rev;
      setScanAll(null);
    }
  }, [rev]);

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

  /* ---- M180：把选中的 drawable 直接填给当前选中控件的 src ---- */
  const doFill = async (symbol: string) => {
    if (!props.onFillIconAttr) return;
    // symbol 形如 drawable/ic_star；回调只要裸名（@drawable/<名> 由调用方拼）
    const name = symbol.includes("/") ? symbol.slice(symbol.lastIndexOf("/") + 1) : symbol;
    let xml = "";
    try {
      const rel = Object.entries(kids)
        .flatMap(([, v]) => (Array.isArray(v) ? v : []))
        .find((it) => it.kind === "file" && it.name.replace(/\.[^.]+$/, "") === name && /(^|\/)res\/(drawable|mipmap)/.test(it.rel));
      if (rel) xml = (await source.readText(rel.rel)) || "";
    } catch {
      xml = "";
    }
    props.onFillIconAttr("src", name, xml);
    setDlg({
      kind: "msg",
      title: tt("已填入"),
      text: xml
        ? tt("已把 @drawable/{name} 填给选中控件的 src", { name })
        : tt("已把 @drawable/{name} 填给选中控件的 src（图片资源不带 xml 正文）", { name }),
    });
  };

  /* ---- M46：长按 → 操作菜单 ---- */
  const pressRef = useRef<{ timer: number | null; x: number; y: number; moved: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    moved: false,
  });
  /** 长按已弹菜单 → 抬起时补发的那次 click 不要再打开文件 */
  const suppressClick = useRef(false);

  const cancelPress = () => {
    const st = pressRef.current;
    if (st.timer != null) {
      window.clearTimeout(st.timer);
      st.timer = null;
    }
  };

  /** M180：「填入选中控件」不靠文件写入能力，web 模式也要能用 */
  const canMenu = !!fileOps || !!props.onFillIconAttr;

  const beginPress = (e: React.PointerEvent, node: TreeNodeRef) => {
    if (!canMenu || moving) return;
    if (e.button === 2) {
      e.preventDefault();
      suppressClick.current = true;
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
      suppressClick.current = true;
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

  /** M101：删除确认框里的“影响面”查询结果（null = 还在查/不适用） */
  const [deleteImpact, setDeleteImpact] = useState<{
    count: number;
    samples: { rel: string; line: number }[];
  } | null>(null);

  const runAction = (a: MenuAction) => {
    const target = menu?.target;
    setMenu(null);
    if (!target) return;
    if (a === "new") return setDlg({ kind: "new", target });
    if (a === "rename") return setDlg({ kind: "rename", target });
    if (a === "delete") {
      setDlg({ kind: "delete", target });
      // M101：打开确认框时异步查影响面（不阻塞弹窗出现）
      setDeleteImpact(null);
      const sym = resSymbolOf(target.rel);
      if (sym && props.checkDeleteImpact) {
        void props
          .checkDeleteImpact(sym)
          .then((r) => setDeleteImpact(r))
          .catch(() => setDeleteImpact(null));
      }
      return;
    }
    if (a === "fill") void doFill(resSymbolOf(target.rel) || target.name.replace(/\.[^.]+$/, ""));
    if (a === "copy") {
      setClipboard(target);
      setDlg({ kind: "msg", title: tt("已复制"), text: tt("已复制「{name}」，到目标位置长按选「粘贴」。", { name: target.name }) });
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
      setDlg({ kind: "msg", title: tt("不能粘贴"), text: tt("目标位置在源目录内部。") });
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
        title: tt("同名冲突"),
        desc: tt("{parent} 下已有「{name}」，请改名后再粘贴", { parent: parent || tt("项目根"), name: clipboard.name }),
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
      setDlg({ kind: "msg", title: tt("粘贴失败"), text: reasonText(r.reason) });
      return;
    }
    if (parent) setOpen((prev) => new Set(prev).add(parent));
    await refreshDir(parent);
    setClipboard(null); // 用户要求：粘贴完成后清掉复制标记
    setDlg({ kind: "msg", title: tt("已粘贴"), text: tt("已复制到 {parent}/", { parent: parent || tt("项目根") }) });
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
      setDlg({ kind: "msg", title: d.action === "move" ? tt("移动失败") : tt("粘贴失败"), text: reasonText(r.reason) });
      return;
    }
    if (d.parentRel) setOpen((prev) => new Set(prev).add(d.parentRel));
    await refreshDir(d.parentRel);
    if (d.action === "move") {
      await refreshDir(parentOfRel(d.node.rel));
      setMoving(null);
    } else {
      setClipboard(null); // 改名粘贴成功也清标记
      setDlg({ kind: "msg", title: tt("已粘贴"), text: tt("已复制为 {name}", { name: newName }) });
    }
  };

  const reasonText = (r?: string) =>
    r === "web" ? tt("网页版不支持这个操作，请用 APK。") : r || tt("未知错误");

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
      setDlg({ kind: "msg", title: tt("不能移动"), text: tt("目标位置在该目录内部。") });
      return;
    }
    setBusy(true);
    const exists = await checkNameExists(fileOps, target, node.name);
    if (exists) {
      const names = await listNames(fileOps, target);
      setBusy(false);
      setDlg({
        kind: "conflict",
        title: tt("同名冲突"),
        desc: tt("{parent} 下已有「{name}」，请改名后再移动", { parent: target || tt("项目根"), name: node.name }),
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
      setDlg({ kind: "msg", title: tt("移动失败"), text: reasonText(r.reason) });
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
        title: tt("创建失败"),
        text: r.reason === "web" ? tt("网页版不支持写操作，请用 APK。") : r.reason || tt("未知错误"),
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
        title: tt("重命名失败"),
        text: r.reason === "web" ? tt("网页版不支持重命名，请用 APK。") : r.reason || tt("未知错误"),
      });
      return;
    }
    // M180：res/ 下的文件改名 → 同步改全项目对它的 @type/name 引用
    if (props.onRenameResource && /(^|\/)res\//.test(target.rel)) {
      const rr = await props.onRenameResource(target.rel, newName);
      if (!rr.ok && rr.msg) {
        setDlg({ kind: "msg", title: tt("已重命名，但引用同步失败"), text: rr.msg });
        await refreshDir(parentOfRel(target.rel));
        return;
      }
      if (rr.msg) setDlg({ kind: "msg", title: tt("已重命名"), text: rr.msg });
    }
    await refreshDir(parentOfRel(target.rel));
  };

  const doDelete = async () => {
    const target = dlg?.kind === "delete" ? dlg.target : null;
    if (!fileOps || !target) return;
    setDlg(null);
    setDeleteImpact(null);
    setBusy(true);
    const r = await deleteEntry(fileOps, target.rel, target.isDir);
    setBusy(false);
    if (!r.ok) {
      setDlg({
        kind: "msg",
        title: tt("删除失败"),
        text: r.reason === "web" ? tt("网页版不支持删除，请用 APK。") : r.reason || tt("未知错误"),
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
            <span className="axv-ws-item-sub">{tt("正在读取…")}</span>
          </div>
        </li>,
      ];
    }
    if (!items || items.length === 0) {
      if (rel === "") return [];
      return [
        <li key={`${rel}:empty`}>
          <div className="axv-ws-row axv-ws-row-loading" style={{ paddingLeft: depth * 14 + 26 }}>
            <span className="axv-ws-item-sub">{tt("（没有可预览的 xml）")}</span>
          </div>
        </li>,
      ];
    }
    const rows: ReactNode[] = [];
    // M180：res/ 下同类限定符目录折叠成一行（drawable-mdpi/night/xxhdpi → drawable (3)）
    const groupK = (t: string) => `${rel}@@${t}`;
    type Disp = { kind: "node"; e: BrowseEntry } | { kind: "group"; type: string; members: BrowseEntry[] };
    let disp: Disp[] = items.map((e) => ({ kind: "node" as const, e }));
    if (/(^|\/)res$/.test(rel)) {
      const g = groupResDirs(items.filter((it) => it.kind === "dir").map((it) => it.name));
      const multi = new Map<string, Set<string>>();
      for (const [t, list] of g) if (list.length > 1) multi.set(t, new Set(list));
      if (multi.size) {
        const out: Disp[] = [];
        const placed = new Set<string>();
        for (const it of items) {
          if (it.kind === "dir") {
            let hit = "";
            for (const [t, set] of multi) if (set.has(it.name)) hit = t;
            if (hit) {
              if (placed.has(hit)) continue;
              placed.add(hit);
              const members = items.filter((x) => x.kind === "dir" && multi.get(hit)!.has(x.name));
              if (resGroupOpen.has(groupK(hit))) {
                for (const m of members) out.push({ kind: "node", e: m });
              } else {
                out.push({ kind: "group", type: hit, members });
              }
              continue;
            }
          }
          out.push({ kind: "node", e: it });
        }
        disp = out;
      }
    }
    for (const d of disp) {
      // M180：折叠组行（点开才看到具体限定符目录）
      if (d.kind === "group") {
        const key = groupK(d.type);
        rows.push(
          <li key={key} className="axv-ws-row" style={{ paddingLeft: depth * 14 }}>
            <button
              className="axv-ws-caret"
              title={tt("展开")}
              aria-label={tt("展开")}
              onClick={(e) => {
                e.stopPropagation();
                setResGroupOpen((prev) => new Set(prev).add(key));
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>chevron_right</span>
            </button>
            <button
              className="axv-ws-item"
              type="button"
              title={d.members.map((m) => m.name).join("、")}
              onClick={(e) => {
                e.stopPropagation();
                setResGroupOpen((prev) => new Set(prev).add(key));
              }}
            >
              <span className="msr axv-ws-item-icon" aria-hidden="true">folder</span>
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">
                  {d.type}/ <span className="axv-ws-item-sub">({d.members.length})</span>
                </span>
                <span className="axv-ws-item-sub">{d.members.map((m) => m.name).join("、")}</span>
              </span>
            </button>
          </li>,
        );
        continue;
      }
      const n = d.e;
      const isDir = n.kind === "dir";
      const isOpen = isDir && open.has(n.rel);
      const editing = !isDir && currentFileName && n.name.toLowerCase() === currentFileName.toLowerCase();
      // M144：当前文件高亮 —— 有精确 rel 就用 rel，否则退回文件名
      const isCurrent = !isDir && (currentRel ? n.rel === currentRel : !!editing);
      const nodeRef: TreeNodeRef = { rel: n.rel, name: n.name, isDir };
      rows.push(
        <li
          key={n.rel + ":" + n.kind}
          className={
            "axv-ws-row" +
            (moving ? " axv-moving" : "") +
            (moving && moving.node.rel === n.rel ? " axv-move-src" : "") +
            (dropHover === n.rel || (dropHover === "" && false) ? " axv-drop" : "") +
            (isCurrent ? " axv-ws-row-on" : "")
          }
          data-treerel={n.rel}
          data-treename={n.name}
          data-treedir={isDir ? "1" : "0"}
          style={{ paddingLeft: depth * 14 }}
          // M144：用户要求「触发放到 li 层」——整行（含缩进空白）都可点、可长按
          onClick={(e) => {
            if (moving) return;
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if ((e.target as HTMLElement).closest(".axv-move-handle")) return;
            if (isDir) toggle(n.rel);
            else void openEntry(n);
          }}
          onPointerDown={(e) => beginPress(e, nodeRef)}
          onPointerMove={movePress}
          onContextMenu={(e) => {
            if (!canMenu || moving) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, target: nodeRef });
          }}
        >
          {isDir ? (
            <button
              className="axv-ws-caret"
              title={isOpen ? tt("折叠") : tt("展开")}
              aria-label={isOpen ? tt("折叠") : tt("展开")}
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
          <button className="axv-ws-item" title={n.rel} type="button">
            <TreeRowIcon
              entry={n}
              isDir={isDir}
              isOpen={isOpen}
              iconDir={iconDir}
              source={source}
              extras={extras}
            />
            <span className="axv-ws-item-main">
              <span className="axv-ws-item-name">{n.name}</span>
              <span className="axv-ws-item-sub">
                {isDir
                  ? resDirDescription(n.rel) ?? tt("文件夹")
                  : editing
                    ? tt("正在编辑")
                    : tt(describeFile(n.rel, n.name))}
              </span>
            </span>
          </button>
          {moving ? (
            <span
              className="axv-move-handle"
              title={tt("按住拖动到目标目录")}
              aria-label={tt("拖动移动")}
              onPointerDown={(e) => beginDrag(e, nodeRef)}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="msr" aria-hidden="true">drag_indicator</span>
            </span>
          ) : null}
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
              ? tt("拖「{name}」到目标目录", { name: moving.node.name })
              : tt("将移动到：{target}/", { target: moving.target || tt("项目根") })}
          </span>
          <button className="axv-btn" onClick={() => void confirmMove()} disabled={moving.target == null}>
            {tt("确定")}
          </button>
          <button className="axv-btn axv-ghost" onClick={cancelMove}>
            {tt("取消")}
          </button>
        </div>
      ) : null}
      {/* M180：项目内搜索（文件名 / 目录名，命中目录会列出下面全部文件） */}
      <div className="axv-proj-filter">
        <span className="msr" aria-hidden="true">search</span>
        <input
          className="axv-proj-filter-input"
          value={resQuery}
          placeholder={tt("搜索项目文件…")}
          onChange={(e) => {
            setResQuery(e.target.value);
            if (e.target.value.trim()) void scanTree();
          }}
        />
        {resQuery ? (
          <button
            type="button"
            className="axv-proj-filter-clear"
            title={tt("清除搜索")}
            aria-label={tt("清除搜索")}
            onClick={() => setResQuery("")}
          >
            <span className="msr" aria-hidden="true">close</span>
          </button>
        ) : null}
      </div>
      {resQuery.trim() ? (
        scanBusy ? (
          <div className="axv-ws-hint">{tt("正在扫描项目…")}</div>
        ) : (
          <ul className="axv-ws-list axv-proj-tree">
            {searchHits.length === 0 ? (
              <li>
                <div className="axv-ws-row axv-ws-row-loading" style={{ paddingLeft: 26 }}>
                  <span className="axv-ws-item-sub">{tt("没找到匹配「{q}」的文件", { q: resQuery })}</span>
                </div>
              </li>
            ) : null}
            {searchHits.map((h) => {
              const entry: BrowseEntry = { rel: h.rel, name: h.name, kind: "file" };
              return (
                <li key={"s:" + h.rel} data-treerel={h.rel}>
                  <div className="axv-ws-row" style={{ paddingLeft: 0 }}>
                    <span className="axv-ws-caret" aria-hidden="true" />
                    <button className="axv-ws-item" title={h.rel} type="button" onClick={() => void openEntry(entry)}>
                      <span className="msr axv-ws-item-icon" aria-hidden="true">description</span>
                      <span className="axv-ws-item-main">
                        <span className="axv-ws-item-name">{h.name}</span>
                        <span className="axv-ws-item-sub">{h.rel}</span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
            {searchHits.length >= 200 ? (
              <li>
                <div className="axv-ws-hint">{tt("结果太多，只显示前 200 个，请输入更长的关键词")}</div>
              </li>
            ) : null}
          </ul>
        )
      ) : (
        <ul className="axv-ws-list axv-proj-tree" ref={listRef}>{renderRows("", 0)}</ul>
      )}
      {busy ? <div className="axv-ws-hint">{tt("正在处理…")}</div> : null}

      {/* M46c：菜单与弹窗都挂到 .axv-main 下（用户要求），不再留在树内部 */}
      <Overlay>
        <>
      {menu ? (
        <TreeFileMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          canWrite={!!fileOps && fileOps.backend === "native"}
          hasClipboard={!!clipboard}
          canFill={!!props.onFillIconAttr && !menu.target.isDir && /(^|\/)res\/(drawable|mipmap)/.test(menu.target.rel)}
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
          title={tt("删除")}
          text={tt("确定删除「{name}」？{isDir}此操作不可撤销。", { name: dlg.target.name, isDir: dlg.target.isDir ? tt("目录及其内容将被递归删除，") : "" })}
          detail={
            deleteImpact === null
              ? undefined
              : deleteImpact.count > 0
                ? tt("⚠ 被 {n} 处引用：{samples}", { n: deleteImpact.count, samples: deleteImpact.samples.map((s) => s.rel + (s.line > 1 ? ":" + s.line : "")).join("、") + (deleteImpact.count > deleteImpact.samples.length ? " …" : "") })
                : tt("（项目里没找到引用）")
          }
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
          submitLabel={dlg.action === "move" ? tt("移动") : tt("粘贴")}
          takenNames={dlg.taken}
          onSubmit={(n) => void doConflict(n)}
          onClose={() => setDlg(null)}
        />
      ) : null}
        </>
      </Overlay>
    </>
  );
}

/** M30：树只关心「换了项目 / 手动刷新 / 当前文件名」，父组件其它 state 变化不该让它重建。
 *  onOpenEntry / onOpenDrawable / onPreviewImage 是内联箭头函数（每帧都是新引用），所以比较时跳过它们。 */
const LazyTree = memo(LazyTreeInner, (a, b) =>
  a.source === b.source &&
  a.rev === b.rev &&
  a.currentFileName === b.currentFileName &&
  a.currentRel === b.currentRel &&
  a.storeKey === b.storeKey &&
  a.extras === b.extras &&
  a.fileOps === b.fileOps &&
  a.onRenameResource === b.onRenameResource &&
  a.onFillIconAttr === b.onFillIconAttr,
);

/* ---------------- 面板 ---------------- */

/** M62：项目列表 tab（自带筛选状态；单独成组件是为了让 ProjectPanel 保持无 hooks，
 *  已有单测是直接调 ProjectPanel(props) 拿元素树的） */
function ProjectsTab({ p }: { p: ProjectPanelProps }) {
  const { tr, wsState, wsBusy, wsMsg, projects, metaOf } = p;
  const [projQuery, setProjQuery] = useState("");
  const [cardMsgLocal, setCardMsgLocal] = useState("");
  /** M176：改名弹窗（项目名 / app 名称） */
  const [ren, setRen] = useState<{ item: WsProject; dir: string; app: string } | null>(null);
  const [renBusy, setRenBusy] = useState(false);
  const [renMsg, setRenMsg] = useState("");
  /** M181：项目卡片长按菜单 + 属性弹窗 */
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; item: WsProject } | null>(null);
  const [propsFor, setPropsFor] = useState<{
    item: WsProject;
    source: ProjectSource;
    saveRoot: ProjectSaveRoot | null;
    iconUrl: string | null;
  } | null>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number; moved: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    moved: false,
  });
  const cancelCardPress = () => {
    const st = pressRef.current;
    if (st.timer !== null) {
      window.clearTimeout(st.timer);
      st.timer = null;
    }
  };
  useEffect(() => cancelCardPress, []);

  /** 把 ops ctx 转成 ProjectSaveRoot（native 绝对路径 / web handle） */
  const opsRootOf = (ops: FileOpsCtx | null): ProjectSaveRoot | null => {
    if (!ops) return null;
    if (ops.backend === "native") {
      const base = String(ops.root).replace(/\/+$/, "");
      if (!base.startsWith("/")) return null;
      return { kind: "native", base };
    }
    return { kind: "handle", handle: ops.root };
  };

  /** 长按 / 右键弹卡片菜单（手机上 450ms，鼠标右键立刻） */
  const beginCardPress = (e: React.PointerEvent, item: WsProject) => {
    if (e.button === 2) {
      e.preventDefault();
      setCardMenu({ x: e.clientX, y: e.clientY, item });
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const st = pressRef.current;
    cancelCardPress();
    st.x = e.clientX;
    st.y = e.clientY;
    st.moved = false;
    st.timer = window.setTimeout(() => {
      st.timer = null;
      if (st.moved) return;
      setCardMenu({ x: st.x, y: st.y, item });
    }, 450);
    window.addEventListener("pointerup", cancelCardPress, { once: true });
  };

  const openProps = async (item: WsProject) => {
    setCardMenu(null);
    const src = await projectSourceFromWorkspaceItem(item);
    if (!src) {
      setCardMsgLocal(tt("这个项目读不了（可能不是目录，或权限已失效）"));
      return;
    }
    const ops = fileOpsCtxOf({ dirPath: item.dirPath, handle: item.handle });
    setPropsFor({
      item,
      source: src,
      saveRoot: opsRootOf(ops),
      iconUrl: metaOf(item)?.iconUrl ?? null,
    });
  };

  /** 删除整个项目目录（仅 native：需要绝对路径的父目录作为操作根） */
  const deleteProject = async (item: WsProject) => {
    setCardMenu(null);
    if (!item.dirPath) {
      setCardMsgLocal(tt("网页版不支持删项目，请用 APK。"));
      return;
    }
    const clean = item.dirPath.replace(/[/\\]+$/, "");
    const parent = clean.replace(/[/\\][^/\\]+$/, "");
    const base = clean.split(/[/\\]/).pop() || item.name;
    if (!window.confirm(tt("确定删除项目「{name}」？整个目录连同源码一起删，不能撤销。", { name: item.name }))) return;
    const r = await deleteEntry({ backend: "native", root: parent }, base, true);
    if (!r.ok) {
      setCardMsgLocal(tt("删除失败：{msg}", { msg: r.reason || tt("未知错误") }));
      return;
    }
    setCardMsgLocal(tt("已删除 {name}", { name: item.name }));
    void p.onRefresh();
  };

  /** M181：卡片菜单位置 clamp（视口内留 6px 边） */
  const clampPos = (v: number, est: number, estH: number) =>
    Math.max(6, Math.min(v, window.innerWidth - est - 6));

  const canDelete = (it: WsProject) => !!it.dirPath;

  const shownProjects = useMemo(() => {
    const k = projQuery.trim().toLowerCase();
    if (!k) return projects;
    return projects.filter((it) => {
      const nm = metaOf(it)?.name || "";
      return (
        nm.toLowerCase().includes(k) ||
        it.name.toLowerCase().includes(k) ||
        it.rel.toLowerCase().includes(k)
      );
    });
  }, [projects, projQuery, metaOf]);

  return (
          <div className="axv-ws-panel">
            <div className="axv-ws-path">
              <button
                className="axv-rail-mini-btn"
                onClick={() => void p.onOpenDir()}
                title={tt("打开其他项目文件夹（含 layout/*.xml），作为当前项目")}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>folder_open</span>
                {tr("proj.open", "打开项目")}
              </button>
              <button
                className="axv-rail-mini-btn"
                onClick={() => p.onNewProject(p.projectName || "MyApp")}
                title={tt("新建一个带 activity_main.xml 的空项目")}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>add_box</span>
                {tr("proj.new", "新建项目")}
              </button>
    
              <button
                className="axv-ws-mini"
                title={tt("刷新列表")}
                onClick={() => void p.onRefresh()}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>
    
            {wsState?.mode === "native" && wsState.allFiles === false ? (
              <div className="axv-ws-warn">
                {tt("默认目录在存储根下，需要「所有文件访问」权限才能读取。")}
                <button className="axv-ws-link" onClick={p.onRequestAllFiles}>
                  {tt("去开启")}
                </button>
              </div>
            ) : null}
            {wsState?.mode === "unsupported" ? (
              <div className="axv-ws-warn">
                {tt("请用 Chrome / Edge 打开网页版，或安装 APK（APK 默认目录：/AndroidUIIDE/Project）。")}
              </div>
            ) : null}
            {wsState?.mode === "web" && !wsState.custom ? (
              <div className="axv-ws-hint">
                {tt("点「打开项目」授权一个项目文件夹，授权会被记住，下次打开不用再选。")}
              </div>
            ) : null}
            {wsState?.permission === "prompt" ? (
              <div className="axv-ws-warn">
                {tt("目录权限需要重新确认（浏览器安全策略）。")}
                <button className="axv-ws-link" onClick={() => void p.onRefresh()}>
                  {tt("重新授权")}
                </button>
              </div>
            ) : null}
    
            {wsBusy && projects.length === 0 && wsState?.mode !== "unsupported" ? (
              <div className="axv-ws-hint">{tt("正在读取…")}</div>
            ) : null}
    
            {/* M62：项目列表筛选（项目一多翻起来费劲） */}
            {projects.length > 1 ? (
              <div className="axv-proj-filter">
                <span className="msr" aria-hidden="true">search</span>
                <input
                  className="axv-proj-filter-input"
                  value={projQuery}
                  placeholder={tt("筛选项目（共 {n} 个）", { n: projects.length })}
                  onChange={(e) => setProjQuery(e.target.value)}
                />
                {projQuery ? (
                  <button
                    type="button"
                    className="axv-proj-filter-clear"
                    title={tt("清除筛选")}
                    aria-label={tt("清除筛选")}
                    onClick={() => setProjQuery("")}
                  >
                    <span className="msr" aria-hidden="true">close</span>
                  </button>
                ) : null}
              </div>
            ) : null}
    
            {projects.length > 0 ? (
              <ul className="axv-ws-list">
                {shownProjects.map((it) => {
                  const meta = metaOf(it);
                  const canDelete = !!it.dirPath;
                  return (
                    <li key={it.rel + ":" + it.kind}>
                      <div
                        className="axv-proj-card"
                        onPointerDown={(e) => beginCardPress(e, it)}
                        onPointerMove={(e) => {
                          const st = pressRef.current;
                          if (st.timer !== null && (Math.abs(e.clientX - st.x) > 10 || Math.abs(e.clientY - st.y) > 10)) {
                            st.moved = true;
                            cancelCardPress();
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCardMenu({ x: e.clientX, y: e.clientY, item: it });
                        }}
                      >
                        <button
                          className="axv-proj-card-btn"
                          title={it.rel}
                          onClick={() => p.onOpenProject(it)}
                        >
                          <span className="axv-proj-card-ico" aria-hidden="true">
                            <img src={meta?.iconUrl || DEFAULT_ICON_URL} alt="" />
                          </span>
                          <span className="axv-ws-item-main">
                            <span className="axv-ws-item-name" title={meta?.name || it.name}>
                              {meta?.name || it.name}
                            </span>
                            <span className="axv-ws-item-sub">
                              {it.kind === "dir"
                                ? meta
                                  ? `${libLabel(meta.lib)}${meta.name && meta.name !== it.name ? ` · ${it.name}` : ""}`
                                  : tt("~{n} 个布局 · {name}", { n: it.layoutCount || 1, name: it.name })
                                : tt("单个布局 · {name}", { name: it.name })}
                            </span>
                          </span>
                          <span className="msr axv-proj-card-go" aria-hidden="true">chevron_right</span>
                        </button>
                        {p.onRenameProject && it.kind === "dir" ? (
                          <button
                            type="button"
                            className="axv-proj-card-edit"
                            title={tt("改项目名 / app 名称")}
                            aria-label={tt("改项目名 / app 名称")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenMsg("");
                              setRen({ item: it, dir: it.name, app: meta?.name || it.name });
                            }}
                          >
                            <span className="msr" aria-hidden="true">edit</span>
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !wsBusy && (wsState?.mode === "native" || wsState?.custom) ? (
              <div className="axv-ws-hint">
                {tt("目录里还没有项目。把项目文件夹（内含 layout/*.xml）放到这个目录下，点刷新即可。")}
              </div>
            ) : null}
    
            {projects.length > 0 && shownProjects.length === 0 ? (
              <div className="axv-ws-hint">{tt("没找到匹配「{q}」的项目", { q: projQuery })}</div>
            ) : null}
    
            {wsMsg ? <div className="axv-ws-hint">{wsMsg}</div> : null}
            {cardMsgLocal ? <div className="axv-ws-hint">{cardMsgLocal}</div> : null}

            {/* M181：卡片长按菜单（打开 / 属性 / 删除） */}
            {cardMenu ? (
              <Overlay>
                <div className="axv-tfm-mask" role="presentation" onClick={() => setCardMenu(null)}>
                  <div
                    className="axv-tfm axv-cpm"
                    style={{ left: clampPos(cardMenu.x, 170, 6 * 40), top: clampPos(cardMenu.y, 170, 6 * 40) }}
                    role="menu"
                  >
                    <button className="axv-tfm-item" onClick={() => { setCardMenu(null); void p.onOpenProject(cardMenu.item); }}>
                      <span className="axv-tfm-label">{tr("proj.open", "打开")}</span>
                    </button>
                    <button className="axv-tfm-item" onClick={() => void openProps(cardMenu.item)}>
                      <span className="axv-tfm-label">{tt("属性")}</span>
                    </button>
                    <button className="axv-tfm-item danger" disabled={!canDelete(cardMenu.item)} onClick={() => void deleteProject(cardMenu.item)}>
                      <span className="axv-tfm-label">{tt("删除")}</span>
                      {!canDelete(cardMenu.item) ? <span className="axv-tfm-hint">{tt("网页版不支持，请用 APK")}</span> : null}
                    </button>
                  </div>
                </div>
              </Overlay>
            ) : null}

            {/* M181：项目属性弹窗 */}
            {propsFor ? (
              <ProjectPropsDialog
                item={propsFor.item}
                source={propsFor.source}
                saveRoot={propsFor.saveRoot}
                iconUrl={propsFor.iconUrl}
                onRenameProject={p.onRenameProject}
                onSaved={() => {
                  setPropsFor(null);
                  void p.onRefresh();
                }}
                onClose={() => setPropsFor(null)}
              />
            ) : null}

            {/* M176：改名弹窗 */}
            {ren ? (
              <div
                className="axv-saveas-mask"
                role="dialog"
                aria-modal="true"
                onClick={(e) => {
                  if (e.target === e.currentTarget && !renBusy) setRen(null);
                }}
              >
                <div className="axv-saveas-card" role="dialog" aria-modal="true">
                  <div className="axv-saveas-title">{tt("改项目名 / 应用名")}</div>
                  <div className="axv-saveas-hint">
                    {tt("项目名 = 文件夹名（工作目录/{name}/app/src/...），改它会重命名目录并同步 gradle / 主题名。应用名 = 桌面图标下显示的名字。", { name: ren.dir })}
                  </div>
                  <label className="axv-saveas-field">
                    <span>{tt("项目名（目录）")}</span>
                    <input
                      className="axv-saveas-input"
                      value={ren.dir}
                      spellCheck={false}
                      onChange={(e) => setRen({ ...ren, dir: e.target.value })}
                    />
                  </label>
                  <label className="axv-saveas-field">
                    <span>{tt("应用名（app_name）")}</span>
                    <input
                      className="axv-saveas-input"
                      value={ren.app}
                      spellCheck={false}
                      onChange={(e) => setRen({ ...ren, app: e.target.value })}
                    />
                  </label>
                  {renMsg ? <div className="axv-saveas-hint">{renMsg}</div> : null}
                  <div className="axv-saveas-btns">
                    <button className="axv-set-btn" disabled={renBusy} onClick={() => setRen(null)}>
                      {tt("取消")}
                    </button>
                    <button
                      className="axv-set-btn axv-saveas-ok"
                      disabled={renBusy}
                      onClick={() => {
                        if (!p.onRenameProject || !ren) return;
                        setRenBusy(true);
                        setRenMsg("");
                        void p
                          .onRenameProject(ren.item, ren.dir, ren.app)
                          .then((r) => {
                            if (r.ok) setRen(null);
                            setRenMsg(r.msg);
                            if (r.ok) void p.onRefresh();
                          })
                          .finally(() => setRenBusy(false));
                      }}
                    >
                      {renBusy ? tt("保存中…") : tt("保存")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
  );
}

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

      {tab === "projects" ? <ProjectsTab p={p} /> : (
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
                <img className="axv-proj-now-icon" src={DEFAULT_ICON_URL} alt="" aria-hidden="true" />
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
                currentRel={p.currentRel ?? null}
                storeKey={p.projectName || undefined}
                onOpenEntry={p.onOpenEntry}
                extras={p.resExtras}
                onOpenDrawable={p.onOpenDrawable}
                onPreviewImage={p.onPreviewImage}
                fileOps={p.fileOps ?? null}
                onFilesChanged={p.onFilesChanged}
                onRenameResource={p.onRenameResource}
                onFillIconAttr={p.onFillIconAttr}
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
                        <span className="axv-ws-item-sub">{tt("{n} 个布局", { n: p.appProject.files.length })}</span>
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
                          <span className="axv-ws-item-sub">{tt("布局文件")}</span>
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
            {tt("点上方结构树里的文件直接打开（drawable 形状 → 绘制编辑器，vector/图片 → 预览）。")}
          </div>
        </>
      )}
    </div>
  );
}
