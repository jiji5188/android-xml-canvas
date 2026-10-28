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
}

export function ExportCheckModal({ open, report, action = "download", onClose, onConfirm, onJumpLine }: Props) {
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
