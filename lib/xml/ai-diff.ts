// lib/xml/ai-diff.ts — M64e（B3）：AI 改动预览用的行级 diff
//
// 为什么自己写：引 diff 库要加依赖，而这只需要「给人看的行级 +/-」，
// 不需要 Myers 最优；用 LCS 的简化版足够，再加大文件降级保护。

export interface DiffLine {
  /** " " 上下文 / "-" 删除 / "+" 新增 */
  op: " " | "-" | "+";
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** 超过行数预算后是否被截断显示（统计仍然是全量） */
  truncated: boolean;
}

const MAX_LINES = 2500;

function splitLines(s: string): string[] {
  if (!s) return [];
  return s.replace(/\r\n/g, "\n").split("\n");
}

/**
 * 行级差异。同一行内容相同 → 上下文；变化处先输出删除再输出新增。
 * 超预算时降级为「整段删除 + 整段新增」，避免 O(n²) 卡死。
 */
export function diffLines(before: string, after: string, opts: { maxLines?: number } = {}): DiffResult {
  const max = opts.maxLines ?? MAX_LINES;
  const A = splitLines(before);
  const B = splitLines(after);

  if (A.length + B.length > max * 2) {
    const lines: DiffLine[] = [
      ...A.map((t) => ({ op: "-" as const, text: t })),
      ...B.map((t) => ({ op: "+" as const, text: t })),
    ];
    return { lines: lines.slice(0, max), added: B.length, removed: A.length, truncated: true };
  }

  // LCS 表（Uint16 省内存）
  const n = A.length;
  const m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? ((dp[i + 1][j + 1] as number) + 1) as number : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      lines.push({ op: " ", text: A[i] });
      i++;
      j++;
    } else if ((dp[i + 1][j] as number) >= (dp[i][j + 1] as number)) {
      lines.push({ op: "-", text: A[i++] });
    } else {
      lines.push({ op: "+", text: B[j++] });
    }
  }
  while (i < n) lines.push({ op: "-", text: A[i++] });
  while (j < m) lines.push({ op: "+", text: B[j++] });

  const added = lines.filter((l) => l.op === "+").length;
  const removed = lines.filter((l) => l.op === "-").length;
  if (lines.length > max) {
    return { lines: lines.slice(0, max), added, removed, truncated: true };
  }
  return { lines, added, removed, truncated: false };
}

/** 只留变化处 ±2 行上下文，卡片里看更清楚 */
export function compactHunks(lines: DiffLine[], context = 2): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.op === " ") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ op: " ", text: `… 省略 ${skipped} 行 …` });
        skipped = 0;
      }
      out.push(l);
    } else {
      skipped++;
    }
  });
  return out;
}

/** 卡片头部的一句话摘要 */
export function diffSummary(d: DiffResult): string {
  if (!d.added && !d.removed) return "无变化";
  const parts: string[] = [];
  if (d.added) parts.push(`+${d.added}`);
  if (d.removed) parts.push(`-${d.removed}`);
  return parts.join(" ");
}
