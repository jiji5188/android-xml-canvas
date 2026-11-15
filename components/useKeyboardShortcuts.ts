// components/useKeyboardShortcuts.ts — M306：从 XmlEditor.tsx 抽出的键盘快捷键域
// Ctrl/⌘ + Z/Y/S/F（全局）+ C/V/D/G（画布，输入框里不拦）

"use client";

import { useEffect } from "react";

export interface UseKeyboardShortcutsOptions {
  undo: () => void;
  redo: () => void;
  save: () => void;
  format: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  group: () => void;
  ungroup: () => void;
  /** 当前是否有选中（没有就不拦 C/V/D，留给浏览器） */
  selectedPath: string | null;
}

export function useKeyboardShortcuts(
  getOpts: () => UseKeyboardShortcutsOptions,
) {
  // 用 getter 延迟取值：effect 执行时（渲染后）才读这些 useCallback，避开调用点 TDZ。
  useEffect(() => {
    const { undo, redo, save, format, copy, paste, duplicate, group, ungroup, selectedPath } =
      getOpts();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // M115：在输入框 / 代码编辑器里不接 C V D G（那里要能正常复制粘贴文本）
      const t = e.target as HTMLElement | null;
      const inEditing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          !!t.closest?.(".cm-editor"));
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        save();
      } else if (k === "f") {
        e.preventDefault();
        format();
      } else if (!inEditing && k === "c") {
        // M115：复制选中的控件（没选中就不拦，留给浏览器）
        if (!selectedPath) return;
        e.preventDefault();
        copy();
      } else if (!inEditing && k === "v") {
        if (!selectedPath) return;
        e.preventDefault();
        paste();
      } else if (!inEditing && k === "d") {
        if (!selectedPath) return;
        e.preventDefault();
        duplicate();
      } else if (!inEditing && k === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroup();
        else group();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
