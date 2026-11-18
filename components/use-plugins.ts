// components/use-plugins.ts — M366 step18（路线 2 拆解）：插件域（内置开关 / 第三方安装 / 编译器更新）
//
// 从 XmlEditor.tsx 抽出（原 ~546-620 区域）：
//   pluginEnabled/onTogglePlugin（内置 drawable/icon 插件开关）
//   installedPlugins/installBusy/installNote + 启动加载 effect（第三方插件）
//   compilerInfo/compilerBusy/compilerNote + onCheckCompilerUpdate（编译器插件）
//   onInstallPlugin（装第三方插件）
//
// 纯 state + lib 调用；tt 由壳传入（随语言变化）。
"use client";

import { useEffect, useState } from "react";
import { loadPluginEnabled, togglePluginEnabled, type PluginEnabledMap } from "@/lib/plugin/store";
import { installPlugin, loadInstalledPlugins, type InstalledPlugin } from "@/lib/plugin/installer";
import { BUILTIN_COMPILER } from "@/lib/plugin/compiler";

export interface PluginsResult {
  pluginEnabled: PluginEnabledMap;
  setPluginEnabled: React.Dispatch<React.SetStateAction<PluginEnabledMap>>;
  onTogglePlugin: (id: string, on: boolean) => void;
  installedPlugins: InstalledPlugin[];
  setInstalledPlugins: React.Dispatch<React.SetStateAction<InstalledPlugin[]>>;
  installBusy: boolean;
  installNote: string;
  compilerInfo: { id: string; name: string; language: string; version: string; source: string };
  compilerBusy: boolean;
  compilerNote: string;
  onCheckCompilerUpdate: () => void;
  onInstallPlugin: (manifestUrl: string) => Promise<void>;
}

export function usePlugins(tt: (s: string, v?: Record<string, string>) => string): PluginsResult {
  // M233：内置编辑器插件的启用状态（drawable / icon）。关掉后资源树点对应类型回退代码编辑。
  const [pluginEnabled, setPluginEnabled] = useState<PluginEnabledMap>(loadPluginEnabled);
  const onTogglePlugin = (id: string, on: boolean) =>
    setPluginEnabled((cur) => togglePluginEnabled(id, on, cur));

  // M234：第三方插件安装
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [installBusy, setInstallBusy] = useState(false);
  const [installNote, setInstallNote] = useState("");
  // 启动时把 IndexedDB 里已装的插件重新加载 + 注册
  useEffect(() => {
    let alive = true;
    loadInstalledPlugins().then((list) => {
      if (alive) setInstalledPlugins(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // M235：编译器插件（内置）
  const [compilerInfo, setCompilerInfo] = useState({
    id: BUILTIN_COMPILER.id, name: BUILTIN_COMPILER.name, language: BUILTIN_COMPILER.language,
    version: BUILTIN_COMPILER.version, source: BUILTIN_COMPILER.source as string,
  });
  const [compilerBusy, setCompilerBusy] = useState(false);
  const [compilerNote, setCompilerNote] = useState("");
  const onCheckCompilerUpdate = () => {
    setCompilerBusy(true);
    setCompilerNote("");
    import("@/lib/plugin/compiler").then(({ fetchCompilerInfo }) => {
      fetchCompilerInfo()
        .then((info) => {
          if (info) {
            setCompilerInfo({ ...info, source: info.version !== "3.33.0" ? "remote" : "builtin" });
            setCompilerNote(
              info.version === "3.33.0"
                ? tt("已是最新版本 v{v}", { v: info.version })
                : tt("发现新版本 v{v}（APK 端下载后重启生效）", { v: info.version })
            );
          } else {
            setCompilerNote(tt("拉取 manifest 失败，检查网络"));
          }
        })
        .catch(() => setCompilerNote(tt("拉取 manifest 失败")))
        .finally(() => setCompilerBusy(false));
    }).catch(() => setCompilerBusy(false));
  };
  const onInstallPlugin = (manifestUrl: string): Promise<void> => {
    setInstallBusy(true);
    setInstallNote("");
    return installPlugin(manifestUrl)
      .then((p) => {
        setInstalledPlugins((cur) => (cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p]));
        setInstallNote(tt("已安装：{name}", { name: p.name }));
        setPluginEnabled((cur) => ({ ...cur, [p.id]: true }));
      })
      .catch((e: unknown) => {
        const msg = String((e as Error)?.message || e);
        setInstallNote(msg);
        throw new Error(msg); // 让弹窗也能 catch
      })
      .finally(() => setInstallBusy(false));
  };

  return {
    pluginEnabled, setPluginEnabled, onTogglePlugin,
    installedPlugins, setInstalledPlugins, installBusy, installNote,
    compilerInfo, compilerBusy, compilerNote, onCheckCompilerUpdate, onInstallPlugin,
  };
}
