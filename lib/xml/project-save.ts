// lib/xml/project-save.ts — M36：保存一律落进「当前打开的项目」的 res 目录
//
// 用户诉求：默认目录是全局配置（设置里可改），但真正存东西时要优先写到
//   <当前项目根>/app/src/main/res/<layout|drawable|values|menu|mipmap-xxx|xml|...>/
// 而不是散在工作目录根上。
//
// 这里只做「把 SaveFileSpec[] 写进某项目 res 根」这件事，纯路径计算可单测；
// native 走 bridge.writeText（内部 mkdirs），web 走目录句柄逐级 create。

import { writeTextNative } from "./native-save";
import type { SaveFileSpec } from "./save-as";

/** res 在 Android 工程里的固定前缀 */
export const RES_PREFIX = "app/src/main/res";

export type ProjectSaveRoot =
  | { kind: "native"; base: string }
  | { kind: "handle"; handle: unknown };

export interface ProjectSaveResult {
  ok: boolean;
  written: number;
  total: number;
  failed: string[];
  /** 写成功但落到的绝对目录（native 才有，用于提示） */
  base?: string;
}

/** 从「打开的项目」推出可写根；拿不到（没项目 / 没句柄 / 没路径）返回 null */
export function projectSaveRoot(p: {
  dirPath?: string;
  rootPath?: string;
  handle?: unknown;
} | null | undefined): ProjectSaveRoot | null {
  if (!p) return null;
  const base = p.rootPath || p.dirPath;
  if (base && base.startsWith("/")) return { kind: "native", base: base.replace(/\/+$/, "") };
  if (p.handle) return { kind: "handle", handle: p.handle };
  return null;
}

/** 拼出 native 绝对路径：<base>/app/src/main/res/<rel> */
export function resAbs(base: string, rel: string): string {
  const b = base.replace(/[/\\]+$/, "");
  return `${b}/${RES_PREFIX}/${resRel(rel)}`;
}

/** res 相对路径（去掉可能出现的 app/src/main/res 前缀，防止重复拼接） */
export function resRel(rel: string): string {
  const r = rel.replace(/^\/+/, "");
  return r.startsWith(`${RES_PREFIX}/`) ? r.slice(RES_PREFIX.length + 1) : r;
}

async function writeUnderHandle(root: unknown, rel: string, text: string): Promise<boolean> {
  const segs = rel.split("/").filter(Boolean);
  const file = segs.pop();
  if (!file) return false;
  let dir = root as {
    getDirectoryHandle?(n: string, o?: { create?: boolean }): Promise<unknown>;
    getFileHandle?(n: string, o?: { create?: boolean }): Promise<unknown>;
  };
  for (const s of segs) {
    if (typeof dir.getDirectoryHandle !== "function") return false;
    dir = (await dir.getDirectoryHandle(s, { create: true })) as typeof dir;
  }
  if (typeof dir.getFileHandle !== "function") return false;
  const fh = (await dir.getFileHandle(file, { create: true })) as {
    createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
  };
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return true;
}

/** 把文件清单写进项目 res 根（native / 句柄两路） */
export async function saveResFiles(
  root: ProjectSaveRoot,
  files: SaveFileSpec[],
): Promise<ProjectSaveResult> {
  const failed: string[] = [];
  let written = 0;
  for (const f of files) {
    const rel = resRel(f.path);
    let ok = false;
    if (root.kind === "native") {
      try {
        ok = writeTextNative(resAbs(root.base, rel), f.text);
      } catch {
        ok = false;
      }
    } else {
      try {
        ok = await writeUnderHandle(root.handle, `${RES_PREFIX}/${rel}`, f.text);
      } catch {
        ok = false;
      }
    }
    if (ok) written++;
    else failed.push(rel);
  }
  return {
    ok: written > 0,
    written,
    total: files.length,
    failed,
    base: root.kind === "native" ? `${root.base}/${RES_PREFIX}` : undefined,
  };
}
