"use client";

// components/ExportImageModal.tsx — M6a 导出预览图（PNG / SVG）
// 纯前端：把手机壳 DOM 交给 html-to-image 序列化，不需要服务端渲染。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  downloadUrl,
  exportFileName,
  renderPng,
  renderSvg,
  type ExportKind,
  type ExportRatio,
  type ExportTarget,
} from "@/lib/xml/export-image";
import { renderVectorSvg } from "@/lib/xml/export-svg";

interface Props {
  /** 取导出目标（点击时再取，避免 DOM 还没挂上） */
  getTarget: () => ExportTarget | null;
  /** 设备名（进文件名） */
  deviceLabel: string;
  /** 目标尺寸（CSS px）——只用于显示 */
  width: number;
  height: number;
  onClose: () => void;
  /** 失败/成功提示 */
  onToast?: (msg: string) => void;
}

const RATIOS: { v: ExportRatio; label: string; hint: string }[] = [
  { v: 1, label: "1x", hint: "逻辑像素，体积最小" },
  { v: 2, label: "2x", hint: "适合分享/文档（推荐）" },
  { v: 3, label: "3x", hint: "高清，文件偏大" },
];

export function ExportImageModal({ getTarget, deviceLabel, width, height, onClose, onToast }: Props) {
  const [ratio, setRatio] = useState<ExportRatio>(2);
  const [busy, setBusy] = useState<"png" | "svg" | "svgv" | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, busy]);

  const doExport = async (kind: "png" | "svg" | "svgv") => {
    if (busy) return;
    const target = getTarget();
    if (!target || !target.el) {
      setErr("预览还没渲染出来，稍后再试");
      return;
    }
    setErr("");
    setBusy(kind);
    try {
      if (kind === "svgv") {
        const url = await renderVectorSvg({
          el: target.el,
          width: target.width,
          height: target.height,
          background: target.background,
        });
        downloadUrl(exportFileName("svg", deviceLabel, ratio).replace(/\.svg$/, "-vector.svg"), url);
        onToast?.(`已导出矢量 SVG（${Math.round(width)}×${Math.round(height)} px）`);
        onClose();
        return;
      }
      const url = kind === "png" ? await renderPng(target, ratio) : await renderSvg(target);
      downloadUrl(exportFileName(kind, deviceLabel, ratio), url);
      const px = kind === "png" ? `${Math.round(width * ratio)}×${Math.round(height * ratio)} px` : `${Math.round(width)}×${Math.round(height)} px`;
      onToast?.(`已导出 ${kind.toUpperCase()}（${px}）`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr("导出失败：" + msg);
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <div className="axv-modal-backdrop" onClick={() => (busy ? undefined : onClose())}>
      <div className="axv-modal axv-export-modal" role="dialog" aria-label="导出预览图" onClick={(e) => e.stopPropagation()}>
        <div className="axv-modal-head">
          <span>导出预览图</span>
          <button className="axv-icon-btn" onClick={onClose} disabled={!!busy} aria-label="关闭">
            <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>
              close
            </span>
          </button>
        </div>

        <div className="axv-export-body">
          <div className="axv-export-meta">
            <span className="msr" aria-hidden="true">
              smartphone
            </span>
            <span>
              {deviceLabel} · {Math.round(width)}×{Math.round(height)} px
              {ratio !== 1 ? ` → ${Math.round(width * ratio)}×${Math.round(height * ratio)} px` : ""}
            </span>
          </div>

          <div className="axv-shape-field">
            <label>倍率（仅 PNG）</label>
            <div className="axv-shape-seg">
              {RATIOS.map((r) => (
                <button
                  key={r.v}
                  className={"axv-shape-seg-btn" + (ratio === r.v ? " is-on" : "")}
                  title={r.hint}
                  disabled={!!busy}
                  onClick={() => setRatio(r.v)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="axv-export-note">
            导出的是当前画布（含状态栏 / 导航栏，不含选中虚线框等编辑装饰）。
            SVG 内含 foreignObject 外壳，浏览器与 Figma 可正常打开；矢量 SVG 是原生图元（rect/text/path），
            可在 Illustrator / Inkscape 里编辑，但图标字体会依赖本机字体。
          </div>

          {err ? <div className="axv-export-err">{err}</div> : null}

          <div className="axv-export-actions">
            <button className="axv-btn axv-btn-primary" disabled={!!busy} onClick={() => doExport("png")}>
              {busy === "png" ? "导出中…" : "下载 PNG"}
            </button>
            <button className="axv-btn" disabled={!!busy} onClick={() => doExport("svg")}>
              {busy === "svg" ? "导出中…" : "下载 SVG"}
            </button>
            <button className="axv-btn" disabled={!!busy} onClick={() => doExport("svgv")} title="原生矢量图元，可在设计工具里逐层编辑">
              {busy === "svgv" ? "导出中…" : "矢量 SVG"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
