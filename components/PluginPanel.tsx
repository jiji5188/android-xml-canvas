"use client";

// components/PluginPanel.tsx — M233：设置面板里的「插件」分组
//
// 最小版：列出全部内置插件（drawable / icon 编辑器），每个一个开关。
// 状态由父层（XmlEditor）持有 —— 关掉某插件后，资源树点对应类型就回退到代码编辑。
// 没有「下载安装」，内置插件只能开/关。

import { t as tt } from "@/lib/i18n-src";
import { EditorRegistry } from "@/lib/plugin/plugin-registry";
import type { PluginEnabledMap } from "@/lib/plugin/store";

export interface PluginEntry {
  id: string;
  label: string;
  builtin: boolean;
}

/** 取当前已注册的全部插件条目（顺序 = 注册顺序） */
export function listPlugins(): PluginEntry[] {
  // 注册表没暴露 byId 列表，用 kinds 去重 + get 取
  const seen = new Set<string>();
  const out: PluginEntry[] = [];
  for (const kind of EditorRegistry.kinds()) {
    const m = EditorRegistry.resolve(kind);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, label: m.label || m.id, builtin: true });
  }
  // 没注册的内置（理论上不会，但保险）
  for (const id of ["axv:editor:drawable", "axv:editor:icon"]) {
    if (!seen.has(id)) out.push({ id, label: id, builtin: true });
  }
  return out;
}

interface Props {
  enabled: PluginEnabledMap;
  onToggle: (id: string, on: boolean) => void;
}

export function PluginPanel({ enabled, onToggle }: Props) {
  const plugins = listPlugins();
  return (
    <div className="axv-plugin-list">
      {plugins.map((p) => {
        const on = enabled[p.id] !== false;
        return (
          <div key={p.id} className="axv-plugin-item">
            <div className="axv-plugin-meta">
              <b>{p.label}</b>
              <span className="axv-plugin-id">{p.id}</span>
            </div>
            <label className="axv-plugin-toggle">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onToggle(p.id, e.target.checked)}
                aria-label={tt("启用") + " " + p.label}
              />
              <span>{on ? tt("已启用") : tt("已禁用")}</span>
            </label>
          </div>
        );
      })}
      <div className="axv-set-hint">
        {tt("关闭某插件后，资源树点对应类型会回退到代码编辑器。设置自动保存。")}
      </div>
    </div>
  );
}
