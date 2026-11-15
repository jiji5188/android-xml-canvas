// components/use-diff-history.ts — M305：从 XmlEditor.tsx 抽出的 diff 撤销/重做域
// 存相邻两版的 diff（十几个字符），50 步撤销只占几十 KB。

"use client";

import { useCallback, useRef, useState } from "react";
import {
  applyDiff,
  diffHistoryCanRedo,
  diffHistoryCanUndo,
  diffHistoryCommit,
  diffHistoryInit,
  diffHistoryRedo,
  diffHistoryUndo,
  diffTo,
  type DiffHistory,
} from "@/lib/xml/history";
import { LS_KEY_XML, lsGet } from "@/lib/xml/storage";
import { SAMPLES } from "@/lib/xml/samples";

/** M2u：合并窗口——同一手势 key 在 900ms 内连续提交 → 只覆盖栈顶，不新增撤销点 */
const MERGE_MS = 900;
interface MergeMark {
  at: number;
  key: string;
}
const EMPTY_MARK: MergeMark = { at: 0, key: "" };

export interface UseDiffHistoryOptions {
  /** 把一份文档写进 state（hook 不直接持有 xml） */
  setXml: (next: string) => void;
  /** 编辑器里最新未落状态的文本（打字中的 live 值） */
  liveXmlRef: React.MutableRefObject<string | null>;
  /** 把 live 值 flush 进 state */
  flushXml: () => void;
}

export function useDiffHistory({ setXml, liveXmlRef, flushXml }: UseDiffHistoryOptions) {
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false });
  const histRef = useRef<DiffHistory>(diffHistoryInit(lsGet(LS_KEY_XML) ?? SAMPLES.list));
  const textTimer = useRef<number | null>(null);

  const syncHist = useCallback(() => {
    const h = histRef.current;
    setHistInfo({ canUndo: diffHistoryCanUndo(h), canRedo: diffHistoryCanRedo(h) });
  }, []);

  const lastCommitRef = useRef<MergeMark>(EMPTY_MARK);
  const commitHistory = useCallback(
    (next: string, key = "") => {
      const h = histRef.current;
      if (next === h.cur) return;
      const now = Date.now();
      const mark = lastCommitRef.current;
      const canMerge = key !== "" && key === mark.key && now - mark.at < MERGE_MS && h.undo.length > 0;
      if (canMerge) {
        // 手势进行中：把「上一步 diff」换成「手势起点 → 当前」这一段
        const prev = applyDiff(h.cur, h.undo[h.undo.length - 1], false);
        histRef.current = { ...h, undo: [...h.undo.slice(0, -1), diffTo(prev, next)], redo: [], cur: next };
      } else {
        histRef.current = diffHistoryCommit(h, next);
      }
      lastCommitRef.current = { at: now, key };
      syncHist();
    },
    [syncHist],
  );

  const flushTextTimer = useCallback(() => {
    if (textTimer.current !== null) {
      window.clearTimeout(textTimer.current);
      textTimer.current = null;
    }
  }, []);

  const canUndo = histInfo.canUndo;
  const canRedo = histInfo.canRedo;

  /** M139：把「还没入栈的编辑」先提交（编辑器中 500ms 合并窗口内按 Ctrl+Z 时把刚敲的也纳入撤销） */
  const commitPendingText = useCallback(() => {
    const pending = liveXmlRef.current;
    if (pending !== null && pending !== histRef.current.cur) commitHistory(pending);
  }, [liveXmlRef, commitHistory]);

  const undo = useCallback(() => {
    flushTextTimer();
    commitPendingText();
    flushXml();
    liveXmlRef.current = null;
    const r = diffHistoryUndo(histRef.current);
    if (r.next === histRef.current) return;
    histRef.current = r.next;
    lastCommitRef.current = EMPTY_MARK; // M2u：撤销后断开合并链，新操作必须新建撤销点
    setXml(r.doc);
    syncHist();
  }, [flushTextTimer, commitPendingText, flushXml, liveXmlRef, setXml, syncHist]);

  const redo = useCallback(() => {
    flushTextTimer();
    // 有未入栈的输入时先提交（会清空 redo 栈），否则重做会跳过刚敲的那段
    commitPendingText();
    flushXml();
    liveXmlRef.current = null;
    const r = diffHistoryRedo(histRef.current);
    if (r.next === histRef.current) return;
    histRef.current = r.next;
    lastCommitRef.current = EMPTY_MARK;
    setXml(r.doc);
    syncHist();
  }, [flushTextTimer, commitPendingText, flushXml, liveXmlRef, setXml, syncHist]);

  return {
    histInfo,
    histRef,
    textTimer,
    syncHist,
    lastCommitRef,
    commitHistory,
    flushTextTimer,
    canUndo,
    canRedo,
    commitPendingText,
    undo,
    redo,
  };
}
