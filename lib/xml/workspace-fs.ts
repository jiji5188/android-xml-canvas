// lib/xml/workspace-fs.ts — 「工作目录」在浏览器里的实现
//
// 网页不能随便读写本地路径，唯一正路是 File System Access API（Chrome / Edge）：
// 用户授权一个目录 → 拿到目录句柄 → 存进 IndexedDB → 下次打开直接复用（权限仍在就免二次点击）。
// 不支持的浏览器（Safari / Firefox / 旧 Chromium）调用时抛 WorkspaceUnsupportedError，
// UI 上提示「请用 APK 或 Chrome/Edge」。
//
// 项目约定（和用户确认过）：工作目录下的每个**子文件夹**算一个项目；
// 如果目录下没有子文件夹，则把每个 .xml 文件当成一个项目列出来。

export type WorkspaceEntryKind = "dir" | "file";

export interface WorkspaceEntry {
  kind: WorkspaceEntryKind;
  /** 显示名（文件夹名或文件名） */
  name: string;
  /** 相对工作目录的路径，如 "LoginDemo/layout/activity_main.xml" */
  rel: string;
  /** 目录项的句柄（用于继续下钻） */
  dirHandle?: unknown;
  /** 文件项的句柄（用于读取内容） */
  fileHandle?: unknown;
  /** 目录里 layout/*.xml 的数量（只在 dir 上给） */
  layoutCount?: number;
}

export class WorkspaceUnsupportedError extends Error {
  constructor() {
    super("当前浏览器不支持读取本地目录，请用 Chrome / Edge，或装 APK 版");
    this.name = "WorkspaceUnsupportedError";
  }
}

export class WorkspacePermissionError extends Error {
  constructor() {
    super("没有该目录的访问权限（可能被用户撤销），请重新选择目录");
    this.name = "WorkspacePermissionError";
  }
}

interface DirHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<FileHandle | DirHandle>;
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string): Promise<FileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
}

interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/* ---------------- IndexedDB：长期记住目录句柄 ---------------- */

const DB_NAME = "axv.fs";
const STORE = "handles";
const KEY = "workspace";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const out = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* ---------------- 选目录 / 恢复目录 ---------------- */

/** 弹系统目录选择器（读权限），成功后记住句柄 */
export async function pickWorkspace(): Promise<DirHandle> {
  if (!fsAccessSupported()) throw new WorkspaceUnsupportedError();
  const picker = (window as unknown as { showDirectoryPicker: (o?: unknown) => Promise<DirHandle> }).showDirectoryPicker;
  const handle = await picker({ mode: "read", id: "axv-workspace" });
  await idbSet(KEY, handle);
  return handle;
}

/** 取回上次授权的目录（不弹窗）；没有则 null */
export async function restoreWorkspace(): Promise<DirHandle | null> {
  if (!fsAccessSupported()) return null;
  try {
    return await idbGet<DirHandle>(KEY);
  } catch {
    return null;
  }
}

export async function forgetWorkspace(): Promise<void> {
  try {
    await idbDel(KEY);
  } catch {
    /* ignore */
  }
}

/** 校验权限；granted 直接可用，prompt 需要用户手势再点一次 */
export async function workspacePermission(dir: DirHandle): Promise<PermissionState> {
  try {
    if (dir.queryPermission) return await dir.queryPermission({ mode: "read" });
    return "granted";
  } catch {
    return "denied";
  }
}

export async function requestWorkspacePermission(dir: DirHandle): Promise<boolean> {
  try {
    if (!dir.requestPermission) return true;
    return (await dir.requestPermission({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

/* ---------------- 列项目 ---------------- */

const LAYOUT_DIR = "layout";

/** 读目录时跳过的噪声目录（安卓工程里 build/.gradle 体积大且没布局） */
const SKIP_DIRS = new Set([".git", ".gradle", ".idea", "build", "node_modules", ".svn", "__pycache__"]);
const MAX_DEPTH = 6;

/** 递归数一个目录（含子目录）里的 .xml */
async function countXmlDeep(dir: DirHandle, depth = 0): Promise<number> {
  if (depth > MAX_DEPTH) return 0;
  let n = 0;
  try {
    for await (const e of dir.values()) {
      if (e.kind === "directory") {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        n += await countXmlDeep(e, depth + 1);
      } else if (/\.xml$/i.test(e.name)) {
        n++;
      }
    }
  } catch {
    /* ignore */
  }
  return n;
}

/**
 * M20n：列工作目录 → **多级**列表（保留相对路径，前端再画成树）。
 * 安卓工程一般是 app/src/main/res/layout/xxx.xml 这种多层结构，
 * 以前只列一层，用户根本看不到 app 里的布局。
 */
export async function listProjects(dir: DirHandle): Promise<WorkspaceEntry[]> {
  const out: WorkspaceEntry[] = [];
  const walk = async (d: DirHandle, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const dirs: WorkspaceEntry[] = [];
    const files: WorkspaceEntry[] = [];
    try {
      for await (const entry of d.values()) {
        const lower = entry.name.toLowerCase();
        if (SKIP_DIRS.has(lower)) continue;
        if (entry.kind === "directory") {
          const layoutCount = await countXmlDeep(entry);
          // 没有任何 xml 的目录不列（build/ 这种会被 SKIP 掉，这里兜剩下的）
          if (layoutCount === 0) continue;
          dirs.push({
            kind: "dir",
            name: entry.name,
            rel: prefix + entry.name,
            dirHandle: entry,
            layoutCount,
          });
        } else if (/\.xml$/i.test(entry.name)) {
          files.push({ kind: "file", name: entry.name, rel: prefix + entry.name, fileHandle: entry, layoutCount: 1 });
        }
      }
    } catch {
      throw new WorkspacePermissionError();
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    files.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    for (const d2 of dirs) {
      out.push(d2);
      await walk(d2.dirHandle as DirHandle, d2.rel + "/", depth + 1);
    }
    for (const f of files) out.push(f);
  };
  await walk(dir, "", 0);
  return out;
}

/** 读一个文件句柄的文本内容 */
export async function readHandleText(handle: unknown): Promise<string> {
  const h = handle as FileHandle;
  const file = await h.getFile();
  return await file.text();
}

/** 项目文件夹里挑一个「最像主布局」的 xml（优先 activity_main / main / content_main） */
export async function pickMainLayout(dir: DirHandle): Promise<{ name: string; text: string } | null> {
  const candidates: FileHandle[] = [];
  const collect = async (d: DirHandle) => {
    for await (const f of d.values()) if (f.kind === "file" && /\.xml$/i.test(f.name)) candidates.push(f);
  };
  try {
    await collect(await dir.getDirectoryHandle(LAYOUT_DIR));
  } catch {
    await collect(dir);
  }
  if (candidates.length === 0) return null;
  const rank = (n: string) => {
    const base = n.toLowerCase();
    if (base === "activity_main.xml") return 0;
    if (base === "main.xml") return 1;
    if (base.includes("main")) return 2;
    return 3;
  };
  candidates.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const chosen = candidates[0];
  return { name: chosen.name, text: await (await chosen.getFile()).text() };
}

/** 把项目文件夹里的 xml 全列出来（用于展示「含 N 个布局」） */
export async function listLayouts(dir: DirHandle): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  const collect = async (d: DirHandle) => {
    for await (const f of d.values()) {
      if (f.kind === "file" && /\.xml$/i.test(f.name)) out.push({ name: f.name, text: await (await f.getFile()).text() });
    }
  };
  try {
    await collect(await dir.getDirectoryHandle(LAYOUT_DIR));
  } catch {
    await collect(dir);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
