// lib/xml/diag-deco.ts — M202：AIDE 式精确错误引导
//
// 把「带列号/长度的 lint 问题」算成文档里的 (from, to) 区间，
// 编辑器据此画波浪下划线（精确范围）或整行标色（没有列号时退回老行为）。
// 纯函数，可单测；不碰 DOM / CodeMirror。

export interface DiagInfo {
  line: number;
  sev: "error" | "warn";
  msg: string;
  /** M207：机器可读 code（如 method/case/sym/assign/dup...），卡片据此显示「为什么/怎么改」 */
  code?: string;
  /** 1 起列号（有值时画精确波浪，没有就退回整行标色） */
  col?: number;
  /** 下划线长度（默认 1） */
  len?: number;
  /** 可自动修复 */
  fix?: { from: string; to: string; label: string };
}

export interface DocLike {
  lines: number;
  line(n: number): { from: number; to: number };
}

export interface DiagRange {
  from: number;
  to: number;
  sev: "error" | "warn";
  msg: string;
  /** 是否整行（用于决定用 line deco 还是 mark deco） */
  full: boolean;
}

/** 把 Map<line, DiagInfo> 算成文档区间（from/to 为 0 起偏移） */
export function diagRanges(doc: DocLike, m: Map<number, DiagInfo>): DiagRange[] {
  const out: DiagRange[] = [];
  for (const [ln, d] of m) {
    if (ln < 1 || ln > doc.lines) continue;
    const line = doc.line(ln);
    if (d.col !== undefined && d.col > 1) {
      const from = line.from + Math.max(0, d.col - 1);
      const to = Math.min(line.to, from + Math.max(1, d.len ?? 1));
      if (to > from) {
        out.push({ from, to, sev: d.sev, msg: d.msg, full: false });
      } else {
        out.push({ from: line.from, to: line.to, sev: d.sev, msg: d.msg, full: true });
      }
    } else {
      out.push({ from: line.from, to: line.to, sev: d.sev, msg: d.msg, full: true });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
