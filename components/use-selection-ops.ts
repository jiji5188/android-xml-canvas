// components/use-selection-ops.ts — M366 step10（路线 2 拆解）：画布多选/剪贴板操作域（M115）
//
// 从 XmlEditor.tsx 抽出（原 ~2117-2343 区域）：selPaths + selectPath / validSelPaths /
// copySelection / pasteSelection / duplicateSelection / groupSelection / ungroupSelection /
// deleteSelection。
//
// deps-getter + 延迟 Proxy（与 use-xml-project-fns.ts 同款）：onRemoveNode / setXmlAndTrack /
// flashNote 等声明位置可能晚于本 hook 调用点，渲染期不 evaluate getter。
// 键盘快捷键（useKeyboardShortcuts）在 useEffect 里才调 getter，无需改位置。
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { splitPath } from "@/lib/xml/paths";
import {
  collectSnippets,
  deletePaths as deletePathsText,
  insertSnippetsAt,
  normalizePaths,
  renameDuplicateIds,
  snippetsToText,
  splitSnippets,
  unwrapElement,
  wrapSiblings,
  canUnwrap,
} from "@/lib/xml/clip";
import { scanElements, elementAt } from "@/lib/xml/reorder";
import { t as tt } from "@/lib/i18n-src";

export interface SelectionOpsDeps {
  selectedPath: string | null;
  setSelectedPath: React.Dispatch<React.SetStateAction<string | null>>;
  selExtra: string[];
  setSelExtra: React.Dispatch<React.SetStateAction<string[]>>;
  xml: string;
  clipRef: React.MutableRefObject<string>;
  flashNote: (msg: string, ms?: number) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  currentXml: () => string;
  /** 原单删路径（<2 个选中时保留其状态/历史行为） */
  onRemoveNode: (path: string) => void;
}

export interface SelectionOps {
  selPaths: string[];
  selectPath: (p: string | null, additive?: boolean) => void;
  validSelPaths: () => string[];
  copySelection: () => number;
  pasteSelection: () => number;
  duplicateSelection: () => number;
  groupSelection: () => string | null;
  ungroupSelection: () => string[];
  deleteSelection: () => number;
}

export function useSelectionOps(getDeps: () => SelectionOpsDeps): SelectionOps {
  // 延迟 Proxy：渲染期不 evaluate（避 TDZ），回调执行时才解引用（拿最新值）
  const depsRef = useRef<SelectionOpsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as SelectionOpsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const selPaths = useMemo(() => {
    if (!D.selectedPath) return D.selExtra.length ? D.selExtra : [];
    return normalizePaths([D.selectedPath, ...D.selExtra]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D.selectedPath, D.selExtra]);

  /** M115：单选 / 追加多选。additive = Ctrl/⌘/Shift 按住 */
  const selectPath = useCallback(
    (p: string | null, additive = false) => {
      if (!p) {
        D.setSelectedPath(null);
        D.setSelExtra([]);
        return;
      }
      if (p === "#0") {
        D.setSelectedPath(p);
        D.setSelExtra([]);
        return;
      }
      if (!additive) {
        D.setSelectedPath(p);
        D.setSelExtra([]);
        return;
      }
      // 追加模式：已包含且不止一个 → 取消该节点；否则加入
      D.setSelExtra((prev) => {
        const all = D.selectedPath ? [D.selectedPath, ...prev] : [...prev];
        if (all.length > 1 && all.includes(p)) {
          D.setSelectedPath(all.filter((x) => x !== p)[0] ?? null);
          return all.filter((x) => x !== p);
        }
        return [...prev, p];
      });
      if (D.selectedPath) D.setSelectedPath(D.selectedPath);
      else D.setSelectedPath(p);
    },
    [D],
  );

  /** 取一份「路径仍然有效」的多选集合（文档变过之后可能失效） */
  const validSelPaths = useCallback((): string[] => {
    if (!selPaths.length) return [];
    const root = scanElements(D.xml);
    if (!root) return [];
    return selPaths.filter((p) => elementAt(root, p) !== null);
  }, [selPaths, D]);

  /** M115：复制当前多选到内部剪贴板 + 系统剪贴板 */
  const copySelection = useCallback((): number => {
    const paths = validSelPaths();
    if (!paths.length) return 0;
    const text = snippetsToText(collectSnippets(D.xml, paths));
    D.clipRef.current = text;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    D.flashNote(tt("已复制 {n} 个控件", { n: paths.length }), 2200);
    return paths.length;
  }, [validSelPaths, D]);

  /** M115：把内部剪贴板（或系统剪贴板里的 XML）粘贴到主选节点之后 */
  const pasteSelection = useCallback((): number => {
    const paths = validSelPaths();
    const anchor = D.selectedPath ?? paths[0];
    if (!anchor) {
      D.flashNote(tt("先选中一个控件再粘贴"), 3000);
      return 0;
    }
    const { parentPath, index } = splitPath(anchor);
    // 粘贴目标：最后一个选中项之后（单选时就是主选之后）
    const lastIdx = paths.length ? splitPath(paths[paths.length - 1]).index : index;
    const targetIndex = lastIdx + 1;

    const place = (text: string, from: string): number => {
      const parts = splitSnippets(text);
      if (!parts.length) {
        D.flashNote(from === "sys" ? tt("剪贴板里没有可粘贴的控件 XML") : tt("内部剪贴板已失效，请重新复制"), 3200);
        return 0;
      }
      const base = D.currentXml();
      const renamed = parts.map((p) => renameDuplicateIds(base, p));
      const r = insertSnippetsAt(base, parentPath, targetIndex, renamed);
      if (!r.ok) {
        D.flashNote(r.reason ?? tt("粘贴失败"), 3600);
        return 0;
      }
      D.setXmlAndTrack(r.xml);
      D.setSelectedPath(r.firstPath);
      D.setSelExtra([]);
      D.flashNote(
        from === "sys" ? tt("已粘贴（来自系统剪贴板）") : tt("已粘贴 {n} 个控件", { n: r.count }),
        2400,
      );
      return r.count;
    };

    const snippet = D.clipRef.current;
    if (snippet.trim()) return place(snippet, "inner");
    // 没有内部剪贴板：试读系统剪贴板（异步，只看不像 XML 就提示）
    void navigator.clipboard
      ?.readText?.()
      .then((text) => {
        if (text && /<\w[^>]*>/.test(text)) place(text, "sys");
        else D.flashNote(tt("剪贴板里没有可粘贴的控件 XML"), 3200);
      })
      .catch(() => D.flashNote(tt("读不到系统剪贴板，请先在本应用里复制一次"), 3600));
    return 0;
  }, [validSelPaths, D]);

  /** M115：Ctrl+D 式「就地复制」= 复制 + 紧跟原位置粘贴 */
  const duplicateSelection = useCallback((): number => {
    const paths = validSelPaths();
    if (paths.length === 1) {
      const text = snippetsToText(collectSnippets(D.xml, paths));
      D.clipRef.current = text;
      const { parentPath, index } = splitPath(paths[0]);
      const r = insertSnippetsAt(D.xml, parentPath, index + 1, [renameDuplicateIds(D.xml, text)]);
      if (!r.ok) {
        D.flashNote(r.reason ?? tt("无法复制"), 3600);
        return 0;
      }
      D.setXmlAndTrack(r.xml);
      D.setSelectedPath(r.firstPath);
      D.setSelExtra([]);
      D.flashNote(tt("已复制 1 个控件"), 2200);
      return 1;
    }
    if (!paths.length) return 0;
    const text = snippetsToText(collectSnippets(D.xml, paths));
    D.clipRef.current = text;
    const { parentPath } = splitPath(paths[paths.length - 1]);
    const idxs = paths.map((p) => splitPath(p).index).sort((a, b) => a - b);
    const r = insertSnippetsAt(D.xml, parentPath, idxs[idxs.length - 1] + 1, [renameDuplicateIds(D.xml, text)]);
    if (!r.ok) {
      D.flashNote(r.reason ?? tt("无法复制"), 3600);
      return 0;
    }
    D.setXmlAndTrack(r.xml);
    D.setSelectedPath(r.firstPath);
    D.setSelExtra([]);
    D.flashNote(tt("已复制 {n} 个控件", { n: paths.length }), 2200);
    return paths.length;
  }, [validSelPaths, D]);

  /** M115：Ctrl+G 成组（多选相邻兄弟） */
  const groupSelection = useCallback((): string | null => {
    const paths = validSelPaths();
    if (paths.length < 2) {
      D.flashNote(tt("至少选中两个控件才能成组"), 3200);
      return null;
    }
    const r = wrapSiblings(D.xml, paths);
    if (!r.ok) {
      D.flashNote(r.reason ?? tt("成组失败"), 3600);
      return null;
    }
    D.setXmlAndTrack(r.xml);
    D.setSelectedPath(r.newPath);
    D.setSelExtra([]);
    D.flashNote(tt("已把 {n} 个控件包进 FrameLayout", { n: paths.length }), 2600);
    return r.newPath;
  }, [validSelPaths, D]);

  /** M115：Ctrl+Shift+G 解组（仅对主选容器） */
  const ungroupSelection = useCallback((): string[] => {
    if (!D.selectedPath) return [];
    if (!canUnwrap(D.xml, D.selectedPath)) {
      D.flashNote(tt("选中的不是带子控件的容器，解不了组"), 3200);
      return [];
    }
    const r = unwrapElement(D.xml, D.selectedPath);
    if (!r.ok) {
      D.flashNote(r.reason ?? tt("解组失败"), 3600);
      return [];
    }
    D.setXmlAndTrack(r.xml);
    D.setSelectedPath(r.childPaths[0] ?? null);
    D.setSelExtra(r.childPaths.slice(1));
    D.flashNote(tt("已解组：子控件已提出来"), 2400);
    return r.childPaths;
  }, [D]);

  /** M115：删除当前多选（有 ≥2 时用文本切片批量删；否则走原单删） */
  const deleteSelection = useCallback((): number => {
    const paths = validSelPaths();
    if (paths.length < 2) {
      // 走原有 onRemoveNode 路径（保留其状态/历史行为）
      if (D.selectedPath) D.onRemoveNode(D.selectedPath);
      D.setSelExtra([]);
      return 1;
    }
    const out = deletePathsText(D.xml, paths);
    D.setXmlAndTrack(out);
    D.setSelExtra([]);
    D.setSelectedPath(null);
    D.flashNote(tt("已删除 {n} 个控件", { n: paths.length }), 2400);
    return paths.length;
  }, [validSelPaths, D]);

  return {
    selPaths,
    selectPath,
    validSelPaths,
    copySelection,
    pasteSelection,
    duplicateSelection,
    groupSelection,
    ungroupSelection,
    deleteSelection,
  };
}
