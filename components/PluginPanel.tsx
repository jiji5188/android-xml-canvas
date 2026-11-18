"use client";

// components/PluginPanel.tsx — M233：设置面板里的「插件」分组
//
// 最小版：列出全部内置插件（drawable / icon 编辑器），每个一个开关。
// 状态由父层（XmlEditor）持有 —— 关掉某插件后，资源树点对应类型就回退到代码编辑。
// 没有「下载安装」，内置插件只能开/关。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { EditorRegistry } from "@/lib/plugin/plugin-registry";
import { BUILTIN_PLUGIN_IDS, type PluginEnabledMap } from "@/lib/plugin/store";
import { BUILTIN_PLUGIN_VERSIONS, checkPluginUpdate, fetchPluginRegistry } from "@/lib/plugin/updates";

export interface PluginEntry {
  id: string;
  label: string;
  builtin: boolean;
}

/** 取当前已注册的全部插件条目（顺序 = 注册顺序）。内置 vs 第三方用 BUILTIN_PLUGIN_IDS 判 */
export function listPlugins(): PluginEntry[] {
  // 注册表没暴露 byId 列表，用 kinds 去重 + get 取
  const seen = new Set<string>();
  const out: PluginEntry[] = [];
  for (const kind of EditorRegistry.kinds()) {
    const m = EditorRegistry.resolve(kind);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, label: m.label || m.id, builtin: BUILTIN_PLUGIN_IDS.includes(m.id) });
  }
  return out;
}

interface Props {
  enabled: PluginEnabledMap;
  onToggle: (id: string, on: boolean) => void;
}

interface CheckState {
  busy?: boolean;
  note?: string;
  hasUpdate?: boolean;
}

export function PluginPanel({ enabled, onToggle }: Props) {
  const plugins = listPlugins();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});

  const runCheck = async (id: string) => {
    const cur = BUILTIN_PLUGIN_VERSIONS[id] || "1.0.0";
    setChecks((m) => ({ ...m, [id]: { busy: true } }));
    const reg = await fetchPluginRegistry();
    const r = await checkPluginUpdate(id, cur, undefined, reg);
    let note: string;
    if (r.error === "registry unavailable") {
      note = tt("检查失败：无法连接插件仓库");
    } else if (r.error === "not in registry") {
      note = tt("仓库里没有这个插件（当前 v{v}）", { v: r.current });
    } else if (r.error) {
      note = tt("检查失败：{e}", { e: r.error });
    } else if (r.hasUpdate) {
      note = tt("发现新版本 v{v}（内置插件随应用更新）", { v: r.latest || "?" });
    } else {
      note = tt("已是最新版本 v{v}", { v: r.current });
    }
    setChecks((m) => ({ ...m, [id]: { note, hasUpdate: !!r.hasUpdate } }));
  };

  return (
    <div className="axv-plugin-list">
      {plugins.map((p) => {
        const on = enabled[p.id] !== false;
        return (
          <div key={p.id} className="axv-plugin-item">
            <div className="axv-plugin-meta">
              <b>
                {p.label}
                {p.builtin ? null : <span className="axv-plugin-tag">{tt("第三方")}</span>}
              </b>
              <span className="axv-plugin-id">
                {p.id}
                {p.builtin ? " v" + (BUILTIN_PLUGIN_VERSIONS[p.id] || "1.0.0") : ""}
              </span>
              {checks[p.id]?.note ? (
                <span
                  className="axv-plugin-id"
                  style={{ fontSize: 10, color: checks[p.id]?.hasUpdate ? "#b26a00" : undefined }}
                >
                  {checks[p.id]?.note}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="axv-plugin-check"
              disabled={!!checks[p.id]?.busy}
              onClick={() => void runCheck(p.id)}
            >
              {checks[p.id]?.busy ? tt("检查中…") : tt("检查更新")}
            </button>
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
