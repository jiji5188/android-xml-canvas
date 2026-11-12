// lib/xml/last-rel.ts — M144「项目 → 上次打开的文件」记忆
//
// 从 components/XmlEditor.tsx 抽出来的纯 localStorage 逻辑（无 React 依赖）。
// 按项目名分组存一张 map：切项目再切回来，还是上次那个文件。

import { lsGetJson, lsSetJson } from "./storage";

const LAST_REL_MAP_KEY = "axv.lastFile.map.v1";

function readLastRelMap(): Record<string, string> {
  const raw = lsGetJson<Record<string, string>>(LAST_REL_MAP_KEY);
  return raw && typeof raw === "object" ? raw : {};
}

/** 读某项目上次打开的文件（相对路径）；没记过返回 null */
export function readLastRel(projectKey: string): string | null {
  if (!projectKey) return null;
  const rel = readLastRelMap()[projectKey];
  return typeof rel === "string" && rel ? rel : null;
}

/** 记下某项目当前打开的文件（空值忽略，写失败静默） */
export function writeLastRel(projectKey: string, rel: string): void {
  if (!projectKey || !rel) return;
  try {
    const map = readLastRelMap();
    map[projectKey] = rel;
    lsSetJson(LAST_REL_MAP_KEY, map);
  } catch {
    /* 静默：记忆失败不该影响编辑 */
  }
}
