// lib/plugin/updates.ts — M376：插件更新检查
//
// 两类插件：
//   1) 内置编辑器插件（drawable / icon）：随 APK 发布，版本号在 BUILTIN_PLUGIN_VERSIONS；
//      远程版本查 axv-plugins 仓库的 plugins.json
//   2) 第三方插件：manifest 里有 version；有 manifestUrl 的直接拉来比对
//
// 只做「查」，不负责装：内置插件只能换 APK，第三方可走 installPlugin 重装。

export const PLUGIN_REGISTRY_URL =
  "https://cdn.jsdelivr.net/gh/jiji5188/axv-plugins@main/plugins.json";

/** 内置编辑器插件的版本（随 APK 发布，改编辑器就 bump 这里 + plugins.json） */
export const BUILTIN_PLUGIN_VERSIONS: Record<string, string> = {
  "axv:editor:drawable": "1.0.0",
  "axv:editor:icon": "1.0.0",
};

export interface RemotePluginInfo {
  id: string;
  version: string;
  manifestUrl?: string;
}

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  /** 第三方插件可用于重装的 manifest 地址 */
  manifestUrl?: string;
  error?: string;
}

/** 版本号比较：按 . - 分段，数字段按数值比，非数字段按字典序。a>b 返回 1 */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a || "0").split(/[.\-+_]/).filter(Boolean);
  const pb = String(b || "0").split(/[.\-+_]/).filter(Boolean);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d > 0 ? 1 : -1;
    } else {
      const d = x.localeCompare(y);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
  }
  return 0;
}

/** 拉插件注册表（plugins.json），失败返回 null（不抛） */
export async function fetchPluginRegistry(): Promise<Record<string, RemotePluginInfo> | null> {
  try {
    const r = await fetch(PLUGIN_REGISTRY_URL, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { plugins?: RemotePluginInfo[] } | RemotePluginInfo[];
    const list = Array.isArray(data) ? data : data.plugins || [];
    const map: Record<string, RemotePluginInfo> = {};
    for (const it of list) {
      if (it && it.id) map[it.id] = { id: it.id, version: it.version || "0.0.0", manifestUrl: it.manifestUrl };
    }
    return map;
  } catch {
    return null;
  }
}

/** 拉某个 manifest 的 version 字段 */
async function fetchManifestVersion(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const m = (await r.json()) as { version?: string };
    return m?.version || null;
  } catch {
    return null;
  }
}

/**
 * 检查单个插件是否有更新。
 * - 给了 manifestUrl：直接拉该 manifest 的 version
 * - 否则查 plugins.json 注册表
 */
export async function checkPluginUpdate(
  id: string,
  currentVersion: string,
  manifestUrl?: string,
  registry?: Record<string, RemotePluginInfo> | null,
): Promise<UpdateCheckResult> {
  const current = currentVersion || "0.0.0";
  let latest: string | null = null;
  let err: string | undefined;

  if (manifestUrl) {
    latest = await fetchManifestVersion(manifestUrl);
    if (!latest) err = "fetch failed";
  } else {
    // 只在未传时才拉网络；显式传 null 视为不可用（测试可注入）
    const reg = registry !== undefined ? registry : await fetchPluginRegistry();
    if (!reg) err = "registry unavailable";
    else latest = reg[id]?.version || null;
    if (reg && !latest) err = "not in registry";
  }

  if (!latest) {
    return { current, latest: null, hasUpdate: false, manifestUrl, error: err };
  }
  return {
    current,
    latest,
    hasUpdate: cmpVersion(latest, current) > 0,
    manifestUrl,
  };
}
