// components/use-editor-theme.ts — 界面主题 / 配色方案 / 预览主题 / 代码编辑器外观
// 从 XmlEditor.tsx 抽出（M301 拆分第一刀），所有持久化到 localStorage。

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PRESET_ID,
  LS_KEY_THEME_OVERRIDES,
  THEME_PRESETS,
  applyThemeToDom,
  normalizeOverrides,
  themeTokens,
  type ThemeMode,
  type ThemeOverrides,
} from "@/lib/xml/theme-presets";
import {
  DEFAULT_EDITOR_THEME,
  LS_KEY_EDITOR_THEME,
  applyEditorTheme,
  parseTheme,
  type EditorColorSet,
  type EditorTheme,
} from "@/lib/xml/editor-theme";
import { DEFAULT_RENDER_THEME, type RenderTheme } from "@/lib/xml/theme";

export interface UseEditorThemeReturn {
  editorTheme: EditorTheme;
  patchEditorTheme: (patch: Partial<EditorTheme>) => void;
  resetEditorTheme: () => void;
  patchEditorColor: (patch: Partial<EditorColorSet>) => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  themePreset: string;
  setThemePreset: (p: string) => void;
  themeOverrides: ThemeOverrides;
  setThemeOverrides: (fn: (prev: ThemeOverrides) => ThemeOverrides) => void;
  editingTheme: string | null;
  setEditingTheme: (v: string | null) => void;
  renderTheme: RenderTheme;
  setRenderTheme: (v: RenderTheme) => void;
  showSystemBars: boolean;
  setShowSystemBars: (v: boolean) => void;
  previewNight: boolean;
  setPreviewNight: (v: boolean) => void;
  previewLocale: string;
  setPreviewLocale: (v: string) => void;
  patchThemeToken: (token: string, color: string) => void;
  resetThemeToken: (token: string) => void;
  resetThemePreset: () => void;
}

export function useEditorTheme(): UseEditorThemeReturn {
  /** M37：代码编辑器外观（光标/选区/高亮/字号，localStorage 记住） */
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => {
    try {
      return parseTheme(window.localStorage.getItem(LS_KEY_EDITOR_THEME));
    } catch {
      return DEFAULT_EDITOR_THEME;
    }
  });

  /** M16h：界面主题（亮/暗，影响编辑器外壳 + 持久化） */
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem("axv.theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const [themePreset, setThemePreset] = useState<string>(() => {
    try {
      const p = window.localStorage.getItem("axv.themePreset");
      return p && THEME_PRESETS.some((x) => x.id === p) ? p : DEFAULT_PRESET_ID;
    } catch {
      return DEFAULT_PRESET_ID;
    }
  });

  /** M90：配色方案的逐项覆盖（方案 id → { light, dark }），存在 localStorage */
  const [themeOverrides, setThemeOverrides] = useState<ThemeOverrides>(() => {
    try {
      return normalizeOverrides(JSON.parse(window.localStorage.getItem(LS_KEY_THEME_OVERRIDES) || "null"));
    } catch {
      return {};
    }
  });

  /** M90：正在子页里编辑的方案 id（null = 没开） */
  const [editingTheme, setEditingTheme] = useState<string | null>(null);

  /** M16d：预览渲染主题（默认 AppCompat，跟 AIDE 真机一致） */
  const [renderTheme, setRenderTheme] = useState<RenderTheme>(() => {
    try {
      const rt = window.localStorage.getItem("axv.renderTheme");
      return rt === "material3" || rt === "appcompat" ? rt : DEFAULT_RENDER_THEME;
    } catch {
      return DEFAULT_RENDER_THEME;
    }
  });

  const [showSystemBars, setShowSystemBars] = useState(true);
  /** M92：预览深色模式（工程 values-night）/ M93：预览语言（values-<locale>） */
  const [previewNight, setPreviewNight] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("axv.previewNight") === "1";
    } catch {
      return false;
    }
  });
  const [previewLocale, setPreviewLocale] = useState<string>(() => {
    try {
      return window.localStorage.getItem("axv.previewLocale") || "";
    } catch {
      return "";
    }
  });

  const patchEditorTheme = useCallback((patch: Partial<EditorTheme>) => {
    setEditorTheme((t) => ({ ...t, ...patch }));
  }, []);

  const resetEditorTheme = useCallback(() => {
    setEditorTheme(DEFAULT_EDITOR_THEME);
  }, []);

  /** M90b：改代码编辑器的 4 个颜色之一（按当前亮/暗写对应那一套） */
  const patchEditorColor = useCallback(
    (patch: Partial<EditorColorSet>) => {
      setEditorTheme((t) =>
        theme === "dark" ? { ...t, dark: { ...(t.dark ?? {}), ...patch } } : { ...t, ...patch },
      );    },
    [theme],
  );

  /** M90：改一项颜色（写到「正在编辑的方案」× 当前亮暗）
   *  ⚠️ 必须用 editingTheme，不能用 themePreset —— 用户可以从卡片直接编辑
   *  未选中的方案，写错对象会把颜色存到当前方案上。 */
  const patchThemeToken = useCallback(
    (token: string, color: string) => {
      const pid = editingTheme ?? themePreset;
      // 改成跟默认值一模一样 → 当作「没改过」，不写冗余覆盖
      const same = themeTokens(pid, theme)[token] === color;
      setThemeOverrides((prev) => {
        const cur = prev[pid] ?? {};
        if (same) {
          const modeMap = { ...(cur[theme] ?? {}) };
          delete modeMap[token];
          const nextPreset = { ...cur };
          if (Object.keys(modeMap).length) nextPreset[theme] = modeMap;
          else delete nextPreset[theme];
          const next = { ...prev };
          if (Object.keys(nextPreset).length) next[pid] = nextPreset;
          else delete next[pid];
          return next;
        }
        const modeMap = { ...(cur[theme] ?? {}), [token]: color };
        return { ...prev, [pid]: { ...cur, [theme]: modeMap } };
      });
    },
    [editingTheme, themePreset, theme],
  );

  /** M90：恢复单项默认（删掉覆盖值） */
  const resetThemeToken = useCallback(
    (token: string) => {
      const pid = editingTheme ?? themePreset;
      setThemeOverrides((prev) => {
        const cur = prev[pid];
        if (!cur) return prev;
        const modeMap = { ...(cur[theme] ?? {}) };
        delete modeMap[token];
        const nextPreset = { ...cur };
        if (Object.keys(modeMap).length) nextPreset[theme] = modeMap;
        else delete nextPreset[theme];
        const next = { ...prev };
        if (Object.keys(nextPreset).length) next[pid] = nextPreset;
        else delete next[pid];
        return next;
      });
    },
    [editingTheme, themePreset, theme],
  );

  /** M90：整套方案恢复默认 */
  const resetThemePreset = useCallback(() => {
    const pid = editingTheme ?? themePreset;
    setThemeOverrides((prev) => {
      if (!prev[pid]) return prev;
      const next = { ...prev };
      delete next[pid];
      return next;
    });
  }, [editingTheme, themePreset]);

  // M11：启动时恢复主题（兼容旧 key：axv.theme=dark）
  // 注意：读 localStorage 必须在 useState 初始化里做，不能放 effect——
  // 否则「持久化 effect」会先一步把默认值写回去，刚存的主题被自己覆盖。

  // M16d：渲染主题持久化
  useEffect(() => {
    try {
      window.localStorage.setItem("axv.renderTheme", renderTheme);
    } catch {
      /* ignore */
    }
  }, [renderTheme]);

  // M92/M93：深色模式与预览语言持久化
  useEffect(() => {
    try {
      window.localStorage.setItem("axv.previewNight", previewNight ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [previewNight]);

  useEffect(() => {
    try {
      window.localStorage.setItem("axv.previewLocale", previewLocale);
    } catch {
      /* ignore */
    }
  }, [previewLocale]);

  // M37：代码编辑器外观（CSS 变量 + localStorage 持久化）
  // M90b：光标/选区/当前行 4 个颜色分浅色、深色两套，按当前主题取
  useEffect(() => {
    applyEditorTheme(editorTheme, theme);
    try {
      window.localStorage.setItem(LS_KEY_EDITOR_THEME, JSON.stringify(editorTheme));
    } catch {
      /* ignore */
    }
  }, [editorTheme, theme]);

  // M16h：应用配色方案（只影响编辑器外壳，不影响导出/预览）
  // M90：带上当前方案的覆盖值；子页打开时临时预览正在编辑的那套（关闭就回原方案）
  useEffect(() => {
    const shown = editingTheme ?? themePreset;
    applyThemeToDom(shown, theme, themeOverrides[shown]?.[theme]);
    try {
      window.localStorage.setItem("axv.theme", theme);
      window.localStorage.setItem("axv.themePreset", themePreset);
    } catch {
      /* ignore */
    }
  }, [theme, themePreset, editingTheme, themeOverrides]);

  // M90：覆盖表持久化
  useEffect(() => {
    try {
      if (Object.keys(themeOverrides).length) {
        window.localStorage.setItem(LS_KEY_THEME_OVERRIDES, JSON.stringify(themeOverrides));
      } else {
        window.localStorage.removeItem(LS_KEY_THEME_OVERRIDES);
      }
    } catch {
      /* ignore */
    }
  }, [themeOverrides]);

  return {
    editorTheme,
    patchEditorTheme,
    resetEditorTheme,
    patchEditorColor,
    theme,
    setTheme,
    themePreset,
    setThemePreset,
    themeOverrides,
    setThemeOverrides,
    editingTheme,
    setEditingTheme,
    renderTheme,
    setRenderTheme,
    showSystemBars,
    setShowSystemBars,
    previewNight,
    setPreviewNight,
    previewLocale,
    setPreviewLocale,
    patchThemeToken,
    resetThemeToken,
    resetThemePreset,
  };
}
