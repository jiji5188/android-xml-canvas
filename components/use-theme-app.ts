// components/use-theme-app.ts — M366 step22（路线 2 拆解）：主题应用 + 应用图标初始值域
//
// 从 XmlEditor.tsx 抽出（原 ~1428-1510 区域）：
//   themeApplying state / applyAndroidTheme（M316 主题选择页 → 写 themes.xml）
//   appIconInit（M174「设为应用图标」面板初始值）
//
// projRoot 提为一等参数（appIconInit 是渲染期 useMemo，必须同步拿到）；
// 其余 deps-getter + 延迟 Proxy（回调运行时解引用，渲染期不触发）。
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeThemeIntoValues, type AndroidThemePreset } from "@/lib/xml/android-theme-presets";
import { readProjectFile, saveResFiles, resAbs, type ProjectSaveRoot } from "@/lib/xml/project-save";
import { parseAppIconConfig } from "@/lib/xml/app-icon";
import { nativeBridge } from "@/lib/xml/native-save";
import { LS_KEY_APP_ICON, lsGetJson } from "@/lib/xml/storage";

export interface ThemeAppDeps {
  setExportNote: (s: string) => void;
  tr: (zh: string, en: string, vars?: Record<string, string>) => string;
  setProjectRev: React.Dispatch<React.SetStateAction<number>>;
  bumpResCache: () => void;
}

export interface ThemeAppResult {
  themeApplying: boolean;
  applyAndroidTheme: (preset: AndroidThemePreset) => Promise<void>;
  appIconInit: { bgColor?: string; contentDp?: number } | null;
}

export function useThemeApp(projRoot: ProjectSaveRoot | null, getDeps: () => ThemeAppDeps): ThemeAppResult {
  const depsRef = useRef<ThemeAppDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as ThemeAppDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** M316：主题选择页——把选中预设写进 themes.xml（没有则新建），写完刷新资源索引 */
  const [themeApplying, setThemeApplying] = useState(false);
  const applyAndroidTheme = useCallback(
    async (preset: AndroidThemePreset) => {
      if (!projRoot) {
        D.setExportNote(D.tr("没有打开的项目，先新建/打开一个项目", "Open a project first"));
        window.setTimeout(() => D.setExportNote(" "), 3200);
        return;
      }
      setThemeApplying(true);
      const rel = "values/themes.xml";
      try {
        const cur = await readProjectFile(projRoot, rel);
        const base = cur ?? "";
        const next = writeThemeIntoValues(base, preset);
        const r = await saveResFiles(projRoot, [{ path: rel, text: next }]);
        D.setProjectRev((n) => n + 1);
        // M316：写进 themes.xml 后失效 res 全量索引缓存 → 重新收集 themeAttrs → 预览框调色板即时更新
        D.bumpResCache();
        D.setExportNote(
          r.ok
            ? D.tr("已应用主题 {name} → themes.xml", "Applied theme {name} to themes.xml", { name: preset.name })
            : D.tr("主题写入失败（{n} 条）", "Theme write failed ({n})", { n: String(r.failed.length) }),
        );
        window.setTimeout(() => D.setExportNote(" "), 3200);
      } catch {
        D.setExportNote(D.tr("主题写入出错", "Failed to write theme"));
        window.setTimeout(() => D.setExportNote(" "), 3200);
      } finally {
        setThemeApplying(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projRoot],
  );

  /** M174：「设为应用图标」面板初始值：
   *  1) localStorage 里上次的参数（生成过就写进去）
   *  2) 没有则从项目 res 读回（native 壳里读 mipmap-anydpi-v26 + drawable 背景色） */
  const appIconInit = useMemo(() => {
    try {
      const saved = lsGetJson<{ bgColor?: string; contentDp?: number }>(LS_KEY_APP_ICON);
      if (saved?.bgColor) {
        return { bgColor: saved.bgColor, contentDp: saved.contentDp ?? 72 };
      }
      if (projRoot?.kind === "native") {
        const b = nativeBridge();
        if (b?.readText) {
          const collect: Record<string, string> = {};
          for (const rel of [
            "mipmap-anydpi-v26/ic_launcher.xml",
            "mipmap-anydpi-v26/ic_launcher_round.xml",
            "drawable/ic_launcher_background.xml",
            "drawable/ic_launcher_foreground.xml",
          ]) {
            try {
              const t = b.readText(resAbs(projRoot.base, rel));
              if (t) collect[rel] = t;
            } catch { /* 读不到就跳过 */ }
          }
          const cfg = parseAppIconConfig(collect);
          if (cfg) return cfg;
        }
      }
    } catch { /* 回落到默认值 */ }
    return null;
  }, [projRoot]);

  return { themeApplying, applyAndroidTheme, appIconInit };
}
