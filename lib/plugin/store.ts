// lib/plugin/store.ts — 插件启用/禁用状态（M233 最小版）
//
// 只管理「内置插件的开关」。状态存 localStorage（和其它 axv 数据一致），刷新不丢。
// 没有「下载安装」——内置插件永远在，只能开/关。
//
// 用法：
//   const [enabled, setEnabled] = useState(loadPluginEnabled);
//   togglePlugin(id, on, setEnabled)  // 切换 + 持久化
//
// PluginEditorHost 在 resolve 后查 enabledById[id]，没开就渲染 null（回退到代码编辑）。

import { EditorRegistry, type EditorKind } from "./plugin-registry";

const LS_KEY = "axv.plugin.enabled";

/** 内置插件的固定清单（和 registerBuiltinEditors 一致）。新增内置插件要同步这里 */
export const BUILTIN_PLUGIN_IDS = ["axv:editor:drawable", "axv:editor:icon"];

export type PluginEnabledMap = Record<string, boolean>;

/** 读 localStorage。没存过的（新装）默认全启用 */
export function loadPluginEnabled(): PluginEnabledMap {
  const defaults: PluginEnabledMap = {};
  for (const id of BUILTIN_PLUGIN_IDS) defaults[id] = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed: Record<string, unknown> = JSON.parse(raw);
    // 合并：解析出来的覆盖默认（允许关闭）；没出现的保留默认
    for (const id of BUILTIN_PLUGIN_IDS) {
      if (typeof parsed[id] === "boolean") defaults[id] = parsed[id];
    }
    return defaults;
  } catch {
    return defaults;
  }
}

/** 持久化到 localStorage */
export function savePluginEnabled(map: PluginEnabledMap): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等，忽略 */
  }
}

/** 切换某插件的启用状态，返回新 map（调用方负责 setState + save） */
export function togglePluginEnabled(
  id: string,
  on: boolean,
  current: PluginEnabledMap,
): PluginEnabledMap {
  const next: PluginEnabledMap = { ...current, [id]: on };
  savePluginEnabled(next);
  return next;
}

/** 给编辑器「种类」查当前启用的插件 id；没启用 / 没注册 → null */
export function enabledPluginForKind(kind: EditorKind, enabled: PluginEnabledMap): string | null {
  const m = EditorRegistry.resolve(kind);
  if (!m) return null;
  if (enabled[m.id] === false) return null;
  return m.id;
}
