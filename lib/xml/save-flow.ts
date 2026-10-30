// lib/xml/save-flow.ts — M25f：把散在 XmlEditor 里的「四条保存路径」收成一处
//
// 原来 XmlEditor 里同时有：写回原路径（saveBack）/ 另存整包（saveAsTo）/ 单文件下载（doDownload）/
// 导出 res.zip（doDownloadResZip），每处都各自 exportLayoutXml + buildResBundle，改一处要改四遍。
//
// 这里只做「纯逻辑 + 可注入 IO」：
//   - buildSaveFiles    当前 xml → 要落盘的文件清单（layout + 依赖 drawable/values）
//   - nextSaveAction    有来源就写回，没来源就另存
//   - saveBack          写回原路径（native 顺带把依赖资源写到同级 res）
//   - saveAs            整包另存到用户选的文件夹
//   - exportResZip      打包成 zip 字节
//   - downloadLayout    单文件导出（APK 走 bridge 存到工作目录，网页走浏览器下载）
//
// React 侧只负责弹提示 / 开关对话框，不再碰文件 IO。

import { buildResBundle, missingDrawables } from "./bundle";
import { exportLayoutXml, type ExportMode } from "./export";
import type { ResourceExtras } from "./resdir";
import { saveBundleAnywhere, type SaveBundleResult, type SaveFileSpec } from "./save-as";
import { saveTextNative, writeTextNative } from "./native-save";
import { writeHandleText } from "./workspace-fs";
import { downloadBytes, makeZip } from "./zip";

export interface SaveInput {
  xml: string;
  mode: ExportMode;
  /** 目标文件名（含 .xml） */
  name: string;
  generatedDrawables: Record<string, string>;
  extras: ResourceExtras | null;
}

/** 当前文件「从哪来」——决定保存时写哪 */
export type SaveTarget =
  | { kind: "native"; target: string; name: string }
  | { kind: "handle"; handle: unknown; name: string };

export interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  label?: string;
  count?: number;
  reason?: string;
  /** 写回原路径时：依赖资源写成功的个数 / 总数 */
  depsWritten?: number;
  depsTotal?: number;
}

export interface SaveIO {
  writeNative(path: string, text: string): boolean;
  writeHandle(handle: unknown, text: string): Promise<boolean>;
  saveBundle(files: SaveFileSpec[], name: string): Promise<SaveBundleResult>;
}

const defaultIO: SaveIO = {
  writeNative: (path, text) => writeTextNative(path, text),
  writeHandle: (handle, text) => writeHandleText(handle, text),
  saveBundle: (files, name) => saveBundleAnywhere(files, name),
};

/** 当前 xml → 要落盘的文件（layout/<name> + 依赖资源） */
export function buildSaveFiles(input: SaveInput): SaveFileSpec[] {
  const layoutXml = exportLayoutXml(input.xml, { mode: input.mode });
  const entries = buildResBundle({
    layoutXml,
    layoutName: input.name,
    generatedDrawables: input.generatedDrawables,
    extras: input.extras,
  });
  return entries.map((e) => ({ path: e.path, text: e.text }));
}

/** 有来源 → 写回原路径；没来源 → 另存 */
export function nextSaveAction(target: SaveTarget | null): "back" | "as" {
  return target ? "back" : "as";
}

/**
 * 写回原路径。失败返回 ok=false（调用方通常回落成「另存」）。
 * native 目标若是绝对路径且同级有 res，依赖资源一起写进去（网页持句柄时只写主文件）。
 */
export async function saveBack(
  input: SaveInput,
  target: SaveTarget,
  io: SaveIO = defaultIO,
): Promise<SaveResult> {
  const files = buildSaveFiles(input);
  // 主文件 = layout/xxx（buildResBundle 一定把它放第一个，但别依赖顺序）
  const mainPath = `layout/${input.name}`;
  const main = files.find((f) => f.path === mainPath) ?? files[0];
  const deps = files.filter((f) => f !== main);

  let ok = false;
  if (target.kind === "native") {
    ok = io.writeNative(target.target, main.text);
  } else {
    try {
      ok = await io.writeHandle(target.handle, main.text);
    } catch {
      ok = false;
    }
  }
  if (!ok) return { ok: false, depsWritten: 0, depsTotal: deps.length };

  let depsWritten = 0;
  if (target.kind === "native" && target.target.startsWith("/") && deps.length > 0) {
    // .../res/layout/activity_main.xml → res 根是上上级；其它情况就把同目录当 res 根
    const dir = target.target.slice(0, target.target.lastIndexOf("/"));
    const resRoot = dir.endsWith("/layout") ? dir.slice(0, dir.lastIndexOf("/")) : dir;
    for (const d of deps) if (io.writeNative(`${resRoot}/${d.path}`, d.text)) depsWritten++;
  }
  return { ok: true, depsWritten, depsTotal: deps.length };
}

/** 整包另存到用户选的文件夹（APK 弹系统目录选择器，网页用 File System Access） */
export async function saveAs(input: SaveInput, io: SaveIO = defaultIO): Promise<SaveResult> {
  const files = buildSaveFiles(input);
  const r = await io.saveBundle(files, input.name);
  return { ...r, count: r.count ?? files.length };
}

/** 导出 res.zip 的字节；missing = 布局里引用但没覆盖到的 @drawable */
export function exportResZip(input: SaveInput): {
  bytes: Uint8Array;
  count: number;
  missing: string[];
} {
  const layoutXml = exportLayoutXml(input.xml, { mode: input.mode });
  const entries = buildResBundle({
    layoutXml,
    layoutName: input.name,
    generatedDrawables: input.generatedDrawables,
    extras: input.extras,
  });
  return {
    bytes: makeZip(entries),
    count: entries.length,
    missing: missingDrawables(layoutXml, entries),
  };
}

/** 单文件导出：APK 存到工作目录，网页触发浏览器下载 */
export function downloadLayout(input: SaveInput): { native: boolean; name: string } {
  const body = exportLayoutXml(input.xml, { mode: input.mode });
  if (saveTextNative(input.name, body, "text/xml")) return { native: true, name: input.name };
  const blob = new Blob([body], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = input.name;
  a.click();
  URL.revokeObjectURL(a.href);
  return { native: false, name: input.name };
}

/** 导出 res.zip 并触发下载（APK / 网页都走 downloadBytes） */
export function downloadResZip(input: SaveInput): { count: number; missing: string[] } {
  const { bytes, count, missing } = exportResZip(input);
  downloadBytes(bytes, "res.zip");
  return { count, missing };
}
