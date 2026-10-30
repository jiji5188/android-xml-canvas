// lib/xml/project.ts — M24「项目」：打开一个项目文件夹 / 新建项目
//
// 与「工作目录」（workspace.ts）的区别：
//   - 工作目录 = 一个装着多个项目的父目录，列表里列项目；
//   - 项目     = 某个具体工程目录（含 layout/ drawable/ values/ 或直接一堆 xml），
//                「当前项目」面板展示它的结构树。
//
// 打开方式：
//   native（APK）：弹 SAF 选目录（chooseWorkspace 同款选择器）→ listProjects 拿结构树
//   web（Chrome/Edge）：showDirectoryPicker 选目录 → 句柄存 IndexedDB，刷新后可复用

import { nativeBridge } from "./native-save";
import { wsInfo, wsListProjects, wsPickCustom, type WsProject } from "./workspace";
import {
  fsAccessSupported,
  listProjects as webListProjects,
  restoreProjectDir,
  saveProjectDir,
  type WorkspaceEntry,
} from "./workspace-fs";

export interface OpenedProject {
  /** 项目名（目录名） */
  name: string;
  /** 结构树（扁平，rel 带层级，前端再画树） */
  entries: WsProject[];
}

/** web：选一个「项目目录」（不覆盖工作目录的句柄） */
async function pickWebProjectDir(): Promise<{ name: string; entries: WorkspaceEntry[] } | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<unknown> })
    .showDirectoryPicker;
  if (typeof picker !== "function") return null;
  let dir: unknown;
  try {
    dir = await picker.call(window, { mode: "read", id: "axv-project" });
  } catch {
    return null; // 用户取消
  }
  try {
    await saveProjectDir(dir);
  } catch {
    /* 句柄存不进去也不影响本次使用 */
  }
  const entries = await webListProjects(dir as never);
  const name = (dir as { name?: string })?.name || "项目";
  return { name, entries };
}

function toWsProject(e: WorkspaceEntry): WsProject {
  return {
    name: e.name,
    kind: e.kind,
    rel: e.rel,
    layoutCount: e.layoutCount ?? (e.kind === "file" ? 1 : 0),
    handle: e.kind === "dir" ? e.dirHandle : e.fileHandle,
  };
}

function dirNameOf(entries: WorkspaceEntry[]): string {
  // 从第一条 rel 里拿不到目录名，交给调用方补；这里只做兜底
  const first = entries[0]?.rel ?? "";
  const top = first.split("/")[0];
  return top || "项目";
}

/**
 * 让用户指定一个项目目录并读取它的结构。
 * 返回 null = 用户取消 / 当前环境不支持。
 */
export async function openProjectFolder(): Promise<OpenedProject | null> {
  const b = nativeBridge();
  if (b) {
    const ok = await wsPickCustom();
    if (!ok) return null;
    const info = await wsInfo();
    const entries = await wsListProjects();
    return { name: info.label || "项目", entries };
  }

  if (!fsAccessSupported()) return null;

  const entries = await pickWebProjectDir();
  if (!entries) return null;
  return { name: entries.name, entries: entries.entries.map(toWsProject) };
}

/** 读回上次打开的项目目录结构（不弹窗，可能为空） */
export async function restoreProjectFolder(): Promise<OpenedProject | null> {
  const b = nativeBridge();
  if (b) {
    // APK 里项目目录就是当前工作目录，直接列
    const info = await wsInfo();
    if (info.mode !== "native" || !info.custom) return null;
    const entries = await wsListProjects();
    return entries.length ? { name: info.label || "项目", entries } : null;
  }
  if (!fsAccessSupported()) return null;
  try {
    const dir = await restoreProjectDir();
    if (!dir) return null;
    const entries = await webListProjects(dir as never);
    if (!entries.length) return null;
    const name = (dir as { name?: string })?.name || "项目";
    return { name, entries: entries.map(toWsProject) };
  } catch {
    return null;
  }
}

export interface ProjectNode {
  kind: "dir" | "file";
  name: string;
  rel: string;
  layoutCount: number;
  item: WsProject;
  children: ProjectNode[];
}

/** 把扁平的 rel 列表还原成树（父目录不存在的层级自动补） */
export function buildProjectTree(entries: WsProject[]): ProjectNode[] {
  const roots: ProjectNode[] = [];
  const map = new Map<string, ProjectNode>();

  const ensureDir = (rel: string): ProjectNode => {
    const hit = map.get(rel);
    if (hit) return hit;
    const name = rel.split("/").filter(Boolean).pop() ?? rel;
    const node: ProjectNode = {
      kind: "dir",
      name,
      rel,
      layoutCount: 0,
      item: { name, kind: "dir", rel, layoutCount: 0 },
      children: [],
    };
    map.set(rel, node);
    const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    if (parentRel) ensureDir(parentRel).children.push(node);
    else roots.push(node);
    return node;
  };

  for (const e of entries) {
    const rel = e.rel;
    if (e.kind === "dir") {
      const node = ensureDir(rel);
      node.item = e;
      node.layoutCount = e.layoutCount;
      continue;
    }
    const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const node: ProjectNode = {
      kind: "file",
      name: e.name,
      rel,
      layoutCount: 1,
      item: e,
      children: [],
    };
    map.set(rel, node);
    if (parentRel) ensureDir(parentRel).children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: ProjectNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    for (const n of nodes) if (n.children.length) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** 项目里第一个「像主布局」的文件条目 */
export function mainLayoutEntry(entries: WsProject[]): WsProject | null {
  const files = entries.filter((e) => e.kind === "file");
  if (!files.length) {
    // 全是目录：挑第一个带布局的目录（native 的目录条目带 docUri = 里面的主布局）
    const dir = entries.find((e) => e.kind === "dir" && e.layoutCount > 0 && e.target);
    return dir ?? null;
  }
  const rank = (n: string) => {
    const base = n.toLowerCase();
    if (base === "activity_main.xml") return 0;
    if (base === "main.xml") return 1;
    if (base.includes("main")) return 2;
    return 3;
  };
  return [...files].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))[0];
}
