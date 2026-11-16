// components/ThemePickerPanel.tsx — M316 建立 / M327 精简
// 分组折叠列表（AppCompat / Material2 / Material3 / 系统 / 对话框），每行一个迷你手机样张。
// 用户 2026-11-16 明确：样张不需要精致控件，只分辨「主题配色 / 有无标题栏 / 是否全屏」。

import { useState } from "react";
import {
  androidThemeGroups,
  argbToCss,
  inferPreviewFeatures,
  type AndroidThemePreset,
  type ThemeGroup,
} from "@/lib/xml/android-theme-presets";

interface Props {
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  /** 当前已选主题 id（高亮） */
  selectedId?: string;
  /** 选中回调：把预设写进 themes.xml */
  onPick: (preset: AndroidThemePreset) => void;
  /** M320：点「预览」→ 跳原生主题预览 Activity（仅 APK 端有；没传 = 不显示按钮） */
  onPreview?: (preset: AndroidThemePreset) => void;
  /** 是否正在应用 */
  busy?: boolean;
}

/** 迷你手机样张：只表达 3 件事 —— 配色、有无标题栏、是否全屏。
 *  · 有标题栏 → 顶部画一条主色状态/标题条；无 → 不画
 *  · 下方三个色块 = 主色 / 次色 / 文字色
 *  · 底部文字标注「有/无标题栏 · 全屏」 */
function Mockup({ p, tr }: { p: AndroidThemePreset; tr: Props["tr"] }) {
  const c = p.dark ?? p.light;
  const surface = argbToCss(c.surface);
  const onSurface = argbToCss(c.onSurface);
  const primary = argbToCss(c.primary);
  const onPrimary = argbToCss(c.onPrimary);
  const secondary = argbToCss(c.secondary);
  const f = inferPreviewFeatures(p);

  return (
    <div
      style={{
        width: 96,
        flex: "0 0 auto",
        borderRadius: 8,
        background: surface,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        border: "1px solid rgba(128,128,128,0.22)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 标题栏：有就画一条（主色），没有就空着 */}
      {!f.noActionBar ? (
        <div
          style={{
            height: 18,
            background: primary,
            display: "flex",
            alignItems: "center",
            paddingLeft: 5,
            flex: "0 0 auto",
          }}
        >
          <span style={{ fontSize: 9, color: onPrimary, opacity: 0.95 }}>
            {tr("标题栏", "Title")}
          </span>
        </div>
      ) : (
        <div style={{ height: 4, flex: "0 0 auto" }} />
      )}

      {/* 三个色块：主色 / 次色 / 文字色 */}
      <div style={{ display: "flex", gap: 4, padding: 7, flex: "0 0 auto" }}>
        <div style={{ flex: 1, height: 16, borderRadius: 3, background: primary, border: "1px solid rgba(0,0,0,0.10)" }} />
        <div style={{ flex: 1, height: 16, borderRadius: 3, background: secondary, border: "1px solid rgba(0,0,0,0.10)" }} />
        <div style={{ flex: 1, height: 16, borderRadius: 3, background: onSurface, opacity: 0.75, border: "1px solid rgba(0,0,0,0.10)" }} />
      </div>

      {/* 状态标签 */}
      <div
        style={{
          padding: "0 7px 7px",
          fontSize: 9,
          color: onSurface,
          opacity: 0.7,
          lineHeight: 1.35,
        }}
      >
        {f.noActionBar ? tr("无标题栏", "No title bar") : tr("有标题栏", "Has title bar")}
        {f.fullscreen ? " · " + tr("全屏", "Fullscreen") : ""}
      </div>
    </div>
  );
}

export function ThemePickerPanel({ tr, selectedId, onPick, onPreview, busy }: Props) {
  const [open, setOpen] = useState<Record<ThemeGroup, boolean>>({
    appcompat: true,
    material2: true,
    material3: true,
    system: false,
    dialog: false,
  });
  const groups = androidThemeGroups();

  return (
    <div className="axv-theme-panel">
      <div style={{ fontSize: 12, opacity: 0.7, margin: "2px 4px 10px", lineHeight: 1.5 }}>
        {tr("挑一个 Android 主题，写进项目的 themes.xml，预览与真机包都会用它。", "Pick an Android theme; it is written to your themes.xml and used by preview & on-device builds.")}
      </div>
      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 6 }}>
          <button
            type="button"
            className="axv-theme-group"
            onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))}
          >
            <span style={{ fontSize: 11 }}>{open[g.group] ? "▾" : "▸"}</span>
            <span style={{ fontWeight: 600, fontSize: 12 }}>{tr(g.label, g.label)}</span>
            <span style={{ opacity: 0.5, fontSize: 11, marginLeft: "auto" }}>{g.items.length}</span>
          </button>
          {open[g.group] && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
              {g.items.map((p) => {
                const active = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"axv-theme-row" + (active ? " on" : "")}
                    disabled={busy}
                    onClick={() => onPick(p)}
                  >
                    <Mockup p={p} tr={tr} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
                        {tr(p.name, p.name)}
                        {p.kind === "dialog" && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "#b26a00",
                              background: "rgba(255,193,7,0.18)",
                              borderRadius: 4,
                              padding: "1px 5px",
                              display: "inline-block",
                              fontWeight: 500,
                            }}
                            title={tr("对话框专用主题，不能套到整页 Activity", "Dialog-only theme; cannot be applied to a whole-Activity")}
                          >
                            {tr("对话框", "dialog")}
                          </span>
                        )}
                        {active && (
                          <span style={{ marginLeft: 6, color: "var(--axv-primary)", fontSize: 11 }}>
                            ✓ {tr("当前", "current")}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--axv-primary)",
                          background: "var(--axv-primary-soft, rgba(103,80,164,0.12))",
                          borderRadius: 4,
                          padding: "1px 6px",
                          display: "inline-block",
                          marginBottom: 4,
                          fontFamily: "ui-monospace, Consolas, monospace",
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        parent = {p.parent}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>{tr(p.note, p.note)}</div>
                      {onPreview && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPreview(p);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              onPreview(p);
                            }
                          }}
                          style={{
                            marginTop: 6,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 500,
                            color: "#fff",
                            background: "var(--axv-primary)",
                            borderRadius: 6,
                            padding: "3px 10px",
                            cursor: "pointer",
                            userSelect: "none",
                            border: "none",
                          }}
                        >
                          ▶ {tr("真预览", "Preview")}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
