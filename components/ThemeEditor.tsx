"use client";

// components/ThemeEditor.tsx —— M90：配色方案编辑子页
//
// 从「设置 → 配色方案」每个卡片右上角的编辑图标进入，改这一套方案的颜色。
// 覆盖值存在 localStorage（axv.themeOverrides），按 方案 id × 亮/暗 分开存；
// 没改过的 token 仍然走 theme-presets.ts 的推导值，所以换方案/换亮暗不会串味。
//
// 页面下半部分是「代码编辑器」的 4 个颜色（选区背景 / 选区文字 / 光标 / 当前行）。
// 这 4 个是全局的（EditorTheme），不随亮暗切换 —— 这里直接复用 onEditorTheme。

import { useEffect } from "react";
import { useOverlayBack } from "@/lib/overlay-back";
import {
  DARK_EDITOR_COLORS,
  DEFAULT_EDITOR_THEME,
  colorsFor,
  type EditorColorSet,
  type EditorTheme,
} from "@/lib/xml/editor-theme";
import {
  presetById,
  themeTokens,
  THEME_TOKEN_LABEL,
  THEME_TOKEN_ORDER,
  type ThemeMode,
  type ThemeTokenOverrides,
} from "@/lib/xml/theme-presets";
import { ColorField } from "./ColorField";

export interface ThemeEditorProps {
  presetId: string;
  mode: ThemeMode;
  onMode: (m: ThemeMode) => void;
  /** 当前方案、当前亮暗的覆盖表（可能为空） */
  overrides: ThemeTokenOverrides;
  onChangeToken: (token: string, value: string) => void;
  onResetToken: (token: string) => void;
  onResetPreset: () => void;
  editorTheme: EditorTheme;
  onEditorTheme: (patch: Partial<EditorTheme>) => void;
  /** M90b：4 个代码颜色按当前亮/暗写 */
  onEditorColor: (patch: Partial<EditorColorSet>) => void;
  onClose: () => void;
}

export function ThemeEditor({
  presetId,
  mode,
  onMode,
  overrides,
  onChangeToken,
  onResetToken,
  onResetPreset,
  editorTheme,
  onEditorTheme,
  onEditorColor,
  onClose,
}: ThemeEditorProps) {
  const preset = presetById(presetId);
  const derived = themeTokens(presetId, mode);
  const current = themeTokens(presetId, mode, overrides);
  const touched = Object.keys(overrides).filter((k) => k in derived).length;
  // M90b：代码颜色跟亮/暗走
  const ec = colorsFor(editorTheme, mode);
  const ecDefault = mode === "dark" ? DARK_EDITOR_COLORS : DEFAULT_EDITOR_THEME;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const close = useOverlayBack(true, onClose);

  return (
    <div className="axv-icon-page axv-thm-page" role="dialog" aria-label="编辑配色方案">
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label="返回设置" title="返回">
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">
          配色方案 · {preset.name}
          {touched ? <b className="axv-thm-count">{touched} 项已改</b> : null}
        </span>
      </div>

      <div className="axv-thm-body">
        <div className="axv-thm-mode">
          <div className="axv-set-seg">
            <button
              className={"axv-set-seg-btn" + (mode === "light" ? " on" : "")}
              onClick={() => onMode("light")}
            >
              浅色
            </button>
            <button
              className={"axv-set-seg-btn" + (mode === "dark" ? " on" : "")}
              onClick={() => onMode("dark")}
            >
              深色
            </button>
          </div>
          <div className="axv-set-hint">浅色和深色分开存，改的是当前这一档。</div>
        </div>

        <div className="axv-thm-sect">界面颜色</div>
        <div className="axv-thm-list">
          {THEME_TOKEN_ORDER.map((token) => {
            const changed = token in overrides && overrides[token] !== derived[token];
            return (
              <div className={"axv-thm-row" + (changed ? " is-changed" : "")} key={token}>
                <span className="axv-thm-name">{THEME_TOKEN_LABEL[token]}</span>
                <code className="axv-thm-val" title={current[token]}>
                  {current[token]}
                </code>
                <ColorField
                  aboveModal
                  label={THEME_TOKEN_LABEL[token]}
                  value={current[token]}
                  fallback={derived[token]}
                  onChange={(v) => onChangeToken(token, v)}
                />
                <button
                  type="button"
                  className="axv-thm-reset"
                  title="恢复默认"
                  aria-label={`恢复${THEME_TOKEN_LABEL[token]}默认值`}
                  disabled={!changed}
                  onClick={() => onResetToken(token)}
                >
                  <span className="msr" aria-hidden="true">settings_backup_restore</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="axv-thm-sect">
          代码编辑器
          <span className="axv-thm-note">
            {mode === "dark" ? "深色" : "浅色"}一套，切换亮/暗自动跟着换
          </span>
        </div>
        <div className="axv-thm-list">
          <div className="axv-thm-row">
            <span className="axv-thm-name">选中背景色</span>
            <code className="axv-thm-val">{ec.selBg}</code>
            <ColorField
              aboveModal
              label="选中背景色"
              value={ec.selBg}
              fallback={ecDefault.selBg}
              onChange={(v) => onEditorColor({ selBg: v })}
            />
            <span className="axv-thm-reset is-empty" aria-hidden="true" />
          </div>
          <div className="axv-thm-row">
            <span className="axv-thm-name">选中文字颜色</span>
            <code className="axv-thm-val">
              {ec.selFg === "transparent" ? "跟随高亮" : ec.selFg}
            </code>
            <ColorField
              aboveModal
              allowTransparent
              label="选中文字颜色"
              value={ec.selFg}
              fallback={ecDefault.selFg}
              onChange={(v) => onEditorColor({ selFg: v })}
            />
            <span className="axv-thm-reset is-empty" aria-hidden="true" />
          </div>
          <div className="axv-thm-row">
            <span className="axv-thm-name">光标颜色</span>
            <code className="axv-thm-val">{ec.cursor}</code>
            <ColorField
              aboveModal
              label="光标颜色"
              value={ec.cursor}
              fallback={ecDefault.cursor}
              onChange={(v) => onEditorColor({ cursor: v })}
            />
            <span className="axv-thm-reset is-empty" aria-hidden="true" />
          </div>
          <div className="axv-thm-row">
            <span className="axv-thm-name">当前行背景色</span>
            <code className="axv-thm-val">{ec.curBg}</code>
            <ColorField
              aboveModal
              label="当前行背景色"
              value={ec.curBg}
              fallback={ecDefault.curBg}
              disabled={!editorTheme.showCur}
              onChange={(v) => onEditorColor({ curBg: v })}
            />
            <span className="axv-thm-reset is-empty" aria-hidden="true" />
          </div>
          <label className="axv-thm-row axv-thm-switch">
            <span className="axv-thm-name">高亮当前行</span>
            <span />
            <input
              type="checkbox"
              checked={editorTheme.showCur}
              onChange={(e) => onEditorTheme({ showCur: e.target.checked })}
            />
            <span className="axv-thm-reset is-empty" aria-hidden="true" />
          </label>
        </div>

        <div className="axv-set-hint" style={{ marginTop: 10 }}>
          配色只作用于编辑器界面，不影响导出/预览的布局。
        </div>
      </div>

      <div className="axv-icon-page-foot axv-thm-foot">
        <span />
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={onResetPreset}>
            恢复本方案默认
          </button>
          <button className="axv-btn axv-btn-primary" onClick={close}>
            完成
          </button>
        </span>
      </div>
    </div>
  );
}
