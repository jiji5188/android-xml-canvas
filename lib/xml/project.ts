// lib/xml/project.ts — M24/M25d「项目」：打开 / 恢复项目，项目结构工具函数
//
// 与「工作目录」（workspace.ts）的区别：
//   - 工作目录 = 一个装着多个项目的父目录，列表里平铺列项目（M25d：不再多级展开）；
//   - 项目     = 某个具体工程目录（含 layout/ drawable/ values/ 或直接一堆 xml）。
//
// M25d 起：打开的项目返回 ProjectSource（懒加载浏览源），不再一次性深扫整棵树，
// 结构树在点开目录时才逐层读，避免几百次目录句柄调用把面板卡住。

import { nativeBridge } from "./native-save";
import { wsInfo, wsListProjects, wsPickCustom, type WsProject } from "./workspace";
import { fsAccessSupported, restoreProjectDir, saveProjectDir } from "./workspace-fs";
import {
  nativeProjectSource,
  projectSourceFromDir,
  projectSourceFromWorkspaceItem,
  webProjectSource,
  type ProjectSource,
} from "./project-browse";

export interface OpenedProject {
  /** 项目名（先用目录名，UI 会再用 strings.xml 的 app_name 覆盖） */
  name: string;
  /** 分层浏览源（listChildren 每次只读一层） */
  source: ProjectSource;
  /** M31：项目目录绕对路径（仅 native，用来直读 strings.xml / ic_launcher） */
  dirPath?: string;
  /** M31h：结构树根目录的绝对路径（native 且不是 SAF 自选目录时才有，用来真读一层目录） */
  rootPath?: string;
  /** M36：项目根目录句柄（web 用，保存时写进 <项目>/app/src/main/res/） */
  handle?: unknown;
}

/** M31h：native 下能拿去 readdir 的根路径；SAF（自定义目录）只有 label，返回 undefined */
function nativeRootPath(info: { custom?: boolean; defaultPath?: string }): string | undefined {
  if (info.custom) return undefined;
  return info.defaultPath || undefined;
}

/** web：选一个「项目目录」（不覆盖工作目录的句柄） */
async function pickWebProjectDir(): Promise<{ name: string; dir: unknown } | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<unknown> })
    .showDirectoryPicker;
  if (typeof picker !== "function") return null;
  let dir: unknown;
  try {
    dir = await picker.call(window, { mode: "readwrite", id: "axv-project" });
  } catch {
    return null; // 用户取消
  }
  try {
    await saveProjectDir(dir);
  } catch {
    /* 句柄存不进去也不影响本次使用 */
  }
  const name = (dir as { name?: string })?.name || "项目";
  return { name, dir };
}

/** 从工作目录的一张项目卡片打开（项目列表项点击走这里） */
export async function openProjectFromItem(item: WsProject): Promise<OpenedProject | null> {
  const source = await projectSourceFromWorkspaceItem(item);
  if (!source) return null;
  return { name: item.name, source, dirPath: item.dirPath, rootPath: item.dirPath, handle: item.handle };
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
    const name = info.label || "项目";
    return { name, source: nativeProjectSource(name, entries, nativeRootPath(info)) };
  }

  if (!fsAccessSupported()) return null;

  const picked = await pickWebProjectDir();
  if (!picked) return null;
  return { name: picked.name, source: projectSourceFromDir(picked.dir, picked.name), handle: picked.dir };
}

/** 读回上次打开的项目目录（不弹窗，可能为空） */
export async function restoreProjectFolder(): Promise<OpenedProject | null> {
  const b = nativeBridge();
  if (b) {
    // APK 里项目目录就是当前工作目录，直接列
    const info = await wsInfo();
    if (info.mode !== "native" || !info.custom) return null;
    const entries = await wsListProjects();
    if (!entries.length) return null;
    const name = info.label || "项目";
    return { name, source: nativeProjectSource(name, entries, nativeRootPath(info)) };
  }
  if (!fsAccessSupported()) return null;
  try {
    const dir = await restoreProjectDir();
    if (!dir) return null;
    const name = (dir as { name?: string })?.name || "项目";
    return { name, source: webProjectSource(dir, name), handle: dir };
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

/** 项目里第一个「像主布局」的文件条目（native 扁平列表用） */
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
