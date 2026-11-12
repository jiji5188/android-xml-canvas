// lib/xml/text-pos.ts
//
// 「偏移量 ↔ 行号/列号」的唯一实现。以前 java-api-check / java-lint / lint-doc / lint
// 各写一份二分查找（4 份同款），改一处忘三处是真实发生过的隐患，统一到这里。
//
// 约定：行号、列号都从 1 开始（和编辑器、aapt 报错一致）。

/** 每一行的起始偏移；starts[0] === 0，长度 = 总行数 */
export function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

/** 偏移量 → 行号（1 基）；越界按最近的一行算 */
export function lineOf(starts: number[], offset: number): number {
  if (starts.length === 0) return 1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 偏移量 → 列号（1 基，按 UTF-16 code unit 计，和 CodeMirror 的 col 一致） */
export function colOf(starts: number[], offset: number): number {
  const line = lineOf(starts, offset);
  return offset - starts[line - 1] + 1;
}

/** 偏移量 → { line, col }，两者都 1 基 */
export function posOf(starts: number[], offset: number): { line: number; col: number } {
  const line = lineOf(starts, offset);
  return { line, col: offset - starts[line - 1] + 1 };
}
