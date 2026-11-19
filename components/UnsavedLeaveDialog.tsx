"use client";
// components/UnsavedLeaveDialog.tsx — M141：「有未保存的内容」统一提示（全局离开场景用）
//
// 和 UnsavedGuard 的区别：那个是「关子页面」，这里是「切文件 / 打开新文件 / 关窗口」
// 全局级的拦截。按钮是 保存并继续 / 不保存继续 / 取消。

import { useState, useEffect, type ReactNode } from "react";
import { t as tt } from "@/lib/i18n-src";

export interface UnsavedLeaveOptions {
  title?: string;
  onSave: () => void;
  onDiscard: () => void;
  /** M412：当前文档是否脏（getter 避免闭包 stale）。传了才拦 beforeunload */
  isDirty?: () => boolean;
}

export interface UnsavedLeave {
  /** 要切换/离开时先走这里；不脏直接执行 action，脏了就拦下弹提示 */
  gate: (dirty: boolean, action: () => void) => void;
  dialog: ReactNode;
  open: boolean;
}

export function useUnsavedLeave(opts: UnsavedLeaveOptions): UnsavedLeave {
  const [pending, setPending] = useState<(() => void) | null>(null);

  // M412：关窗口 / 切后台拦截下沉到这里（原在 XmlEditor 里 11 行）。
  // 浏览器原生 beforeunload 只能弹默认框，但必须拦，不然丢文档。
  useEffect(() => {
    if (!opts.isDirty) return;
    const checkDirty = opts.isDirty;
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!checkDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [opts.isDirty]);

  const gate = (dirty: boolean, action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };

  const dialog = pending ? (
    <div className="axv-modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && setPending(null)}>
      <div className="axv-modal axv-unsaved" role="dialog" aria-modal="true" aria-label={tt("有未保存的内容")}>
        <div className="axv-modal-head">
          <span className="axv-modal-title">{opts.title ?? tt("有未保存的内容")}</span>
        </div>
        <div className="axv-unsaved-body">{tt("当前内容还没有保存。要先保存吗？")}</div>
        <div className="axv-unsaved-foot">
          <button type="button" className="axv-btn axv-ghost" onClick={() => setPending(null)}>
            {tt("取消")}
          </button>
          <button
            type="button"
            className="axv-btn axv-ghost axv-unsaved-drop"
            onClick={() => {
              opts.onDiscard();
              const a = pending;
              setPending(null);
              a?.();
            }}
          >
            {tt("不保存")}
          </button>
          <button
            type="button"
            className="axv-btn axv-btn-primary"
            onClick={() => {
              void opts.onSave();
              const a = pending;
              setPending(null);
              a?.();
            }}
          >
            {tt("保存并继续")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { gate, dialog, open: pending !== null };
}
