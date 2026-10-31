// lib/xml/new-project-io.ts — M31i：新建项目时「写到哪里」的两种实现
//
//   native（APK）：默认工作目录（绝对路径）+ bridge.writeText（内部会 mkdirs 建父目录）
//   web：工作目录句柄（File System Access API），逐级 getDirectoryHandle({create:true})
//
// 都不依赖 UI，方便单测/替换；拿不到写入目标时返回 null，调用方退回「只建应用内项目」。

import { nativeBridge, writeTextNative } from "./native-save";
import { restoreWorkspace, workspacePermission, requestWorkspacePermission } from "./workspace-fs";
import type { NewProjectIO } from "./new-project";
interface DirLike {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileLikeWritable>;
}

interface FileLikeWritable {
  kind: "file";
  name: string;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

/** native：把绝对根目录 + 项目名包装成 IO */
export function nativeNewProjectIO(root: string, projectName: string): NewProjectIO | null {
  const b = nativeBridge();
  if (!b?.writeText) return null;
  const base = `${root.replace(/[/\\]+$/, "")}/${projectName}`;
  return {
    async writeText(rel, text) {
      return writeTextNative(`${base}/${rel}`, text);
    },
    async writeBinary(rel, base64) {
      try {
        // writeText 在 Java 侧会先把 base64 解码成字节再写，
        // 所以这里传 base64 字符串即可（旧实现其实是对的，只是写个注释说清楚）
        const r = b.writeText?.(`${base}/${rel}`, base64);
        return typeof r === "string" && r.startsWith("ok");
      } catch {
        return false;
      }
    },
  };
}

/** native：项目写完后再 listDir 一层，确认真的落盘了（没权限/失败时返回 0） */
export function nativeVerifyProject(root: string, projectName: string): number {
  const b = nativeBridge();
  if (!b?.listDir) return 0;
  try {
    const abs = `${root.replace(/[/\\]+$/, "")}/${projectName}`;
    const raw = b.listDir(abs);
    const parsed = (raw ? (JSON.parse(raw) as { ok?: boolean; items?: unknown[] }) : null) ?? null;
    if (parsed?.ok && Array.isArray(parsed.items)) return parsed.items.length;
  } catch {
    /* 桥抛错 → 验证不了，返回 0 让调用方明确提示写失败（而不是 null 被当成"没验证"） */
  }
  return 0;
}

/** web：在工作目录句柄下建「项目名/...」；没有句柄或没权限返回 null */
export async function webNewProjectIO(projectName: string): Promise<NewProjectIO | null> {
  let root: DirLike | null = null;
  try {
    root = (await restoreWorkspace()) as unknown as DirLike | null;
  } catch {
    return null;
  }
  if (!root) return null;

  try {
    const perm = await workspacePermission(root as unknown as Parameters<typeof workspacePermission>[0]);
    if (perm !== "granted") {
      const ok = await requestWorkspacePermission(root as unknown as Parameters<typeof requestWorkspacePermission>[0]);
      if (!ok) return null;
    }
  } catch {
    /* 老浏览器没有权限查询，直接试写 */
  }

  const dirFor = async (rel: string): Promise<DirLike | null> => {
    let cur: DirLike = root as DirLike;
    for (const part of rel.split("/").filter(Boolean)) {
      try {
        cur = await cur.getDirectoryHandle(part, { create: true });
      } catch {
        return null;
      }
    }
    return cur;
  };

  const writeFile = async (rel: string, data: string | Blob): Promise<boolean> => {
    const idx = rel.lastIndexOf("/");
    const dirRel = idx > 0 ? rel.slice(0, idx) : "";
    const fname = idx > 0 ? rel.slice(idx + 1) : rel;
    const dir = await dirFor(dirRel);
    if (!dir) return false;
    try {
      const fh = await dir.getFileHandle(fname, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      return true;
    } catch {
      return false;
    }
  };

  return {
    writeText(rel, text) {
      return writeFile(rel, text);
    },
    async writeBinary(rel, base64, mime) {
      try {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return await writeFile(rel, new Blob([bytes], { type: mime || "image/png" }));
      } catch {
        return false;
      }
    },
  };
}
