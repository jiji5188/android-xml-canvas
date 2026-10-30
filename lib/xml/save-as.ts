// lib/xml/save-as.ts — M21「另存为」：选文件夹 + 把依赖资源一并写进去
//
// 网页宿主（Chrome/Edge）：File System Access 的 showDirectoryPicker 里可以「新建文件夹」，
// 选完目录句柄后按 res 相对路径（layout/ drawable/ values/）递归建目录写文件。
// 原生壳（APK）：走 window.AxvNative.saveBundle，由 Java 弹 ACTION_OPEN_DOCUMENT_TREE 再写。

import { nativeBridge, bytesToBase64, mimeOfName } from "./native-save";

export interface SaveFileSpec {
  /** res 相对路径，如 layout/activity_main.xml、drawable/ic_x.xml */
  path: string;
  text: string;
  mime?: string;
}

export interface SaveBundleResult {
  ok: boolean;
  canceled?: boolean;
  label?: string;
  count?: number;
  reason?: string;
}

interface DirHandleLike {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}

interface FileHandleLike {
  kind: "file";
  name: string;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

export function saveAsSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (nativeBridge()?.saveBundle) return true;
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

export function hasNativeBundle(): boolean {
  return !!nativeBridge()?.saveBundle;
}

/** 原生壳：存整包（Java 弹文件夹选择器，支持新建文件夹） */
export function saveBundleNative(files: SaveFileSpec[], name: string): Promise<SaveBundleResult> {
  const b = nativeBridge();
  const saveBundle = b?.saveBundle;
  if (!b || typeof saveBundle !== "function") {
    return Promise.resolve({ ok: false, reason: "原生壳不支持另存" });
  }
  return new Promise<SaveBundleResult>((resolve) => {
    let done = false;
    const finish = (r: SaveBundleResult) => {
      if (done) return;
      done = true;
      window.AxvNativeSaved = undefined;
      window.clearTimeout(timer);
      resolve(r);
    };
    // 用户在系统选择器里可能磨蹭很久，给 5 分钟
    const timer = window.setTimeout(
      () => finish({ ok: false, reason: "等待选择文件夹超时" }),
      5 * 60 * 1000,
    );
    window.AxvNativeSaved = (json: string) => {
      try {
        const r = JSON.parse(json) as SaveBundleResult;
        finish(r);
      } catch {
        finish({ ok: false, reason: "原生返回结果无法解析" });
      }
    };
    const payload = JSON.stringify(
      files.map((f) => ({
        path: f.path,
        mime: f.mime || mimeOfName(f.path),
        base64: bytesToBase64(new TextEncoder().encode(f.text)),
      })),
    );
    try {
      saveBundle.call(b, name, payload);
    } catch (e) {
      finish({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** 网页：选目录（对话框里可以新建文件夹）→ 按相对路径递归写入 */
export async function saveBundleWeb(files: SaveFileSpec[]): Promise<SaveBundleResult> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<DirHandleLike> })
    .showDirectoryPicker;
  if (typeof picker !== "function") {
    return { ok: false, reason: "当前浏览器不支持选择文件夹（请用 Chrome / Edge 或 APK）" };
  }
  let dir: DirHandleLike;
  try {
    dir = await picker.call(window, { mode: "readwrite", id: "axv-save" });
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === "AbortError") return { ok: false, canceled: true, reason: "已取消" };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  try {
    for (const f of files) {
      const parts = f.path.split("/").filter(Boolean);
      let d = dir;
      for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create: true });
      const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(f.text);
      await w.close();
    }
    return { ok: true, label: dir.name, count: files.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 统一入口：原生壳优先，其次网页 FSA */
export async function saveBundleAnywhere(files: SaveFileSpec[], name: string): Promise<SaveBundleResult> {
  if (hasNativeBundle()) return saveBundleNative(files, name);
  return saveBundleWeb(files);
}

/** M21：浏览器里「带句柄」地打开一个 xml（打开后可以原路保存） */
export async function pickXmlFile(): Promise<{ name: string; text: string; handle: unknown } | null> {
  const picker = (
    window as unknown as {
      showOpenFilePicker?: (o?: unknown) => Promise<Array<{ name: string; getFile(): Promise<File> }>>;
    }
  ).showOpenFilePicker;
  if (typeof picker !== "function") return null;
  try {
    const [h] = await picker.call(window, {
      types: [{ description: "Android 布局 XML", accept: { "text/xml": [".xml"] } }],
      multiple: false,
      id: "axv-open",
    });
    if (!h) return null;
    const f = await h.getFile();
    return { name: h.name, text: await f.text(), handle: h };
  } catch {
    return null;
  }
}
