// lib/xml/file-ops.ts — M46：项目树文件管理 IO 抽象层
//
// 统一「新建 / 重命名 / 移动 / 复制 / 删除 / 存在检查」双路（Web File System Access + Native bridge）。
// Web 侧 FSA 不支持 rename/delete/move/copy（浏览器安全限制），这些操作返回 {ok:false, reason:"web"}，
// 调用方据此提示「网页版暂不支持，请用 APK」。Native 走新增的 5 个 bridge 方法（M46 Java 端已加）。

import { nativeBridge } from "./native-save";
import { hasAsyncIo } from "./native-async";

export type FileOpsBackend = "web" | "native";

export interface FileOpsResult {
  ok: boolean;
  /** 失败原因：web=网页版不支持；同名=目标已存在；越界=超出工作目录；其它=原生错误信息 */
  reason?: string;
  /** 操作成功后的新路径（rel） */
  newRel?: string;
}

/** Web DirLike（File System Access 目录句柄的形状） */
type WebDirLike = {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<WebDirLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(d?: string): Promise<void>; close(): Promise<void> }>;
  }>;
  values(): AsyncIterableIterator<{ kind: string; name: string }>;
};

export interface FileOpsCtx {
  /** web：项目根目录句柄；native：项目根绝对路径 */
  root: unknown;
  backend: FileOpsBackend;
}

function webResolveDir(root: WebDirLike, rel: string): Promise<WebDirLike | null> {
  let cur: WebDirLike = root;
  const parts = rel.split("/").filter(Boolean);
  let p: Promise<WebDirLike | null> = Promise.resolve(cur);
  for (const part of parts) {
    p = p.then(async (d) => {
      if (!d) return null;
      try {
        return await d.getDirectoryHandle(part);
      } catch {
        return null;
      }
    });
  }
  return p;
}

/** web：逐级下钻，缺的目录自动建（create=true）——与 native 的 mkdirs 行为一致 */
function webResolveDirCreate(root: WebDirLike, rel: string): Promise<WebDirLike | null> {
  const parts = rel.split("/").filter(Boolean);
  let p: Promise<WebDirLike | null> = Promise.resolve(root);
  for (const part of parts) {
    p = p.then(async (d) => {
      if (!d) return null;
      try {
        return await d.getDirectoryHandle(part, { create: true });
      } catch {
        return null;
      }
    });
  }
  return p;
}

function parentRelOf(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

function nameOfRel(rel: string): string {
  return rel.split("/").filter(Boolean).pop() ?? "";
}

/** 判断目标层是否已有同名项（listChildren 一层比对）。纯函数，可单测。 */
export function hasNameAmong(items: { name?: string }[] | undefined, name: string): boolean {
  if (!items) return false;
  return items.some((it) => it.name === name);
}

/** 生成不冲突的新名字：a.xml → a(1).xml → a(2).xml … */
export function suggestUniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  while (taken.has(`${base}(${i})${ext}`)) i++;
  return `${base}(${i})${ext}`;
}

export interface CreateEntryOpts {
  /** 在哪个 rel 目录下建（""=项目根） */
  parentRel: string;
  name: string;
  isDir: boolean;
}

/** 新建文件/目录。Web：FSA create；Native：bridge.createEntry。 */
export async function createEntry(ctx: FileOpsCtx, opts: CreateEntryOpts): Promise<FileOpsResult> {
  const name = opts.name.trim();
  if (!name) return { ok: false, reason: "名称为空" };
  if (name.includes("/") || name.includes("\\")) return { ok: false, reason: "名称不能含 / 或 \\" };

  if (ctx.backend === "web") {
    const root = ctx.root as WebDirLike;
    const dir = opts.parentRel ? await webResolveDirCreate(root, opts.parentRel) : root;
    if (!dir) return { ok: false, reason: "目标目录不存在" };
    try {
      if (opts.isDir) {
        await dir.getDirectoryHandle(name, { create: true });
      } else {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write("");
        await w.close();
      }
      return { ok: true, newRel: opts.parentRel ? `${opts.parentRel}/${name}` : name };
    } catch {
      return { ok: false, reason: "创建失败（浏览器可能不支持写）" };
    }
  }

  // native
  const b = nativeBridge();
  if (!b || !("createEntry" in b)) return { ok: false, reason: "原生不支持" };
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const abs = opts.parentRel ? `${base}/${opts.parentRel}/${name}` : `${base}/${name}`;
  try {
    const raw = (b as unknown as { createEntry(p: string, isDir: boolean): string }).createEntry(abs, opts.isDir);
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true, newRel: opts.parentRel ? `${opts.parentRel}/${name}` : name };
    return { ok: false, reason: r.error || "创建失败" };
  } catch {
    return { ok: false, reason: "创建失败" };
  }
}

/** 重命名。Web 不支持（FSA 无 rename）→ reason:"web"。Native：bridge.renameEntry。 */
export async function renameEntry(ctx: FileOpsCtx, rel: string, newName: string): Promise<FileOpsResult> {
  const name = newName.trim();
  if (!name) return { ok: false, reason: "名称为空" };
  if (name.includes("/") || name.includes("\\")) return { ok: false, reason: "名称不能含 / 或 \\" };

  if (ctx.backend === "web") return { ok: false, reason: "web" };

  const b = nativeBridge();
  if (!b || !("renameEntry" in b)) return { ok: false, reason: "原生不支持" };
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const from = `${base}/${rel}`;
  const to = `${base}/${parentRelOf(rel) ? `${parentRelOf(rel)}/${name}` : name}`;
  try {
    const raw = (b as unknown as { renameEntry(f: string, t: string): string }).renameEntry(from, to);
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true, newRel: parentRelOf(rel) ? `${parentRelOf(rel)}/${name}` : name };
    return { ok: false, reason: r.error || "重命名失败" };
  } catch {
    return { ok: false, reason: "重命名失败" };
  }
}

/** 移动（跨目录）。Web 不支持 → reason:"web"。Native：bridge.renameEntry。 */
export async function moveEntry(
  ctx: FileOpsCtx,
  rel: string,
  targetParentRel: string,
): Promise<FileOpsResult> {
  const name = nameOfRel(rel);
  const newRel = targetParentRel ? `${targetParentRel}/${name}` : name;
  if (newRel === rel) return { ok: true, newRel }; // 原地，无操作
  if (ctx.backend === "web") return { ok: false, reason: "web" };
  const b = nativeBridge();
  if (!b || !("renameEntry" in b)) return { ok: false, reason: "原生不支持" };
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const from = `${base}/${rel}`;
  const to = `${base}/${newRel}`;
  try {
    const raw = (b as unknown as { renameEntry(f: string, t: string): string }).renameEntry(from, to);
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true, newRel };
    return { ok: false, reason: r.error || "移动失败" };
  } catch {
    return { ok: false, reason: "移动失败" };
  }
}

/** 复制（目录递归）。Web 不支持 → reason:"web"。Native：bridge.copyEntry。 */
export async function copyEntry(
  ctx: FileOpsCtx,
  rel: string,
  targetParentRel: string,
): Promise<FileOpsResult> {
  const name = nameOfRel(rel);
  const newRel = targetParentRel ? `${targetParentRel}/${name}` : name;
  if (newRel === rel) return { ok: false, reason: "目标与源相同" };
  if (ctx.backend === "web") return { ok: false, reason: "web" };
  const b = nativeBridge();
  if (!b || !("copyEntry" in b)) return { ok: false, reason: "原生不支持" };
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const from = `${base}/${rel}`;
  const to = `${base}/${newRel}`;
  const recursive = true;
  try {
    const raw = (b as unknown as { copyEntry(f: string, t: string, rec: boolean): string }).copyEntry(
      from,
      to,
      recursive,
    );
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true, newRel };
    return { ok: false, reason: r.error || "复制失败" };
  } catch {
    return { ok: false, reason: "复制失败" };
  }
}

/** 删除（目录递归）。Web 不支持 → reason:"web"。Native：bridge.deleteEntry。 */
export async function deleteEntry(ctx: FileOpsCtx, rel: string, isDir: boolean): Promise<FileOpsResult> {
  if (ctx.backend === "web") return { ok: false, reason: "web" };
  const b = nativeBridge();
  if (!b || !("deleteEntry" in b)) return { ok: false, reason: "原生不支持" };
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const abs = `${base}/${rel}`;
  try {
    const raw = (b as unknown as { deleteEntry(p: string, rec: boolean): string }).deleteEntry(abs, isDir);
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true };
    return { ok: false, reason: r.error || "删除失败" };
  } catch {
    return { ok: false, reason: "删除失败" };
  }
}

/** 检查某一层是否有同名（供粘贴/新建前判断冲突）。Web：listChildren；Native：bridge.listDir。 */
export async function checkNameExists(
  ctx: FileOpsCtx,
  parentRel: string,
  name: string,
): Promise<boolean> {
  if (ctx.backend === "web") {
    const root = ctx.root as WebDirLike;
    const dir = parentRel ? await webResolveDir(root, parentRel) : root;
    if (!dir) return false;
    try {
      for await (const e of dir.values()) if (e.name === name) return true;
    } catch {
      /* 读不了就当没有 */
    }
    return false;
  }
  const b = nativeBridge();
  if (!b) return false;
  const base = (ctx.root as string).replace(/[/\\]+$/, "");
  const abs = parentRel ? `${base}/${parentRel}` : base;
  let items: { name?: string }[] = [];
  try {
    if (hasAsyncIo()) {
      const { listDirQueued } = await import("./native-async");
      const raw = await listDirQueued(abs);
      if (raw) items = (JSON.parse(raw) as { items?: { name?: string }[] }).items || [];
    } else {
      const raw = b.listDir ? b.listDir(abs) : null;
      if (raw) items = (JSON.parse(raw) as { items?: { name?: string }[] }).items || [];
    }
  } catch {
    return false;
  }
  return hasNameAmong(items, name);
}

/** 取 ctx 的 root 绝对路径（native 才有，给 bridge 用） */
export function nativeRoot(ctx: FileOpsCtx): string {
  return (ctx.root as string) || "";
}
