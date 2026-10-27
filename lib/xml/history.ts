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

export const HISTORY_CAP = 60;
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
