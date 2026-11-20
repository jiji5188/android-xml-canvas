// lib/xml/block-guides.ts — M442：代码块花括号的「纵向标记线」纯逻辑
//
// 用户要求：多行花括号块（if 体 / 方法体 / 类体）画一条从「开始 {」到「结束 }」的
// 纵向缩进参考线（begin > end）。这里只算「哪些块、缩进列、起止行」，渲染交给
// CodeMirror 装饰（components/CodeEditor.tsx 的 blockGuidesField）。
//
// 纯文本扫描（花括号配对，跳字符串/注释/字符），不编译、不做类型推导。
// 只收「跨行」的块（开始行 < 结束行）；单行 `{}`（如 `if (x) {}`）不画线。

export interface BlockGuide {
  /** 开始行（1 起，含 `{`） */
  startLine: number;
  /** 结束行（1 起，含 `}`） */
  endLine: number;
  /** 块体缩进列（`{` 所在行去掉前导空格后，左花括号前是 0；用其缩进空格数） */
  col: number;
  /** 块开始时的嵌套深度（1 = 顶层） */
  depth: number;
}

/** 把字符串/字符/注释里的花括号置空（保留长度与换行），避免误配对 */
function maskNonCode(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let st: "code" | "line" | "block" | "str" | "char" = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (st === "code") {
      if (c === "/" && d === "/") {
        st = "line";
        out.push(" ", " ");
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        st = "block";
        out.push(" ", " ");
        i += 2;
        continue;
      }
      if (c === '"') {
        st = "str";
        out.push(" ");
        i++;
        continue;
      }
      if (c === "'") {
        st = "char";
        out.push(" ");
        i++;
        continue;
      }
      out.push(c);
      i++;
      continue;
    }
    if (st === "line") {
      if (c === "\n") {
        st = "code";
        out.push("\n");
      } else out.push(" ");
      i++;
      continue;
    }
    if (st === "block") {
      if (c === "*" && d === "/") {
        st = "code";
        out.push(" ", " ");
        i += 2;
        continue;
      }
      out.push(c === "\n" ? "\n" : " ");
      i++;
      continue;
    }
    if (c === "\\") {
      out.push(" ", " ");
      i += 2;
      continue;
    }
    if ((st === "str" && c === '"') || (st === "char" && c === "'")) {
      st = "code";
      out.push(" ");
      i++;
      continue;
    }
    out.push(c === "\n" ? "\n" : " ");
    i++;
  }
  return out.join("");
}

/**
 * 算出所有跨行花括号块。
 * 规则：遇到 `{` 记下（行/列/深度）；遇到配对的 `}` 若结束行 > 开始行 → 收成一条 guide。
 * col = `{` 所在行的前导空格数（indent 列）。深度 = 当时栈深。
 */
export function computeBlockGuides(code: string): BlockGuide[] {
  if (!code) return [];
  const masked = maskNonCode(code);
  const lines = masked.split("\n");
  // 每行起始 offset（用于 1 起行号 → 绝对位置；这里直接按行处理，避免 offset 计算）
  const guides: BlockGuide[] = [];
  type Stack = { startLine: number; col: number; depth: number };
  const stack: Stack[] = [];

  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    // 行首前导空格（= 该行代码缩进；`{` 通常挂在行尾或单独一行）
    const indent = ln.length - ln.replace(/^ +/, "").length; // 只按空格（tab 不计，近似）
    let inStrLike = false;
    for (let ci = 0; ci < ln.length; ci++) {
      const ch = ln[ci];
      if (ch === "{" && !inStrLike) {
        stack.push({ startLine: li + 1, col: indent, depth: stack.length + 1 });
      } else if (ch === "}" && !inStrLike) {
        const open = stack.pop();
        if (open && open.startLine < li + 1) {
          // 跨行块 → 收成 guide
          guides.push({ startLine: open.startLine, endLine: li + 1, col: open.col, depth: open.depth });
        }
      }
    }
  }
  // 去重（同一 start/col）+ 排序（深度浅在前，便于渲染分层）
  const seen = new Set<string>();
  const uniq = guides.filter((g) => {
    const k = g.startLine + ":" + g.endLine + ":" + g.col;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => a.depth - b.depth || a.startLine - b.startLine);
  return uniq;
}

/** 渲染上限：避免满屏竖线（大文件 / 深层嵌套时只画浅层的） */
export function pickRenderedGuides(all: BlockGuide[], maxDepth = 8, maxCount = 60): BlockGuide[] {
  return all.filter((g) => g.depth <= maxDepth).slice(0, maxCount);
}
