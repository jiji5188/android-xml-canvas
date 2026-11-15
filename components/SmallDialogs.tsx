// components/SmallDialogs.tsx — M307：从 XmlEditor.tsx 抽出的两个纯展示小对话框
// SaveAsDialog（M21 新建文件保存前确认文件名）+ ConflictDialog（M201 文件被外部改过拦截）

"use client";

import { firstDiffLine } from "@/lib/xml/safe-write";
import { t as tt } from "@/lib/i18n-src";

/* =========================================================
 * M21：新建文件保存 → 先确认文件名，再选文件夹
 * ========================================================= */
export interface SaveAsDialogProps {
  open: boolean;
  name: string;
  tr: (key: string, fallback: string) => string;
  setName: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function SaveAsDialog({ open, name, tr, setName, onConfirm, onClose }: SaveAsDialogProps) {
  if (!open) return null;
  return (
    <div
      className="axv-saveas-mask"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-saveas-card">
        <div className="axv-saveas-title">{tr("save.title", "保存布局")}</div>
        <div className="axv-saveas-hint">
          {tr(
            "save.hint",
            tt("下一步会让你选择保存位置（系统选择器里可以新建文件夹）。生成的形状、图标等依赖资源会一起写进 drawable/，values 写进 values/。"),
          )}
        </div>
        <label className="axv-saveas-field">
          <span>{tr("save.fileName", "文件名")}</span>
          <input
            className="axv-saveas-input"
            value={name}
            autoFocus
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onClose();
            }}
          />
        </label>
        <div className="axv-saveas-btns">
          <button className="axv-set-btn" onClick={onClose}>
            {tr("save.cancel", "取消")}
          </button>
          <button className="axv-set-btn axv-saveas-ok" onClick={onConfirm}>
            {tr("save.confirm", "选择文件夹并保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
 * M201：文件被外部改过 → 写入前拦一道
 * ========================================================= */
export interface ConflictDialogProps {
  conflict:
    | {
        rel: string;
        disk: string;
        mine: string;
        retry: () => void;
        loadDisk?: () => void;
      }
    | null;
  onDismiss: () => void;
}

export function ConflictDialog({ conflict, onDismiss }: ConflictDialogProps) {
  if (!conflict) return null;
  return (
    <div
      className="axv-saveas-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className="axv-saveas-card"
        role="dialog"
        aria-modal="true"
        aria-label={tt("文件已被外部修改")}
      >
        <div className="axv-saveas-title">{tt("文件已被外部修改")}</div>
        <div className="axv-saveas-hint">
          {tt("磁盘上的内容和上次保存的不一样（可能是 Android Studio、git 或别的工具改过）。直接保存会把那些改动整段覆盖掉。")}
        </div>
        <code className="axv-conflict-path">{conflict.rel}</code>
        <div className="axv-saveas-subhint">
          {tt("从第 {n} 行开始不一致 · 磁盘 {a} 行 / 编辑器 {b} 行", {
            n: firstDiffLine(conflict.disk, conflict.mine),
            a: conflict.disk ? conflict.disk.split("\n").length : 0,
            b: conflict.mine ? conflict.mine.split("\n").length : 0,
          })}
        </div>
        <div className="axv-saveas-btns">
          <button className="axv-set-btn" onClick={onDismiss}>
            {tt("取消")}
          </button>
          <button
            className="axv-set-btn"
            onClick={() => {
              const c = conflict;
              onDismiss();
              c.loadDisk?.();
            }}
          >
            {tt("载入磁盘版本")}
          </button>
          <button
            className="axv-set-btn axv-saveas-ok"
            onClick={() => {
              const c = conflict;
              onDismiss();
              c.retry();
            }}
          >
            {tt("覆盖保存")}
          </button>
        </div>
      </div>
    </div>
  );
}
