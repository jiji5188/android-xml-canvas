// components/SettingsPanel.tsx — 「设置」面板（从 XmlEditor.tsx 抽出）
//
// 纯展示 + 回调：所有状态仍由 XmlEditor 持有，这里只负责画。
// 好处：设置项以后加一堆开关也不会再把主文件撑行数。

import { THEME_PRESETS, themeTokens, type ThemeMode } from "@/lib/xml/theme-presets";
import { RENDER_THEMES, type RenderTheme } from "@/lib/xml/theme";
import { LANG_OPTIONS, type LangPref } from "@/lib/i18n";
import type { WsInfo } from "@/lib/xml/workspace";
import {
  DEFAULT_EDITOR_THEME,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HL_PRESETS,
  INDENT_MAX,
  INDENT_MIN,
  type EditorTheme,
} from "@/lib/xml/editor-theme";

export interface SettingsPanelProps {
  tr: (key: string, fallback: string) => string;

  // 外观
  themePreset: string;
  onThemePreset: (id: string) => void;
  theme: ThemeMode;
  onTheme: (m: ThemeMode) => void;

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

  // 预览开关
  showSystemBars: boolean;
  onShowSystemBars: (v: boolean) => void;
  showIssues: boolean;
  onShowIssues: (v: boolean) => void;

  // M37：代码编辑器外观
  editorTheme: EditorTheme;
  onEditorTheme: (patch: Partial<EditorTheme>) => void;
  onResetEditorTheme: () => void;

  // 数据
  onSaveXml: () => void;
}

/** <input type="color"> 只收 #rrggbb；rgba()/transparent 一律给回退色 */
function toHex(v: string, fallback: string): string {
  const s = (v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return "#" + s.slice(1).split("").map((c) => c + c).join("");
  }
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (m) {
    const hex = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return fallback;
}

export function SettingsPanel(p: SettingsPanelProps) {
  const { tr } = p;
  return (
    <div className="axv-rail-scroll">
      {/* ===== 外观：预设配色方案 ===== */}
      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.theme", "配色方案")}</div>
        <div className="axv-theme-grid">
          {THEME_PRESETS.map((preset) => {
            const t = themeTokens(preset.id, p.theme);
            const on = preset.id === p.themePreset;
            return (
              <button
                key={preset.id}
                className={"axv-theme-card" + (on ? " on" : "")}
                onClick={() => p.onThemePreset(preset.id)}
                title={preset.note}
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
                {on ? (
                  <span className="msr axv-theme-check" aria-hidden="true">
                    check
                  </span>
                ) : null}
              </button>
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
          。配色只作用于编辑器界面，不影响导出的布局。
        </div>
      </div>

      {/* ===== M23：界面语言 ===== */}
      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.lang", "界面语言")}</div>
        <select
          className="axv-tb-select axv-lang-select"
          value={p.langPref}
          aria-label={tr("set.lang", "界面语言")}
          onChange={(e) => p.onLangPref(e.target.value as LangPref)}
        >
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === "auto" ? `${o.label}（${o.native}）` : o.label}
            </option>
          ))}
        </select>
        <div className="axv-set-hint">
          {tr("set.langHint", "默认跟随系统语言；切换只影响编辑器界面文字，不影响布局内容。")}
        </div>
      </div>

      {/* ===== 工作目录 ===== */}
      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.workspace", "工作目录")}</div>
        <div className="axv-set-kv">
          <span>当前</span>
          <b title={p.wsState?.label || ""}>
            {p.wsState?.mode === "native"
              ? p.wsState.label || "AndroidUIIDE/Project"
              : p.wsState?.mode === "unsupported"
                ? "不支持（请用 Chrome/Edge 或 APK）"
                : p.wsState?.custom
                  ? p.wsState.label
                  : "未授权目录"}
          </b>
        </div>
        {p.wsState?.defaultPath ? (
          <div className="axv-set-kv">
            <span>默认</span>
            <b className="axv-set-mono">{p.wsState.defaultPath}</b>
          </div>
        ) : null}
        <div className="axv-set-btns">
          <button className="axv-set-btn" onClick={p.onPickDir}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              folder_open
            </span>
            选择目录
          </button>
          <button className="axv-set-btn" onClick={p.onUseDefault}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              settings_backup_restore
            </span>
            恢复默认
          </button>
        </div>
        {p.wsState?.mode === "native" && p.wsState.allFiles === false ? (
          <button className="axv-set-btn" onClick={p.onRequestAllFiles}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
              shield
            </span>
            开启「所有文件访问」（默认目录在存储根下，必须开）
          </button>
        ) : null}
        <div className="axv-set-hint">
          默认目录：APK 下 <code>/AndroidUIIDE/Project</code>；网页版由你授权一个文件夹（授权会记住）。
          自定义目录失效时会自动回落到默认目录，两者都不会留空。
        </div>
      </div>

      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.device", "渲染设备")}</div>
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

      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.preview", "预览")}</div>
        <label className="axv-set-row">
          <span>显示系统状态栏 / 导航栏</span>
          <input
            type="checkbox"
            checked={p.showSystemBars}
            onChange={(e) => p.onShowSystemBars(e.target.checked)}
          />
        </label>
        <label className="axv-set-row">
          <span>控件提示（缺资源红框等）</span>
          <input
            type="checkbox"
            checked={p.showIssues}
            onChange={(e) => p.onShowIssues(e.target.checked)}
          />
        </label>
      </div>

      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.editor", "代码编辑器")}</div>

        <div className="axv-set-kv">
          <span>高亮风格</span>
        </div>
        <select
          className="axv-tb-select"
          aria-label="高亮风格"
          value={p.editorTheme.hl}
          onChange={(e) => p.onEditorTheme({ hl: e.target.value })}
        >
          {HL_PRESETS.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>

        <label className="axv-set-row">
          <span>光标颜色</span>
          <input
            className="axv-set-color"
            type="color"
            aria-label="光标颜色"
            value={toHex(p.editorTheme.cursor, DEFAULT_EDITOR_THEME.cursor)}
            onChange={(e) => p.onEditorTheme({ cursor: e.target.value })}
          />
        </label>

        <label className="axv-set-row">
          <span>选中背景色</span>
          <input
            className="axv-set-color"
            type="color"
            aria-label="选中背景色"
            value={toHex(p.editorTheme.selBg, "#04409f")}
            onChange={(e) => p.onEditorTheme({ selBg: e.target.value })}
          />
        </label>

        <label className="axv-set-row">
          <span>选中文字颜色</span>
          <input
            className="axv-set-color"
            type="color"
            aria-label="选中文字颜色"
            value={toHex(p.editorTheme.selFg, "#ffffff")}
            onChange={(e) => p.onEditorTheme({ selFg: e.target.value })}
          />
        </label>

        <label className="axv-set-row">
          <span>字号</span>
          <span className="axv-set-range">
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              aria-label="代码字号"
              value={p.editorTheme.fontSize}
              onChange={(e) => p.onEditorTheme({ fontSize: Number(e.target.value) })}
            />
            <b>{p.editorTheme.fontSize}px</b>
          </span>
        </label>

        <label className="axv-set-row">
          <span>缩进宽度</span>
          <span className="axv-set-range">
            <input
              type="range"
              min={INDENT_MIN}
              max={INDENT_MAX}
              step={1}
              aria-label="代码缩进宽度"
              value={p.editorTheme.indent}
              onChange={(e) => p.onEditorTheme({ indent: Number(e.target.value) })}
            />
            <b>{p.editorTheme.indent} 空格</b>
          </span>
        </label>

        <label className="axv-set-row">
          <span>高亮当前行</span>
          <input
            type="checkbox"
            checked={p.editorTheme.showCur}
            onChange={(e) => p.onEditorTheme({ showCur: e.target.checked })}
          />
        </label>

        <label className="axv-set-row">
          <span>当前行背景色</span>
          <input
            className="axv-set-color"
            type="color"
            aria-label="当前行背景色"
            disabled={!p.editorTheme.showCur}
            value={toHex(p.editorTheme.curBg, "#0b5fa5")}
            onChange={(e) => p.onEditorTheme({ curBg: e.target.value })}
          />
        </label>

        <button className="axv-set-btn" onClick={p.onResetEditorTheme}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            settings_backup_restore
          </span>
          恢复代码编辑器默认
        </button>
        <div className="axv-set-hint">
          只影响「代码」tab 的显示，不改号出的 XML。选中文字设为不透明背景时才完全盖住底层高亮字。
        </div>
      </div>

      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.data", "数据")}</div>
        <div className="axv-set-hint">
          布局、资源与生成的图标都自动存在本机浏览器（localStorage），关页面不丢。
        </div>
        <button className="axv-set-btn" onClick={p.onSaveXml}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            save
          </span>
          立即导出当前 XML
        </button>
        <button
          className="axv-set-btn axv-set-btn-danger"
          onClick={() => {
            if (!window.confirm("清空本机所有缓存（布局 / 资源 / 生成的图标 / 文件列表）？此操作不可撤销。")) return;
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
          清空本机缓存并重启
        </button>
      </div>
    </div>
  );
}
