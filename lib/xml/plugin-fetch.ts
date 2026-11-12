// lib/xml/plugin-fetch.ts — 插件按需下载 + 本地缓存 + 校验（JS 侧）
//
// 下载源：GitHub Release（jiji5188/axv-plugins，tag = <id>-<version>，附件 <id>-<version>.zip）
// 流程：
//   1) 取插件包 URL（可用 token，可匿名公开）
//   2) 下到 cacheDir（原生 getFileHandle 或 localStorage base64 —— 这里给纯逻辑，IO 由 native 做）
//   3) 逐文件 sha256 校验（用 manifest.files）→ 缺/坏精确报
//
// 本模块是纯逻辑（可单测）：URL 构造、清单校验、缓存键。真正读字节/写文件交给原生桥
// （window.AxvNative / File System Access），保证测试不用起浏览器。

import { parsePluginManifest, checkPlugin, type PluginManifest } from "./plugin";

export const PLUGINS_REPO = "jiji5188/axv-plugins";

/** 构造某插件某版本的 GitHub Release 附件 URL */
export function pluginUrl(id: string, version: string, token?: string): string {
  const base = `https://github.com/${PLUGINS_REPO}/releases/download/${id}-${version}/${id}-${version}.zip`;
  return token ? base + "?" : base;
}

/** 本地缓存键（按 id+version，防止旧缓存吃到新包） */
export function cacheKey(id: string, version: string): string {
  return "axv.plugin." + id + "." + version;
}

/**
 * 校验「下载后实际能读到的文件」。纯逻辑：调用方传 actual（{path->{size,sha256}}）。
 * 返回校验状态（ok + 逐文件问题）。等价于 checkPlugin，但入参是 manifest 文本（便于原生侧一次给齐）。
 */
export function verifyDownload(manifestText: string, id: string, actual: Record<string, { size: number; sha256: string }>) {
  const m = parsePluginManifest(id, manifestText);
  return checkPlugin(m, actual);
}

/** 把 manifest 文本 + 实际文件统计转成「能下载清单」（给下载 UI 显示大小） */
export function expectedDownloadBytes(manifestText: string, id: string): number {
  const m = parsePluginManifest(id, manifestText) as PluginManifest;
  return m.files.reduce((s, f) => s + f.size, 0);
}
