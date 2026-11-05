"use client";
// components/UnsavedGuard.tsx — M141：子页面「有改动没保存」的统一提示
//
// 场景：drawable 编辑器、图标编辑器这些子页面的改动只在自己内部，返回键一按就没了。
// 这里把「脏了就拦一下」做成一个 hook + 一个对话框，避免每个页面各写一套 confirm。
//
// 用法：
//   const guard = useUnsavedGuard({ dirty, onSave: save, hint: tt("这个 drawable") });
//   <button onClick={() => guard.requestClose(close)}>返回</button>
//   {guard.dialog}

import { useState, type ReactNode } from "react";
import { t as tt } from "@/lib/i18n-src";

export interface UnsavedGuardOptions {
  dirty: boolean;
  /** 保存（保存成功后由调用方自己关页面；这里只负责触发） */
  onSave: () => void;
  /** 有校验错误时保存按钮置灰，避免「点了没反应还关掉」 */
  canSave?: boolean;
  /** 提示里指代的对象，如「这个 drawable」「这个图标」 */
  hint?: string;
}

export interface UnsavedGuard {
  /** 关页面前先过这里：不脏就直接关，脏了就弹提示 */
  requestClose: (close: () => void) => void;
  /** 待渲染的对话框（不脏时不渲染任何东西） */
  dialog: ReactNode;
  open: boolean;
}

export function useUnsavedGuard({ dirty, onSave, canSave = true, hint }: UnsavedGuardOptions): UnsavedGuard {
  const [pending, setPending] = useState<(() => void) | null>(null);

  const requestClose = (close: () => void) => {
    if (dirty) setPending(() => close);
    else close();
  };

  const finish = () => {
    const close = pending;
    setPending(null);
    close?.();
  };

  const dialog = pending ? (
    <div
      className="axv-modal-backdrop axv-unsaved-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) setPending(null);
      }}
    >
      <div className="axv-modal axv-unsaved" role="dialog" aria-modal="true" aria-label={tt("有未保存的修改")}>
        <div className="axv-modal-head">
          <span className="axv-modal-title">{tt("有未保存的修改")}</span>
        </div>
        <div className="axv-unsaved-body">
          {hint ? tt("「{what}」还没保存，直接返回会丢掉刚才的改动。", { what: hint }) : tt("直接返回会丢掉刚才的改动。")}
        </div>
        <div className="axv-unsaved-foot">
          <button type="button" className="axv-btn axv-ghost" onClick={() => setPending(null)}>
            {tt("取消")}
          </button>
          <button type="button" className="axv-btn axv-ghost axv-unsaved-drop" onClick={finish}>
            {tt("放弃修改")}
          </button>
          <button
            type="button"
            className="axv-btn axv-primary axv-unsaved-save"
            disabled={!canSave}
            onClick={() => {
              onSave();
              finish();
            }}
          >
            {tt("保存并返回")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { requestClose, dialog, open: pending !== null };
}
