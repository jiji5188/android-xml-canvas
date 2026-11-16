// components/ThemePickerPanel.tsx — M316：Android 主题选择页
// 分组折叠列表（AppCompat / Material2 / Material3 / 系统），每行一个迷你手机样张
// （用预设调色板画 按钮/卡片/开关/进度条/文字层级），点选写进 themes.xml。

import { useState } from "react";
import {
  androidThemeGroups,
  argbToCss,
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

/** 用一个调色板画迷你样张（按钮/卡片/开关/进度条/文字） */
function Mockup({ p, tr }: { p: AndroidThemePreset; tr: Props["tr"] }) {
  // 预设带了 dark 调色板（多为深色主题）就用 dark 画样张，否则用 light
  const c = p.dark ?? p.light;
  // Android 调色板是 #AARRGGBB，必须转成 CSS 颜色（否则被当 #RRGGBBAA 渲染成错色）
  const surface = argbToCss(c.surface);
  const onSurface = argbToCss(c.onSurface);
  const primary = argbToCss(c.primary);
  const onPrimary = argbToCss(c.onPrimary);
  const secondary = argbToCss(c.secondary);
  const btnRadius = p.group === "material3" ? "50%" : "4px";
  return (
    <div
      style={{
        width: 116,
        flex: "0 0 auto",
        borderRadius: 10,
        background: surface,
        color: onSurface,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
      }}
    >
      {/* 标题文字层级 */}
      <div style={{ fontSize: 13, fontWeight: 600, color: onSurface }}>
        <span style={{ opacity: 0.55, fontSize: 10 }}>{tr("预览样张", "Preview")}</span>
      </div>
      {/* 主按钮 */}
      <div
        style={{
          background: primary,
          color: onPrimary,
          borderRadius: btnRadius,
          textAlign: "center",
          fontSize: 11,
          fontWeight: 500,
          padding: "6px 0",
        }}
      >
        {tr("主按钮", "Button")}
      </div>
      {/* 卡片 */}
      <div
        style={{
          background: "rgba(128,128,128,0.16)",
          color: onSurface,
          borderRadius: p.group === "material3" ? 12 : 6,
          padding: "6px 8px",
          fontSize: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{tr("卡片", "Card")}</span>
        <span
          style={{
            background: secondary,
            color: onPrimary,
            borderRadius: "50%",
            width: 16,
            height: 16,
            display: "inline-block",
          }}
        />
      </div>
      {/* 开关 + 进度条 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10 }}>{tr("开关", "Switch")}</span>
        <span
          style={{
            width: 30,
            height: 14,
            borderRadius: 8,
            background: primary,
            position: "relative",
            display: "inline-block",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 1,
              right: 1,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#fff",
            }}
          />
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: "rgba(128,128,128,0.24)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: "60%",
            background: primary,
            borderRadius: 3,
          }}
        />
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
