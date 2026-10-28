"use client";

/**
 * M6c：工具栏「显示与设备」菜单
 *
 * 为什么单独抽出来：设备下拉 + 缩放滑条原来直接摆在工具栏里，宽度约 370px，
 * 桌面窄窗（两侧面板都开时只剩 ~600px）会把工具栏挤成两行、压住下面那排 tab。
 * 现在收成工具栏上的一个按钮 + 弹出面板，顺带解决「手机上媒体查询把 .axv-tb-zoom
 * 整个 display:none，导致手机上根本换不了设备」的问题。
 *
 * 面板必须走 createPortal 到 body：工具栏中段在手机上 `overflow-x: auto`，
 * 直接渲染会被裁切（而且 .axv-toolbar-v2 是 pointer-events:none 的定位层）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deviceById, deviceGroups } from "@/lib/xml/theme";

export type ViewSettingsMenuProps = {
  deviceId: string;
  onDevice: (id: string) => void;
  scale: number;
  onScale: (n: number) => void;
};

export function ViewSettingsMenu({ deviceId, onDevice, scale, onScale }: ViewSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const device = deviceById(deviceId);

  /** 面板定位：优先贴按钮下沿，右侧/下侧越界就回拉 */
  useLayoutEffect(() => {
    if (!open) return;
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const W = 260;
    const H = panelRef.current?.offsetHeight ?? 250;
    let left = b.right - W;
    let top = b.bottom + 8;
    if (left < 8) left = 8;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (top + H > window.innerHeight - 8) top = Math.max(8, b.top - H - 8);
    setPos({ left, top });
  }, [open]);

  /** 点外面 / Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className={"axv-tb-btn" + (open ? " is-on" : "")}
        title={`显示与设备 · ${device.label}`}
        aria-label="显示与设备"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>
          devices
        </span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="axv-vs-panel"
              role="dialog"
              aria-label="显示与设备"
              style={{ left: pos.left, top: pos.top }}
            >
              <div className="axv-vs-row">
                <label htmlFor="axv-vs-device">预览设备</label>
                <select
                  id="axv-vs-device"
                  value={deviceId}
                  onChange={(e) => onDevice(e.target.value)}
                  title={`${device.label}（${device.hint}）`}
                >
                  {deviceGroups().map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="axv-vs-hint">
                对应资源目录 <code>{device.hint || "layout/"}</code>
                {device.dpi ? <span> · {device.dpi}dpi</span> : null}
              </div>

              <div className="axv-vs-row">
                <label htmlFor="axv-vs-zoom">画布缩放</label>
                <div className="axv-vs-zoom">
                  <button
                    type="button"
                    onClick={() => onScale(Math.max(0.4, Math.round((scale - 0.1) * 10) / 10))}
                    aria-label="缩小"
                  >
                    −
                  </button>
                  <input
                    id="axv-vs-zoom"
                    type="range"
                    min={0.4}
                    max={1.5}
                    step={0.1}
                    value={scale}
                    onChange={(e) => onScale(parseFloat(e.target.value))}
                    aria-label="缩放"
                  />
                  <button
                    type="button"
                    onClick={() => onScale(Math.min(1.5, Math.round((scale + 0.1) * 10) / 10))}
                    aria-label="放大"
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div className="axv-vs-foot">
                <span>{scale.toFixed(2)}×</span>
                <button type="button" className="axv-vs-reset" onClick={() => onScale(1)}>
                  复位 100%
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
