// lib/xml/history.ts — 撤销栈的纯逻辑（M2u：合并窗口）
// 从 XmlEditor 里抽出来是为了能单测：拖动/滑杆这类连续操作应合并成「一步」撤销，
// 而不是每移动 1px 就压一个撤销点（原来拖一次 300px 会产生上百个点）。

export interface HistoryState {
  stack: string[];
  idx: number;
}

/** 上次提交的标记：key 相同且时间在窗口内 → 覆盖栈顶 */
export interface MergeMark {
  at: number;
  key: string;
}

export const HISTORY_CAP = 20;
export const MERGE_MS = 900;

export interface CommitOptions {
  /** 合并键：同一次手势用同一个 key（如 geom:#0/1、attr:#0/1:textSize） */
  key?: string;
  /** 当前时间（ms） */
  now: number;
  /** 上一次提交的标记 */
  mark: MergeMark;
  /** 栈容量上限 */
  cap?: number;
}

export interface CommitResult {
  state: HistoryState;
  mark: MergeMark;
  /** 是否发生了合并（覆盖栈顶，没新增撤销点） */
  merged: boolean;
  /** 内容没变、什么都没做 */
  unchanged: boolean;
}

/**
 * 把 next 版本提交进历史栈。
 * - key 非空 + 与上次 key 相同 + 时间在 MERGE_MS 内 + 当前在栈顶 → 覆盖栈顶（合并）
 * - 否则新增一条；超出 cap 时丢最旧的
 */
export function commitHistoryState(state: HistoryState, next: string, opts: CommitOptions): CommitResult {
  const { key = "", now, mark, cap = HISTORY_CAP } = opts;
  if (state.stack[state.idx] === next) {
    return { state, mark, merged: false, unchanged: true };
  }
  const atTop = state.idx === state.stack.length - 1;
  const canMerge = key !== "" && key === mark.key && now - mark.at < MERGE_MS && atTop && state.stack.length > 1;
  if (canMerge) {
    const stack = state.stack.slice();
    stack[state.idx] = next;
    return { state: { stack, idx: state.idx }, mark: { at: now, key }, merged: true, unchanged: false };
  }
  const kept = state.stack.slice(0, state.idx + 1);
  kept.push(next);
  const capped = kept.length > cap ? kept.slice(kept.length - cap) : kept;
  return { state: { stack: capped, idx: capped.length - 1 }, mark: { at: now, key }, merged: false, unchanged: false };
}

/** 撤销 / 重做后断开合并链：否则下一次拖动会并进「被撤销掉的那一步」 */
export const EMPTY_MARK: MergeMark = { at: 0, key: "" };

/* ===== M59：diff 撤销栈（省内存）=====
 * 全量快照 ×20 份，250KB 文档就是 5MB。相邻两版 99% 相同（只改了十几字符），
 * 存 diff 能把一个撤销点压到几十~几百字节，于是可以同时做到：
 *   - 内存占用小一个数量级
 *   - 撤销步数从 20 提到 50
 *
 * diff 结构 = 公共前缀长度 + 公共后缀长度 + 被删的中间段 + 新插入的中间段。
 * 前后缀都要存「被替换的旧文本」，否则撤销时找不回来（这是第一版的 bug）。
 */

export interface Diff {
  /** 公共前缀长度 */
  common: number;
  /** 公共后缀长度 */
  tailLen: number;
  /** 旧串在 [common, oldLen-tailLen) 的这段（撤销时要放回去） */
  del: string;
  /** 新串在 [common, newLen-tailLen) 的这段（重做时要放回去） */
  ins: string;
}

/** 求 a → b 的最小 diff（前后缀剥离） */
export function diffTo(prev: string, next: string): Diff {
  let common = 0;
  const min = Math.min(prev.length, next.length);
  while (common < min && prev.charCodeAt(common) === next.charCodeAt(common)) common++;

  let tailLen = 0;
  // 后缀不能和前缀重叠：上限是 min - common
  const maxTail = min - common;
  while (
    tailLen < maxTail &&
    prev.charCodeAt(prev.length - 1 - tailLen) === next.charCodeAt(next.length - 1 - tailLen)
  )
    tailLen++;

  return {
    common,
    tailLen,
    del: prev.slice(common, prev.length - tailLen),
    ins: next.slice(common, next.length - tailLen),
  };
}

/** forward: prev → next；backward: next → prev */
export function applyDiff(text: string, d: Diff, forward: boolean): string {
  const mid = forward ? d.ins : d.del;
  return text.slice(0, d.common) + mid + text.slice(text.length - d.tailLen);
}

export interface DiffHistory {
  /** 最底部（最旧）的那份完整文档，只用于容量统计/兜底 */
  base: string;
  /** 从 base 往后的增量链；栈顶 = 最近一步 */
  undo: Diff[];
  /** 被撤销掉、还能重做的步骤（栈顶 = 下一个可重做） */
  redo: Diff[];
  /** 当前文档（引用，不复制） */
  cur: string;
}

export const DIFF_STEP_CAP = 50;
export const DIFF_HARD_BYTES = 6 * 1024 * 1024;

export function diffHistoryInit(doc: string): DiffHistory {
  return { base: doc, undo: [], redo: [], cur: doc };
}

/** 提交一个改动 */
export function diffHistoryCommit(h: DiffHistory, next: string): DiffHistory {
  if (next === h.cur) return h;
  const d = diffTo(h.cur, next);
  const undo = [...h.undo, d];
  let base = h.base;

  // 超出步数上限：最旧的一段合并进 base（撤销深度按设计损失）
  while (undo.length > DIFF_STEP_CAP) {
    base = applyDiff(base, undo.shift()!, true);
  }

  // 超出字节预算：同样从最旧端丢
  let bytes = diffHistoryBytesOf(base, undo, []);
  while (bytes > DIFF_HARD_BYTES && undo.length > 1) {
    base = applyDiff(base, undo.shift()!, true);
    bytes = diffHistoryBytesOf(base, undo, []);
  }

  // 有新改动 → 重做链作废
  return { base, undo, redo: [], cur: next };
}

export function diffHistoryUndo(h: DiffHistory): { doc: string; next: DiffHistory } {
  if (h.undo.length === 0) return { doc: h.cur, next: h };
  const d = h.undo[h.undo.length - 1];
  const prev = applyDiff(h.cur, d, false);
  return {
    doc: prev,
    next: { base: h.base, undo: h.undo.slice(0, -1), redo: [d, ...h.redo], cur: prev },
  };
}

export function diffHistoryRedo(h: DiffHistory): { doc: string; next: DiffHistory } {
  if (h.redo.length === 0) return { doc: h.cur, next: h };
  const d = h.redo[0];
  const next = applyDiff(h.cur, d, true);
  return {
    doc: next,
    next: { base: h.base, undo: [...h.undo, d], redo: h.redo.slice(1), cur: next },
  };
}

/** 当前文档 */
export function diffHistoryCurrent(h: DiffHistory): string {
  return h.cur;
}

/** 能不能撤销/重做 */
export function diffHistoryCanUndo(h: DiffHistory): boolean {
  return h.undo.length > 0;
}
export function diffHistoryCanRedo(h: DiffHistory): boolean {
  return h.redo.length > 0;
}

function diffBytes(d: Diff): number {
  return d.del.length + d.ins.length + 16;
}

function diffHistoryBytesOf(base: string, undo: Diff[], redo: Diff[]): number {
  let b = base.length;
  for (const d of undo) b += diffBytes(d);
  for (const d of redo) b += diffBytes(d);
  return b;
}

/** 栈占用字节（估）——用来验证「省内存」是否真成立 */
export function diffHistoryBytes(h: DiffHistory): number {
  return diffHistoryBytesOf(h.base, h.undo, h.redo);
}
