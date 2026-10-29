// components/ExportCheckModal.tsx — 导出前检查面板（M2s）
// 替代 alert/confirm：把 lint 错误、语义提示分级列出来，让用户看清楚再决定导出。

"use client";

import type { LintIssue } from "@/lib/xml/lint";

export interface ExportReport {
  /** 结构错误（阻断） */
  errors: LintIssue[];
  /** 语义提示（可忽略继续） */
  notes: string[];
}

export type ExportMode = "modern" | "compat";

interface Props {
  open: boolean;
  report: ExportReport | null;
  /** 导出目标（下载 / 复制），用于文案 */
  action?: "download" | "copy";
  onClose: () => void;
  /** 有错误时是「仍然导出」，仅提示时是「知道了，导出」 */
  onConfirm: (() => void) | null;
  /** 点击错误行 → 跳到代码对应行 */
  onJumpLine?: (line: number) => void;
  /** M13：导出模式（现代写法 / 纯平台兼容） */
  mode?: ExportMode;
  onMode?: (m: ExportMode) => void;
  /** 兼容模式的转换摘要（切换时由外层重算） */
  compatNotes?: string[];
}

export function ExportCheckModal({ open, report, action = "download", onClose, onConfirm, onJumpLine, mode = "modern", onMode, compatNotes }: Props) {
  if (!open || !report) return null;
  const hasError = report.errors.length > 0;
  const verb = action === "copy" ? "复制" : "导出";

  return (
    <div
      className="axv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-modal axv-check-modal" role="dialog" aria-label="导出前检查">
        <div className="axv-modal-head">
          <span>{verb}前检查</span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="axv-check-body">
          {/* M13：导出模式选择——新版（androidx/Material）或纯平台兼容（AIDE 老 aapt 可编译） */}
          {onMode ? (
            <div className="axv-shape-field" style={{ marginBottom: 10 }}>
              <div className="axv-shape-seg" role="group" aria-label="导出模式">
                {([
                  { v: "modern", label: "新版写法" },
                  { v: "compat", label: "兼容模式" },
                ] as const).map((m) => (
                  <button
                    key={m.v}
                    type="button"
                    className={"axv-shape-seg-btn" + (mode === m.v ? " is-on" : "")}
                    onClick={() => onMode(m.v)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="axv-export-note" style={{ marginTop: 6 }}>
                {mode === "compat"
                  ? "兼容模式：ConstraintLayout → RelativeLayout，Material 控件降级为平台控件，去掉所有 app: 属性，老 aapt（AIDE）可直接编译。"
                  : "新版写法：保留 androidx / Material 控件与约束属性，需要工程里有对应依赖库。"}
              </div>
            </div>
          ) : null}

          {mode === "compat" && compatNotes?.length ? (
            <div className="axv-export-section">
              <div className="axv-export-title">兼容转换</div>
              <ul className="axv-export-list">
                {compatNotes.map((n, i) => (
                  <li key={i} className="is-ok">
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={"axv-export-summary" + (hasError ? " is-error" : report.notes.length ? " is-warn" : " is-ok")}>
            {hasError
              ? `✖ ${report.errors.length} 个结构错误，必须先修复才能${verb}`
              : report.notes.length
                ? `⚠ ${report.notes.length} 条提示，不影响${verb}但建议检查`
                : `✔ 检查通过，可以${verb}`}
          </div>

          {hasError && (
            <div className="axv-export-section">
              <div className="axv-export-title">结构错误</div>
              <ul className="axv-export-list">
                {report.errors.slice(0, 40).map((e, i) => (
                  <li key={i} className="is-error">
                    <button
                      className="axv-export-line"
                      onClick={() => onJumpLine?.(e.line)}
                      title="跳到这一行"
                    >
                      第 {e.line} 行
                    </button>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.notes.length > 0 && (
            <div className="axv-export-section">
              <div className="axv-export-title">提示</div>
              <ul className="axv-export-list">
                {report.notes.map((n, i) => (
                  <li key={i} className="is-warn">
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="axv-export-foot">
          <button className="axv-btn" onClick={onClose}>
            取消
          </button>
          {onConfirm ? (
            <button
              className={"axv-btn axv-btn-primary" + (hasError ? " axv-btn-danger" : "")}
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              {hasError ? `仍然${verb}` : `${verb}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
