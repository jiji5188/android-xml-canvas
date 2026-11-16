// components/ThemePickerPanel.tsx — M316：Android 主题选择页
// 分组折叠列表（AppCompat / Material2 / Material3 / 系统），每行一个迷你手机样张
// （用预设调色板画 按钮/卡片/开关/进度条/文字层级），点选写进 themes.xml。

import { useState, type CSSProperties } from "react";
import {
  androidThemeGroups,
  argbToCss,
  themeFamily,
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

/** 主题家族：决定了样张要复刻哪一代 Android 控件形态 */
type Family = "appcompat" | "material2" | "material3" | "holo" | "device";

function familyOf(p: AndroidThemePreset): Family {
  return themeFamily(p);
}

/** #AARRGGBB 判深浅（取后 6 位算亮度） */
function isDarkArgb(argb: string): boolean {
  const h = argb.replace(/^#/, "");
  const s = h.length === 8 ? h.slice(2) : h;
  const r = parseInt(s.slice(0, 2), 16) || 0;
  const g = parseInt(s.slice(2, 4), 16) || 0;
  const b = parseInt(s.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

interface Tok {
  /** 按钮圆角 px（M3 胶囊=14 / M2 4dp / M1 2dp / Holo 2dp） */
  btnRadius: number;
  /** 按钮文字是否全大写（Material 1/2、Holo 全大写；M3 不是） */
  upper: boolean;
  btnShadow: string;
  btnGradient?: string;
  btnBorder?: string;
  btnText?: string;
  cardRadius: number;
  cardShadow: string;
  cardBorder?: string;
  cardBg: string;
  swW: number;
  swH: number;
  swThumb: number;
  swCheck: boolean;
  barH: number;
  barRadius: number;
  titleSize: number;
}

/** 各代 Android 的真实控件外观（尺寸/圆角/阴影/大小写都按官方设计规范来） */
const TOKENS: Record<Family, Tok> = {
  // Material 1（AppCompat）：2dp 圆角、全大写、2dp 投影、记忆淡染色轨道
  appcompat: {
    btnRadius: 2, upper: true, btnShadow: "0 1px 3px rgba(0,0,0,0.30)",
    cardRadius: 2, cardShadow: "0 1px 3px rgba(0,0,0,0.22)", cardBg: "rgba(128,128,128,0.10)",
    swW: 30, swH: 14, swThumb: 12, swCheck: false, barH: 4, barRadius: 0, titleSize: 13,
  },
  // Material 2：4dp 圆角、全大写、更高投影
  material2: {
    btnRadius: 4, upper: true, btnShadow: "0 2px 3px rgba(0,0,0,0.24)",
    cardRadius: 4, cardShadow: "0 2px 5px rgba(0,0,0,0.18)", cardBg: "rgba(128,128,128,0.10)",
    swW: 30, swH: 14, swThumb: 12, swCheck: false, barH: 4, barRadius: 2, titleSize: 13,
  },
  // Material 3：胶囊按钮、不大写、无投影、卡片大圆角+描边、开关变大带勾、进度条圆头
  material3: {
    btnRadius: 14, upper: false, btnShadow: "none",
    cardRadius: 12, cardShadow: "none", cardBorder: "1px solid rgba(128,128,128,0.26)",
    cardBg: "rgba(128,128,128,0.14)",
    swW: 34, swH: 14, swThumb: 18, swCheck: true, barH: 4, barRadius: 2, titleSize: 14,
  },
  // Holo：灰色渐变方角按钮 + 1px 边框 + 深色字、卡片直角带边框、细进度条
  holo: {
    btnRadius: 2, upper: true, btnShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
    btnGradient: "linear-gradient(#f7f7f7,#dcdcdc)", btnBorder: "1px solid #9a9a9a", btnText: "#222",
    cardRadius: 0, cardShadow: "none", cardBorder: "1px solid #cfcfcf", cardBg: "#f7f7f7",
    swW: 36, swH: 14, swThumb: 12, swCheck: false, barH: 3, barRadius: 0, titleSize: 12,
  },
  // 厂商默认（DeviceDefault）：介于 M2 与现代之间
  device: {
    btnRadius: 4, upper: true, btnShadow: "0 2px 3px rgba(0,0,0,0.25)",
    cardRadius: 4, cardShadow: "0 1px 4px rgba(0,0,0,0.20)", cardBg: "rgba(128,128,128,0.10)",
    swW: 32, swH: 14, swThumb: 12, swCheck: false, barH: 4, barRadius: 2, titleSize: 13,
  },
};

/** 用一个调色板画迷你样张，外观按主题家族复刻真正的 Android 控件样式 */
function Mockup({ p, tr }: { p: AndroidThemePreset; tr: Props["tr"] }) {
  const c = p.dark ?? p.light;
  // Android 调色板是 #AARRGGBB，必须转成 CSS 颜色（否则被当 #RRGGBBAA 渲染成错色）
  const surface = argbToCss(c.surface);
  const onSurface = argbToCss(c.onSurface);
  const primary = argbToCss(c.primary);
  const onPrimary = argbToCss(c.onPrimary);
  const secondary = argbToCss(c.secondary);
  const fam = familyOf(p);
  const t = TOKENS[fam];
  const dark = isDarkArgb(c.surface);

  // Holo 的按钮是灰渐变（不跟主色），深色版单独给一套
  const holoBtnBg = dark ? "linear-gradient(#3d3d3d,#2b2b2b)" : t.btnGradient;
  const holoBtnBorder = dark ? "1px solid #5a5a5a" : t.btnBorder;
  const holoBtnText = dark ? "#e8e8e8" : t.btnText;
  const holoCardBg = dark ? "#1f1f1f" : t.cardBg;
  const holoCardBorder = dark ? "1px solid #3a3a3a" : t.cardBorder;

  const btnStyle: CSSProperties = {
    background: fam === "holo" ? holoBtnBg : primary,
    color: fam === "holo" ? holoBtnText : onPrimary,
    borderRadius: t.btnRadius,
    border: fam === "holo" ? holoBtnBorder : undefined,
    boxShadow: t.btnShadow,
    textAlign: "center",
    fontSize: 10.5,
    fontWeight: fam === "holo" ? 700 : 500,
    letterSpacing: t.upper ? "0.4px" : "0.1px",
    textTransform: t.upper ? "uppercase" : "none",
    padding: fam === "material3" ? "7px 0" : "5px 0",
  };

  return (
    <div
      style={{
        width: 116,
        flex: "0 0 auto",
        borderRadius: fam === "holo" ? 2 : 10,
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
      <div style={{ fontSize: t.titleSize, fontWeight: fam === "material3" ? 500 : 600, color: onSurface }}>
        <span style={{ opacity: 0.55, fontSize: 10, textTransform: "none" }}>{tr("预览样张", "Preview")}</span>
      </div>
      {/* 主按钮 */}
      <div style={btnStyle}>{tr("主按钮", "Button")}</div>
      {/* 卡片 */}
      <div
        style={{
          background: fam === "holo" ? holoCardBg : t.cardBg,
          color: onSurface,
          border: fam === "holo" ? holoCardBorder : t.cardBorder,
          borderRadius: t.cardRadius,
          boxShadow: t.cardShadow,
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
            borderRadius: "50%",
            width: 14,
            height: 14,
            display: "inline-block",
          }}
        />
      </div>
      {/* 开关 + 进度条 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10 }}>{tr("开关", "Switch")}</span>
        <span
          style={{
            width: t.swW,
            height: t.swH,
            borderRadius: t.swH / 2,
            background: fam === "material3" ? primary : `${primary}`,
            opacity: 1,
            position: "relative",
            display: "inline-block",
            boxShadow: fam === "material3" ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.12)",
            border: fam === "material3" ? `1px solid ${primary}` : undefined,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: (t.swH - t.swThumb) / 2,
              right: 1,
              width: t.swThumb,
              height: t.swThumb,
              borderRadius: "50%",
              background: fam === "material3" ? onPrimary : "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              lineHeight: 1,
              color: primary,
            }}
          >
            {t.swCheck ? "\u2713" : ""}
          </span>
        </span>
      </div>
      <div
        style={{
          height: t.barH,
          borderRadius: t.barRadius,
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
            borderRadius: t.barRadius,
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
