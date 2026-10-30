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

/** 列工作目录下的项目 */
export async function wsListProjects(): Promise<WsProject[]> {
  const b = nativeBridge();
  if (b?.listProjects) {
    try {
      const raw = JSON.parse(b.listProjects() || "{}") as {
        ok?: boolean;
        items?: { name: string; kind: "dir" | "file"; rel: string; layoutCount?: number; mainPath?: string; docUri?: string }[];
      };
      return (raw.items ?? []).map((it) => ({
        name: it.name,
        kind: it.kind,
        rel: it.rel,
        layoutCount: it.layoutCount ?? 0,
        target: it.docUri ?? it.mainPath,
      }));
    } catch {
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
export async function wsListTopProjects(): Promise<WsProject[]> {
  const b = nativeBridge();
  if (b) {
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
    const text = b.readText(p.target);
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
