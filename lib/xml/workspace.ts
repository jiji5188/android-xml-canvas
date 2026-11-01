// lib/xml/workspace.ts — 「工作目录」的统一入口（UI 只跟这个文件打交道）
//
// 三态：
//   native  → APK 壳：默认 /AndroidUIIDE/Project，走 Bridge（需要「所有文件访问」）
//   web     → Chrome/Edge 的 File System Access API，目录句柄存 IndexedDB
//   unsupported → 其它浏览器：UI 提示「请用 APK 或 Chrome/Edge」
//
// 规则（用户确认）：默认目录永远存在、不能为空；用户自选目录失效时回落默认。

import { nativeBridge, nativeAvailable, chooseWorkspace } from "./native-save";
import {
  listProjectsQueued,
  hasListProjectsAsync,
  hasListTopAsync,
  hasListTopQuick,
  listTopProjectsQueued,
  listTopProjectsQuickQueued,
  hasAsyncIo,
  readTextQueued,
} from "./native-async";
import { perfMark, perfTimer } from "./perf-log";
import {
  fsAccessSupported,
  listProjects as webListProjects,
  listTopLevel,
  pickWorkspace as webPickWorkspace,
  readHandleText,
  pickMainLayout,
  restoreWorkspace,
  forgetWorkspace,
  workspacePermission,
  requestWorkspacePermission,
  type WorkspaceEntry,
} from "./workspace-fs";

export type WsMode = "native" | "web" | "unsupported";

export interface WsProject {
  name: string;
  kind: "dir" | "file";
  rel: string;
  layoutCount: number;
  /** 可直接读的目标：native 是绝对路径 / content URI，web 是目录或文件句柄 */
  target?: string;
  /** 项目目录的绝对路径（native 才有，用来读 app_name / 图标） */
  dirPath?: string;
  handle?: unknown;
}

export interface WsInfo {
  mode: WsMode;
  /** 当前生效目录的显示名 */
  label: string;
  /** 内置默认目录（native 才有绝对路径；web 为空） */
  defaultPath: string;
  /** 是否是用户自选目录 */
  custom: boolean;
  /** native：是否已拿到「所有文件访问」 */
  allFiles: boolean;
  /** web：目录句柄是否还可读（prompt = 需要再点一次授权） */
  permission?: PermissionState;
}

export const DEFAULT_NATIVE_DIR = "/AndroidUIIDE/Project";

/** 取工作目录状态（不弹任何系统窗口） */
export async function wsInfo(): Promise<WsInfo> {
  const b = nativeBridge();
  if (b) {
    let allFiles = false;
    let custom = false;
    let label = "AndroidUIIDE/Project";
    let defaultPath = "";
    try {
      allFiles = b.hasAllFilesAccess ? !!b.hasAllFilesAccess() : false;
      if (b.getWorkspaceInfo) {
        const raw = JSON.parse(b.getWorkspaceInfo() || "{}") as {
          defaultPath?: string;
          custom?: string | null;
          effective?: string;
          allFiles?: boolean;
        };
        defaultPath = raw.defaultPath || "";
        custom = !!raw.custom;
        label = raw.effective || label;
        allFiles = raw.allFiles ?? allFiles;
      }
    } catch {
      /* ignore */
    }
    return { mode: "native", label, defaultPath, custom, allFiles };
  }
  if (!fsAccessSupported()) {
    return { mode: "unsupported", label: "", defaultPath: "", custom: false, allFiles: false };
  }
  const dir = await restoreWorkspace();
  if (!dir) return { mode: "web", label: "", defaultPath: "", custom: false, allFiles: false };
  const permission = await workspacePermission(dir);
  return { mode: "web", label: dir.name || "已选择目录", defaultPath: "", custom: true, allFiles: false, permission };
}

/** M56：native 深扫结果的短命缓存 —— 打开项目时不再每次重新全树扫
 *  键是工作目录签名，缓存 8 秒（写操作后调用方会主动 invalidate） */
const nativeListCache = new Map<string, { at: number; items: WsProject[] }>();
const NATIVE_LIST_TTL = 8000;

/** M56：文件操作/新建项目后要强制重扫 */
export function invalidateNativeProjectCache(): void {
  nativeListCache.clear();
  topProjCache.clear();
  sigCache = null;
}

/** M59：工作目录签名（做缓存 key 用）。原来每个列目录都同步 JNI 取一次，
 *  现在本地缓存 3 秒；真正的刷新靠 invalidateNativeProjectCache()。 */
let sigCache: { at: number; sig: string } | null = null;
function wsSig(b: { getWorkspaceInfo?: () => string }): string {
  if (sigCache && Date.now() - sigCache.at < 3000) return sigCache.sig;
  let sig = "";
  try {
    sig = b.getWorkspaceInfo ? b.getWorkspaceInfo() : "";
  } catch {
    sig = "";
  }
  sigCache = { at: Date.now(), sig };
  return sig;
}

/** 列工作目录下的项目 */
export async function wsListProjects(): Promise<WsProject[]> {
  const b = nativeBridge();
  if (b?.listProjects) {
    let raw: string | null = null;
    const sig = wsSig(b);
    const hit = nativeListCache.get(sig);
    if (hit && Date.now() - hit.at < NATIVE_LIST_TTL) {
      perfMark("ws.listProjects", "cache-hit items=" + hit.items.length);
      return hit.items;
    }
    const t = perfTimer("ws.listProjects", "native");
    try {
      // M56：优先异步（后台线程深扫），老 APK 回退同步
      raw = hasListProjectsAsync() ? await listProjectsQueued() : null;
      if (raw === null) raw = b.listProjects() || "{}";
      const parsed = JSON.parse(raw || "{}") as {
        ok?: boolean;
        items?: { name: string; kind: "dir" | "file"; rel: string; layoutCount?: number; mainPath?: string; docUri?: string; path?: string }[];
      };
      const items = (parsed.items ?? []).map((it) => ({
        name: it.name,
        kind: it.kind,
        rel: it.rel,
        layoutCount: it.layoutCount ?? 0,
        target: it.docUri ?? it.mainPath ?? it.path,
        dirPath: it.kind === "dir" ? it.path : undefined,
      }));
      nativeListCache.set(sig, { at: Date.now(), items });
      t.end("items=" + items.length);
      return items;
    } catch {
      t.end("ERR");
      return [];
    }
  }
  const dir = await restoreWorkspace();
  if (!dir) return [];
  if ((await workspacePermission(dir)) !== "granted") {
    const ok = await requestWorkspacePermission(dir);
    if (!ok) return [];
  }
  const entries = await webListProjects(dir);
  return entries.map((e: WorkspaceEntry) => ({
    name: e.name,
    kind: e.kind,
    rel: e.rel,
    layoutCount: e.layoutCount ?? (e.kind === "file" ? 1 : 0),
    handle: e.kind === "dir" ? e.dirHandle : e.fileHandle,
  }));
}

/**
 * M25d：列工作目录下的**项目卡片**（只读一层，不递归）。
 * native：bridge 给的仍是深列表，这里把深层项按第一段归并成顶层项目；
 * web：直接 listTopLevel，毫秒级。
 */
/** M58：顶层项目列表的短命缓存（12s）——项目列表 12s 轮询 + 切 tab 都会命中，
 *  而 Java 端的 probe 又按 mtime 缓存，两层缓存后轮询几乎零成本 */
const topProjCache = new Map<string, { at: number; items: WsProject[] }>();
const TOP_PROJ_TTL = 12_000;

/* ---------------- M60：渐进式项目列表 ----------------
 * 背景：冷启动时 11 个项目的完整探测要 1.6s（Java 端一趟扫 res 树），用户盯着空白列表等。
 * 做法：先用 quick 通道（只数一层 xml，几十毫秒）把卡片画出来，完整探测在后台跑，
 *       回来后写入缓存 + 通知订阅者，卡片再补上主布局/精确计数/图标名称。 */

const inflightFull = new Map<string, Promise<WsProject[] | null>>();
const topSubs = new Set<(items: WsProject[]) => void>();

/** 订阅「后台补齐的完整项目列表」；返回退订函数 */
export function wsSubscribeTopProjects(cb: (items: WsProject[]) => void): () => void {
  topSubs.add(cb);
  return () => {
    topSubs.delete(cb);
  };
}

function notifyTopUpdated(items: WsProject[]) {
  for (const cb of [...topSubs]) {
    try {
      cb(items);
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  }
}

/** 解析 bridge 返回的项目列表 JSON（完整/快速两种通道格式一致） */
function parseTopItems(raw: string | null): WsProject[] | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw || "{}") as {
      ok?: boolean;
      items?: { name: string; kind: "dir" | "file"; rel: string; layoutCount?: number; mainPath?: string; docUri?: string; path?: string }[];
    };
    if (o.ok === false || !Array.isArray(o.items)) return null;
    return o.items.map((it) => ({
      name: it.name,
      kind: it.kind,
      rel: it.rel,
      layoutCount: it.layoutCount ?? 0,
      target: it.docUri ?? it.mainPath ?? it.path,
      dirPath: it.kind === "dir" ? it.path : undefined,
    }));
  } catch {
    return null;
  }
}

/** 后台跑完整探测，结果写缓存 */
async function loadTopFull(key: string): Promise<WsProject[] | null> {
  const b = nativeBridge();
  if (!b?.listTopProjects) return null;
  const t = perfTimer("ws.listTopFull", "native-async");
  try {
    let o = hasListTopAsync() ? await listTopProjectsQueued() : null;
    if (o === null) o = b.listTopProjects() || "{}";
    const items = parseTopItems(o);
    if (items) {
      topProjCache.set(key, { at: Date.now(), items });
      t.end("items=" + items.length);
      return items;
    }
    t.end("ERR-empty");
  } catch {
    t.end("ERR");
  }
  return null;
}

export async function wsListTopProjects(): Promise<WsProject[]> {
  const b = nativeBridge();
  if (b) {
    // M30：新版 bridge 直接给顶层列表（不递归），老 APK 没有这个方法就回退合并
    if (b.listTopProjects) {
      try {
        const key = wsSig(b);
        const cached = topProjCache.get(key);
        if (cached && Date.now() - cached.at < TOP_PROJ_TTL) {
          perfMark("ws.listTop", "cache-hit items=" + cached.items.length);
          return cached.items;
        }
        // M60：完整列表还没缓存 → 先要快速列表（毫秒级）出卡片，再后台跑完整探测
        if (!cached && hasListTopQuick() && !inflightFull.has(key)) {
          const qt = perfTimer("ws.listTopQuick", "native-async");
          const qraw = await listTopProjectsQuickQueued();
          const q = parseTopItems(qraw);
          qt.end("items=" + (q ? q.length : 0));
          if (q && q.length) {
            const p: Promise<WsProject[] | null> = loadTopFull(key)
              .then((full) => {
                if (full && full.length) notifyTopUpdated(full);
                return full;
              })
              .catch(() => null)
              .finally(() => inflightFull.delete(key));
            inflightFull.set(key, p);
            return q;
          }
        }
        // M59：优先异步（老 APK 没 listTopProjectsAsync → 回退同步）
        const t = perfTimer("ws.listTop", hasListTopAsync() ? "native-async" : "native-sync");
        let o = hasListTopAsync() ? await listTopProjectsQueued() : null;
        if (o === null) o = b.listTopProjects() || "{}";
        const items = parseTopItems(o);
        if (items) {
          topProjCache.set(key, { at: Date.now(), items });
          t.end("items=" + items.length);
          return items;
        }
        t.end("ERR-empty");
      } catch {
        /* 回退到旧路径 */
      }
    }
    const all = await wsListProjects();
    const map = new Map<string, WsProject>();
    for (const it of all) {
      const top = it.rel.split("/")[0];
      if (!top) continue;
      if (it.rel === top) {
        map.set(top, { ...it, rel: top });
        continue;
      }
      const cur = map.get(top) ?? { name: top, kind: "dir", rel: top, layoutCount: 0 };
      if (it.kind === "file") cur.layoutCount += 1;
      map.set(top, cur);
    }
    return [...map.values()].sort((x, y) =>
      x.kind === y.kind ? x.name.localeCompare(y.name, "zh-Hans-CN") : x.kind === "dir" ? -1 : 1,
    );
  }

  const dir = await restoreWorkspace();
  if (!dir) return [];
  if ((await workspacePermission(dir)) !== "granted") {
    const ok = await requestWorkspacePermission(dir);
    if (!ok) return [];
  }
  const entries = await listTopLevel(dir);
  return entries.map((e: WorkspaceEntry) => ({
    name: e.name,
    kind: e.kind,
    rel: e.rel,
    layoutCount: e.layoutCount ?? (e.kind === "file" ? 1 : 0),
    handle: e.kind === "dir" ? e.dirHandle : e.fileHandle,
  }));
}

/** 打开一个项目，返回主布局 xml 文本 */
export async function wsOpenProject(p: WsProject): Promise<{ name: string; text: string } | null> {
  const b = nativeBridge();
  if (b?.readText) {
    if (!p.target) return null;
    // M59：打开项目改异步读（同步 JNI 读大文件会在 JS 线程堵几百毫秒）
    const text = hasAsyncIo() ? await readTextQueued(p.target) : b.readText(p.target);
    if (!text) return null;
    return { name: p.kind === "dir" ? `${p.name}/layout` : p.name, text };
  }
  if (p.handle) {
    if (p.kind === "file") {
      const text = await readHandleText(p.handle);
      return { name: p.name, text };
    }
    const main = await pickMainLayout(p.handle as never);
    return main ? { name: `${p.name}/${main.name}`, text: main.text } : null;
  }
  return null;
}

/** 选一个自定义目录（native 走 SAF，web 走目录选择器）；取消返回 false */
export async function wsPickCustom(): Promise<boolean> {
  const b = nativeBridge();
  if (b) {
    if (!fsAccessSupported()) {
      // 原生壳里 WebView 不一定支持 FSA，直接走原生选择器
      return chooseWorkspace();
    }
    return chooseWorkspace();
  }
  try {
    await webPickWorkspace();
    return true;
  } catch {
    return false;
  }
}

/** 恢复默认目录（web：忘掉句柄；native：清掉自选文件夹） */
export async function wsUseDefault(): Promise<void> {
  const b = nativeBridge();
  if (b) {
    try {
      (b as unknown as { resetWorkspace?: () => void }).resetWorkspace?.();
    } catch {
      /* ignore */
    }
    return;
  }
  await forgetWorkspace();
}

/** 申请「所有文件访问」（只有 native 有意义） */
export function wsRequestAllFiles(): boolean {
  const b = nativeBridge();
  if (!b?.requestAllFilesAccess) return false;
  try {
    b.requestAllFilesAccess();
    return true;
  } catch {
    return false;
  }
}

export function wsNativeAvailable(): boolean {
  return nativeAvailable();
}
