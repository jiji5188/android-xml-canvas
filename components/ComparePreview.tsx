"use client";

// components/ComparePreview.tsx — M165 并排对比：同一份 XML 在多台设备上的渲染对比
//
// 一个覆盖层（createPortal 到 body），横向滚动放 N 台手机外壳。
// 每台外壳 = 状态栏 + 内容区（XmlCanvas，只读）+ 导航栏，按槽位等比缩放。
// 不做交互（点选 / 拖拽 / 几何编辑都在主画布做），只比「每台设备长什么样」。

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { t as tt } from "@/lib/i18n-src";
import { deviceById, STATUS_BAR_DP, NAV_BAR_DP } from "@/lib/xml/theme";
import { DEFAULT_RENDER_THEME, type RenderTheme } from "@/lib/xml/theme";
import { buildCompareModels, COMPARE_DEFAULTS, COMPARE_POOL, type CompareEntry } from "@/lib/xml/compare";
import type { ResourceTable, XmlNode } from "@/lib/xml/types";
import { XmlCanvas } from "./XmlCanvas";

const SCALE = 2; // 1dp = 2px，与主画布一致
const BORDER = 8; // 外壳描边 px

export interface ComparePreviewProps {
  open: boolean;
  onClose: () => void;
  root: XmlNode | null;
  resources: ResourceTable;
  layouts?: Record<string, string>;
  theme: RenderTheme;
  deviceIds: string[];
  onToggleDevice: (id: string, on: boolean) => void;
}

export function ComparePreview({
  open,
  onClose,
  root,
  resources,
  layouts,
  theme,
  deviceIds,
  onToggleDevice,
}: ComparePreviewProps) {
  const entries = useMemo(
    () =>
      root
        ? buildCompareModels(root, resources, layouts, theme, deviceIds, SCALE)
        : [],
    [root, resources, layouts, theme, deviceIds],
  );

  if (!open) return null;

  return createPortal(
    <div className="axv-cmp-overlay" role="dialog" aria-label={tt("并排对比")}>
      <div className="axv-cmp-head">
        <strong>{tt("并排对比")} · {tt("同一份布局，各设备实际效果")}</strong>
        <div className="axv-cmp-pool">
          {COMPARE_POOL.map((id) => {
            const d = deviceById(id);
            const on = deviceIds.includes(id);
            return (
              <label key={id} className={"axv-cmp-pool-item" + (on ? " is-on" : "")}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onToggleDevice(id, e.target.checked)}
                />
                {d.label}
              </label>
            );
          })}
        </div>
        <button className="axv-cmp-close" onClick={onClose} aria-label={tt("关闭")}>
          ×
        </button>
      </div>
      <div className="axv-cmp-body">
        {entries.length === 0 ? (
          <div className="axv-cmp-empty">{tt("当前文件不是布局，没有可对比的内容")}</div>
        ) : (
          entries.map((e) => (
            <ComparePhone key={e.device.id} entry={e} />
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

function ComparePhone({ entry }: { entry: CompareEntry }) {
  const { device, model, err } = entry;
  // 槽位：外壳按 340px 宽摆，高度按设备比例；太高的设备限高
  const slotW = 340;
  const phoneW = device.w * SCALE + BORDER * 2;
  const phoneH = device.h * SCALE + BORDER * 2;
  const fit = Math.min(slotW / phoneW, 460 / phoneH, 1);
  const bodyH = (device.h - STATUS_BAR_DP - NAV_BAR_DP) * SCALE;

  return (
    <div className="axv-cmp-col">
      <div className="axv-cmp-col-label">
        {device.label} · {device.w}×{device.h}dp
        {device.dpi ? ` · ${device.dpi}dpi` : ""}
      </div>
      {err ? (
        <div className="axv-cmp-err">
          {tt("渲染失败：")}
          {err}
        </div>
      ) : !model ? (
        <div className="axv-cmp-err">{tt("无法解析这个布局")}</div>
      ) : (
        <div
          className="axv-cmp-phone"
          style={{
            width: phoneW * fit,
            height: phoneH * fit,
          }}
        >
          <div
            style={{
              width: phoneW,
              height: phoneH,
              transform: `scale(${fit})`,
              transformOrigin: "top left",
              border: `${BORDER}px solid #222`,
              borderRadius: (device.radius ?? 0) * SCALE,
              background: "#fff",
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                height: STATUS_BAR_DP * SCALE,
                background: "#000",
                color: "#fff",
                fontSize: 12 * SCALE,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: `0 ${8 * SCALE}px`,
              }}
            >
              <span>9:41</span>
              <span>5G ▂▃▅ · 100%</span>
            </div>
            <div style={{ height: bodyH, overflow: "hidden", background: "#fff" }}>
              <XmlCanvas
                node={model.root}
                selectedPath={null}
                onSelect={() => {}}
                scale={SCALE}
              />
            </div>
            <div
              style={{
                height: NAV_BAR_DP * SCALE,
                background: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 24,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 99 }} />
              <span style={{ width: 14, height: 14, borderRadius: 99, border: "2px solid #fff" }} />
              <span style={{ width: 10, height: 10 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { COMPARE_DEFAULTS };
