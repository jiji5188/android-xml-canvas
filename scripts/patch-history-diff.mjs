import fs from "node:fs";

const path = "lib/xml/history.ts";
let src = fs.readFileSync(path, "utf8");

if (src.includes("M59")) {
  console.log("已打过补丁，跳过");
  process.exit(0);
}

// 在文件末尾追加 diff 栈
const ADD = `

/* ===== M59：按字节上限 + diff 的撤销栈 =====
 * 全量快照 ×20 份在 250KB 文档时就是 5MB。这里存
 *   base: string          —— 最近的完整快照
 *   diffs: Diff[]        —— 从 base 之后的增量（undo 从后往前）
 * 相邻两份 99% 相同（只改了几个字符），diff 通常几十到几百字节。
 * 总字节预算 HARD_CAP = 6MB：超了就从最旧的 diff 开始丢（base 保留）。
 * 这样 20 步撤销占 ~几十 KB，还能把步数提到 50。 */

export interface Diff {
  /** 前缀公共长度：new.slice(0, common) === old.slice(0, common) */
  common: number;
  /** old 中 [common, oldLen) 这段被替换 */
  oldTailLen: number;
  /** 替换成的新尾部 */
  newTail: string;
  /** 旧全文长度 */
  oldLen: number;
}

export function diffTo(base: string, next: string): Diff {
  let common = 0;
  const min = Math.min(base.length, next.length);
  while (common < min && base.charCodeAt(common) === next.charCodeAt(common)) common++;
  let oldTailLen = 0;
  // 从尾往前找公共部分（只比较 min 范围内）
  while (
    oldTailLen < min - common &&
    base.charCodeAt(base.length - 1 - oldTailLen) === next.charCodeAt(next.length - 1 - oldTailLen)
  )
    oldTailLen++;
  const newTail = next.slice(common + (next.length - common - oldTailLen));
  return { common, oldTailLen, newTail, oldLen: base.length };
}

export function applyDiff(base: string, d: Diff, forward: boolean): string {
  // forward: base + diff → new；backward: new + diff → old
  if (forward) {
    const rest = base.slice(d.common + d.oldTailLen); // 不会用到，保持对称
    void rest;
    return base.slice(0, d.common) + d.newTail + base.slice(d.common + d.oldTailLen);
  }
  return base.slice(0, d.common) + base.slice(d.common + d.oldTailLen).length >= 0
    ? base.slice(0, d.common) + base.slice(d.common).slice(0, d.oldTailLen) + base.slice(d.common + d.oldTailLen)
    : base;
}

export interface DiffHistory {
  base: string;
  /** 从 base → 当前 的 diff 序列；undo = 逆序应用，redo = 正序 */
  undo: Diff[];
  redo: Diff[];
}

export const DIFF_STEP_CAP = 50;
export const DIFF_HARD_BYTES = 6 * 1024 * 1024;

export function diffHistoryInit(doc: string): DiffHistory {
  return { base: doc, undo: [], redo: [] };
}

/** 提交一个改动；返回新栈。字节超限时从最旧 undo 端丢弃。 */
export function diffHistoryCommit(h: DiffHistory, next: string): DiffHistory {
  if (h.base === next) return h;
  const d = diffTo(h.base, next);
  const undo = h.undo.slice();
  undo.push(d);
  let base = h.base;
  let redo: Diff[] = [];
  // 合并策略：只保留最近一次 diff 相对 base 的链；
  // 当 undo 长度超 DIFF_STEP_CAP 时，把最旧的若干段合并成一个「跳变」diff 不可行，
  // 所以直接截断：丢掉最旧的 undo 项（对应撤销深度损失）
  if (undo.length > DIFF_STEP_CAP) {
    const cut = undo.length - DIFF_STEP_CAP;
    // 把被截掉的段重新算成 base → 第一个保留的中间态
    let mid = base;
    for (let i = 0; i < cut; i++) mid = applyDiff(mid, undo[i], true);
    base = mid;
    undo.splice(0, cut);
  }
  // 字节预算
  let bytes = base.length;
  for (const dd of undo) bytes += dd.newTail.length + dd.oldTailLen;
  while (bytes > DIFF_HARD_BYTES && undo.length > 1) {
    const dd = undo.shift()!;
    base = applyDiff(base, dd, true);
    bytes = base.length;
    for (const x of undo) bytes += x.newTail.length + x.oldTailLen;
  }
  return { base, undo, redo };
}

export function diffHistoryUndo(h: DiffHistory): { doc: string; next: DiffHistory } {
  if (h.undo.length === 0) return { doc: h.base, next: h };
  const d = h.undo[h.undo.length - 1];
  const prev = applyDiff(h.base, d, false);
  return {
    doc: prev,
    next: {
      base: h.base,
      undo: h.undo.slice(0, -1),
      redo: [d, ...h.redo],
    },
  };
}

export function diffHistoryRedo(h: DiffHistory): { doc: string; next: DiffHistory } {
  if (h.redo.length === 0) return { doc: h.base, next: h };
  const d = h.redo[0];
  const next = applyDiff(h.base, d, true);
  return {
    doc: next,
    next: {
      base: h.base,
      undo: [...h.undo, d],
      redo: h.redo.slice(1),
    },
  };
}

/** 当前文档 = 从 base 正向应用所有 undo diff */
export function diffHistoryCurrent(h: DiffHistory): string {
  let doc = h.base;
  for (const d of h.undo) doc = applyDiff(doc, d, true);
  return doc;
}

/** 栈占用字节（估） */
export function diffHistoryBytes(h: DiffHistory): number {
  let b = h.base.length;
  for (const d of h.undo) b += d.newTail.length + d.oldTailLen;
  for (const d of h.redo) b += d.newTail.length + d.oldTailLen;
  return b;
}
`;

src = src + ADD;
fs.writeFileSync(path, src, "utf8");
console.log("history.ts 追加 diff 栈，行数:", src.split("\n").length);
