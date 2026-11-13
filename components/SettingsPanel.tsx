// components/SettingsPanel.tsx — 「设置」面板（从 XmlEditor.tsx 抽出）
//
// 纯展示 + 回调：所有状态仍由 XmlEditor 持有，这里只负责画。
// 好处：设置项以后加一堆开关也不会再把主文件撑行数。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import {
  THEME_PRESETS,
  themeTokens,
  type ThemeMode,
  type ThemeOverrides,
} from "@/lib/xml/theme-presets";
import { RENDER_THEMES, type RenderTheme } from "@/lib/xml/theme";
import { LANG_OPTIONS, type LangPref } from "@/lib/i18n";
import type { WsInfo } from "@/lib/xml/workspace";
import {
  DARK_EDITOR_COLORS,
  DEFAULT_EDITOR_THEME,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HL_PRESETS,
  INDENT_MAX,
  INDENT_MIN,
  colorsFor,
  type EditorColorSet,
  type EditorTheme,
} from "@/lib/xml/editor-theme";
import { ColorField } from "./ColorField";
import { PluginPanel } from "./PluginPanel";
import type { PluginEnabledMap } from "@/lib/plugin/store";

export interface SettingsPanelProps {
  tr: (key: string, fallback: string) => string;

  // 外观
  themePreset: string;
  onThemePreset: (id: string) => void;
  theme: ThemeMode;
  onTheme: (m: ThemeMode) => void;
  /** M90：各方案的 token 覆盖（卡片预览要用真实值） */
  themeOverrides: ThemeOverrides;
  /** M90：打开「编辑配色方案」子页 */
  onEditTheme: (id: string) => void;

  // 语言
  langPref: LangPref;
  onLangPref: (p: LangPref) => void;

  // 工作目录
  wsState: WsInfo | null;
  onPickDir: () => void;
  onUseDefault: () => void;
  onRequestAllFiles: () => void;

  // 渲染设备（AppCompat / Material3）
  renderTheme: RenderTheme;
  onRenderTheme: (t: RenderTheme) => void;
  /** M92：深色模式预览（values-night） */
  previewNight: boolean;
  onPreviewNight: (v: boolean) => void;
  /** 工程里是否读到 values-night 的主题 */
  hasNightTheme: boolean;
  /** M93：多语言预览 */
  previewLocale: string;
  onPreviewLocale: (v: string) => void;
  /** 工程里读到的语言限定符列表 */
  locales: string[];

  // 预览开关
  showSystemBars: boolean;
  onShowSystemBars: (v: boolean) => void;
  showIssues: boolean;
  onShowIssues: (v: boolean) => void;

  // M37：代码编辑器外观
  editorTheme: EditorTheme;
  onEditorTheme: (patch: Partial<EditorTheme>) => void;
  /** M90b：改当前亮/暗主题下的那 4 个代码颜色 */
  onEditorColor: (patch: Partial<EditorColorSet>) => void;
  onResetEditorTheme: () => void;

  // 数据
  onSaveXml: () => void;

  // M233：插件（内置编辑器的启用/禁用）
  pluginsEnabled: PluginEnabledMap;
  onTogglePlugin: (id: string, on: boolean) => void;
}

export function SettingsPanel(p: SettingsPanelProps) {
  // M90b：代码编辑器的光标/选区/当前行颜色分浅色、深色两套
  const ec = colorsFor(p.editorTheme, p.theme);
  const ecDefault = p.theme === "dark" ? DARK_EDITOR_COLORS : DEFAULT_EDITOR_THEME;
  const { tr } = p;
  // M50：每个分组可折叠，默认全部折叠（设置项现在太多了，一屏扫不完）
  const [openGroups, setOpenGroups] = useState<Set<number>>(() => new Set());
  const isOpen = (i: number) => openGroups.has(i);
  const toggle = (i: number) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const groupCls = (i: number) => "axv-set-group" + (isOpen(i) ? " open" : "");
  return (
    <div className="axv-rail-scroll axv-settings">
      {/* ===== 外观：预设配色方案 ===== */}
      <div className={groupCls(0)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(0)}
          onClick={() => toggle(0)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.theme", "配色方案")}
        </button>
        <div className="axv-theme-grid">
          {THEME_PRESETS.map((preset) => {
            const t = themeTokens(preset.id, p.theme, p.themeOverrides[preset.id]?.[p.theme]);
            const on = preset.id === p.themePreset;
            return (
              <div className={"axv-theme-card" + (on ? " on" : "")} key={preset.id}>
                <button
                  type="button"
                  className="axv-theme-pick"
                  onClick={() => p.onThemePreset(preset.id)}
                  title={preset.note}
                  aria-pressed={on}
                >
                  <span
                    className="axv-theme-swatch"
                    style={{
                      background: `linear-gradient(135deg, ${t.primary}, ${t.toolbarBg})`,
                      borderColor: t.primary,
                    }}
                  >
                    <span style={{ background: t.panelBg }} />
                  </span>
                  <span className="axv-theme-name">{preset.name}</span>
                </button>
                {/* M90：进子页改这一套的颜色（选中态不受影响，不会误切方案） */}
                <button
                  type="button"
                  className="axv-theme-edit"
                  onClick={() => p.onEditTheme(preset.id)}
                  title={tt("修改「{name}」的颜色", { name: preset.name })}
                  aria-label={tt("修改「{name}」的颜色", { name: preset.name })}
                >
                  <span className="msr" aria-hidden="true">
                    palette
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="axv-set-seg" style={{ marginTop: 8 }}>
          <button
            className={"axv-set-seg-btn" + (p.theme === "light" ? " on" : "")}
            onClick={() => p.onTheme("light")}
          >
            {tr("set.themeLight", "浅色")}
          </button>
          <button
            className={"axv-set-seg-btn" + (p.theme === "dark" ? " on" : "")}
            onClick={() => p.onTheme("dark")}
          >
            {tr("set.themeDark", "深色")}
          </button>
        </div>
        <div className="axv-set-hint">
          {THEME_PRESETS.find((x) => x.id === p.themePreset)?.note}
          {tt("。配色只作用于编辑器界面，不影响导出的布局。")}
        </div>
        <div className="axv-set-hint">
          {tt("点卡片右侧的调色板图标，可以逐项改这套方案的颜色（浅色/深色分开存）。")}
        </div>
      </div>

      {/* ===== M23：界面语言 ===== */}
      <div className={groupCls(1)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(1)}
          onClick={() => toggle(1)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.lang", "界面语言")}
        </button>
        <select
          className="axv-tb-select axv-lang-select"
          value={p.langPref}
          aria-label={tr("set.lang", "界面语言")}
          onChange={(e) => p.onLangPref(e.target.value as LangPref)}
        >
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === "auto" ? `${tt(o.label)}（${o.native}）` : tt(o.label)}
            </option>
          ))}
        </select>
        <div className="axv-set-hint">
          {tr("set.langHint", "默认跟随系统语言；切换只影响编辑器界面文字，不影响布局内容。")}
        </div>
      </div>

      {/* ===== 工作目录 ===== */}
      <div className={groupCls(2)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(2)}
          onClick={() => toggle(2)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.workspace", "工作目录")}
        </button>
        <div className="axv-set-kv">
          <span>{tt("当前")}</span>
          <b title={p.wsState?.label || ""}>
            {p.wsState?.mode === "native"
              ? p.wsState.label || "AndroidUIIDE/Project"
              : p.wsState?.mode === "unsupported"
                ? tt("不支持（请用 Chrome/Edge 或 APK）")
                : p.wsState?.custom
                  ? p.wsState.label
                  : tt("未授权目录")}
          </b>
        </div>
        {p.wsState?.defaultPath ? (
          <div className="axv-set-kv">
            <span>{tt("默认")}</span>
            <b className="axv-set-mono">{p.wsState.defaultPath}</b>
          </div>
        ) : null}
        <div className="axv-set-btns">
          <button className="axv-set-btn" onClick={p.onPickDir}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              folder_open
            </span>
            {tt("选择目录")}
          </button>
          <button className="axv-set-btn" onClick={p.onUseDefault}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              settings_backup_restore
            </span>
            {tt("恢复默认")}
          </button>
        </div>
        {p.wsState?.mode === "native" && p.wsState.allFiles === false ? (
          <button className="axv-set-btn" onClick={p.onRequestAllFiles}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              shield
            </span>
            {tt("开启「所有文件访问」（默认目录在存储根下，必须开）")}
          </button>
        ) : null}
        <div className="axv-set-hint">
          {tt("默认目录：APK 下 /AndroidUIIDE/Project；网页版由你授权一个文件夹（授权会记住）。自定义目录失效时会自动回落到默认目录，两者都不会留空。")}
        </div>
      </div>

      <div className={groupCls(3)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(3)}
          onClick={() => toggle(3)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.device", "渲染设备")}
        </button>
        <div className="axv-set-seg">
          {RENDER_THEMES.map((t) => (
            <button
              key={t.id}
              className={"axv-set-seg-btn" + (p.renderTheme === t.id ? " on" : "")}
              onClick={() => p.onRenderTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="axv-set-hint">{RENDER_THEMES.find((t) => t.id === p.renderTheme)?.hint}</div>
      </div>

      <div className={groupCls(4)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(4)}
          onClick={() => toggle(4)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.preview", "预览")}
        </button>
        <label className="axv-set-row">
          <span>{tt("显示系统状态栏 / 导航栏")}</span>
          <input
            type="checkbox"
            checked={p.showSystemBars}
            onChange={(e) => p.onShowSystemBars(e.target.checked)}
          />
        </label>
        <label className="axv-set-row">
          <span>{tt("控件提示（缺资源红框等）")}</span>
          <input
            type="checkbox"
            checked={p.showIssues}
            onChange={(e) => p.onShowIssues(e.target.checked)}
          />
        </label>
        {/* M92：真机 values-night —— 登录主题属性与颜色都跟浅色分开 */}
        <label className="axv-set-row">
          <span>
            {tt("深色模式（values-night）")}
            {p.hasNightTheme ? <i className="axv-set-tag">{tt("已读到夜间主题")}</i> : null}
          </span>
          <input
            type="checkbox"
            checked={p.previewNight}
            onChange={(e) => p.onPreviewNight(e.target.checked)}
          />
        </label>
        <div className="axv-set-hint">
          {p.hasNightTheme
            ? tt("按工程 values-night/ 的主题属性与颜色渲染，跟手机开深色模式看到的一致")
            : tt("工程里没读到 values-night/，开启后只能用默认深色底盘")}
        </div>
        {/* M93：多语言预览 */}
        <div className="axv-set-kv">
          <span>{tt("预览语言（values-*）")}</span>
        </div>
        <select
          className="axv-tb-select"
          aria-label={tt("预览语言")}
          value={p.previewLocale}
          onChange={(e) => p.onPreviewLocale(e.target.value)}
        >
          <option value="">{tt("默认 values")}</option>
          {p.locales.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <div className="axv-set-hint">
          {p.locales.length
            ? tt("@string 引用会按所选语言取值，用来检查长文案 / 小语种会不会把界面撑坏")
            : tt("工程里没读到 values-{lang}/strings.xml（导入 res 目录后会出现）", { lang: "<语言>" })}
        </div>
      </div>

      <div className={groupCls(5)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(5)}
          onClick={() => toggle(5)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.editor", "代码编辑器")}
        </button>

        <div className="axv-set-kv">
          <span>{tt("高亮风格")}</span>
        </div>
        <select
          className="axv-tb-select"
          aria-label={tt("高亮风格")}
          value={p.editorTheme.hl}
          onChange={(e) => p.onEditorTheme({ hl: e.target.value })}
        >
          {HL_PRESETS.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>

        <div className="axv-set-row">
          <span>
            {tt("光标颜色")}
            <i className="axv-set-tag">{p.theme === "dark" ? tt("深色") : tt("浅色")}</i>
          </span>
          <ColorField
            label={tt("光标颜色")}
            value={ec.cursor}
            fallback={ecDefault.cursor}
            onChange={(v) => p.onEditorColor({ cursor: v })}
          />
        </div>

        <div className="axv-set-row">
          <span>{tt("选中背景色")}</span>
          <ColorField
            label={tt("选中背景色")}
            value={ec.selBg}
            fallback={ecDefault.selBg}
            onChange={(v) => p.onEditorColor({ selBg: v })}
          />
        </div>

        <div className="axv-set-row">
          <span>{tt("选中文字颜色")}</span>
          <ColorField
            label={tt("选中文字颜色")}
            value={ec.selFg}
            fallback={ecDefault.selFg}
            allowTransparent
            onChange={(v) => p.onEditorColor({ selFg: v })}
          />
        </div>

        <label className="axv-set-row">
          <span>{tt("字号")}</span>
          <span className="axv-set-range">
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              aria-label={tt("代码字号")}
              value={p.editorTheme.fontSize}
              onChange={(e) => p.onEditorTheme({ fontSize: Number(e.target.value) })}
            />
            <b>{p.editorTheme.fontSize}px</b>
          </span>
        </label>

        <label className="axv-set-row">
          <span>{tt("缩进宽度")}</span>
          <span className="axv-set-range">
            <input
              type="range"
              min={INDENT_MIN}
              max={INDENT_MAX}
              step={1}
              aria-label={tt("代码缩进宽度")}
              value={p.editorTheme.indent}
              onChange={(e) => p.onEditorTheme({ indent: Number(e.target.value) })}
            />
            <b>{tt("{n} 空格", { n: p.editorTheme.indent })}</b>
          </span>
        </label>

        <label className="axv-set-row">
          <span>{tt("高亮当前行")}</span>
          <input
            type="checkbox"
            checked={p.editorTheme.showCur}
            onChange={(e) => p.onEditorTheme({ showCur: e.target.checked })}
          />
        </label>

        <div className="axv-set-row">
          <span>{tt("当前行背景色")}</span>
          <ColorField
            label={tt("当前行背景色")}
            value={ec.curBg}
            fallback={ecDefault.curBg}
            disabled={!p.editorTheme.showCur}
            onChange={(v) => p.onEditorColor({ curBg: v })}
          />
        </div>

        <button className="axv-set-btn" onClick={p.onResetEditorTheme}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            settings_backup_restore
          </span>
          {tt("恢复代码编辑器默认")}
        </button>
        <div className="axv-set-hint">
          {tt("只影响「代码」tab 的显示，不改导出的 XML。选中文字设为不透明背景时才完全盖住底层高亮字。")}
        </div>
      </div>

      <div className={groupCls(6)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(6)}
          onClick={() => toggle(6)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.data", "数据")}
        </button>
        <div className="axv-set-hint">
          {tt("布局、资源与生成的图标都自动存在本机浏览器（localStorage），关页面不丢。")}
        </div>
        <button className="axv-set-btn" onClick={p.onSaveXml}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            save
          </span>
          {tt("立即导出当前 XML")}
        </button>
        <button
          className="axv-set-btn axv-set-btn-danger"
          onClick={() => {
            if (!window.confirm(tt("清空本机所有缓存（布局 / 资源 / 生成的图标 / 文件列表）？此操作不可撤销。"))) return;
            try {
              Object.keys(window.localStorage)
                .filter((k) => k.startsWith("axv."))
                .forEach((k) => window.localStorage.removeItem(k));
            } catch {
              /* ignore */
            }
            window.location.reload();
          }}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            delete
          </span>
          {tt("清空本机缓存并重启")}
        </button>
      </div>

      {/* ===== M233：插件（内置编辑器启用/禁用） ===== */}
      <div className={groupCls(7)}>
        <button
          type="button"
          className="axv-set-label"
          aria-expanded={isOpen(7)}
          onClick={() => toggle(7)}
        >
          <span className="msr axv-set-caret" aria-hidden="true">
            chevron_right
          </span>
          {tr("set.plugins", "插件")}
        </button>
        <PluginPanel enabled={p.pluginsEnabled} onToggle={p.onTogglePlugin} />
      </div>
    </div>
  );
}
