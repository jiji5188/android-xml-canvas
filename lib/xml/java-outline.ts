// lib/xml/java-outline.ts — M61：Java / Kotlin 函数大纲（右侧「函数列表」）
//
// 目的：手机上翻 3000 行代码找某个方法是灾难，所以给一份「类 → 方法」的目录，
//       点一下跳到那一行（复用 CodeEditor 已有的 focusLine/focusTick）。
//
// 实现：不引 AST。做一遍字符扫描，跳过注释/字符串/字符字面量，维护花括号深度；
//       每当遇到 `{` 就把「上一段语句」（自上一个 { } ; 之后的内容）拿出来判断是
//       方法声明还是类声明。Kotlin 额外按行认 `fun`（表达式体没有花括号）。
//
// 只求「够用且不误报」，所以：
//   - 关键字（if/for/while/switch/catch/synchronized/try）一律排除
//   - 含 `new ` 的语句跳过（匿名类）
//   - 名字必须在最后，后面只允许接 throws/默认值（否则是方法调用参数等）

export type OutlineKind = "class" | "method";

export interface OutlineItem {
  /** 方法名 / 类名 */
  name: string;
  /** 1 起的行号（声明所在行） */
  line: number;
  kind: OutlineKind;
  /** 嵌套深度（0 = 顶层类，1 = 类里的方法，2 = 内部类的方法…） */
  depth: number;
  /** 一行摘要：参数 / 返回类型，列表里做副标题 */
  sig?: string;
}

const CONTROL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "synchronized",
  "try",
  "else",
  "do",
  "finally",
  "return",
  "new",
  "assert",
  "throw",
  "case",
  "default",
  "yield",
]);

/** 把语句压成单行 + 单空格，去掉注解前缀（@Override 之类） */
function normalizeStmt(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // 去掉前导注解：@Override / @SuppressWarnings("x") / @Nullable 等
  for (;;) {
    const m = /^@[\w$.]+(\([^()]*\))?\s*/.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

/** Java 方法/构造器：name(params) 后可选 throws xxx，且 name 不是控制关键字 */
function matchJavaMethod(stmt: string): { name: string; sig: string } | null {
  if (!stmt || stmt.includes("new ")) return null;
  const m = /([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:throws\s+[\w$.,\s]+)?$/.exec(stmt);
  if (!m) return null;
  const name = m[1];
  if (CONTROL_KEYWORDS.has(name)) return null;
  // 纯 `foo(` 后面没东西的情况（被截断）不认
  if (/^[\w$]*$/.test(stmt) && !stmt.includes("(")) return null;
  const params = m[2].trim();
  // 返回类型 = 名字前面的部分最后一段
  const before = stmt.slice(0, m.index).trim();
  const ret = before.split(" ").filter(Boolean).pop();
  const isCtor = !ret || ret === name || /(public|private|protected)$/.test(before);
  const sig = isCtor
    ? `(${params})`
    : `${ret} (${params})`;
  return { name, sig };
}

/** 类 / 接口 / 枚举 / record 声明 */
function matchJavaClass(stmt: string): string | null {
  const m = /\b(class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/.exec(stmt);
  return m ? m[2] : null;
}

/** 去掉注释 / 字符串 / 字符字面量，保留换行以保证行号不变 */
function stripNoise(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out.push("\n");
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        if (src[i] === "\n") out.push("\n");
        i++;
      }
      i++;
      out.push(" ");
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Java：花括号深度扫描 */
function outlineJava(clean: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const starts = [0]; // 行首偏移表（行号查询用）
  for (let i = 0; i < clean.length; i++) if (clean[i] === "\n") starts.push(i + 1);
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  let depth = 0;
  let bufStart = 0;
  const flush = (end: number) => {
    const raw = clean.slice(bufStart, end);
    const stmt = normalizeStmt(raw);
    // 行号取「名字所在行」：注解（@Override）在上一行时也不会跑偏
    const lineOfName = (name: string): number => {
      const off = raw.indexOf(name);
      if (off >= 0) return lineOf(bufStart + off);
      const first = raw.search(/\S/);
      return lineOf(bufStart + Math.max(0, first));
    };
    if (stmt) {
      const cls = matchJavaClass(stmt);
      if (cls && /\b(class|interface|enum|record|@interface)\b/.test(stmt) && !stmt.includes("new ")) {
        items.push({ name: cls, line: lineOfName(cls), kind: "class", depth });
      } else {
        const meth = matchJavaMethod(stmt);
        if (meth) {
          items.push({
            name: meth.name,
            line: lineOfName(meth.name),
            kind: "method",
            depth,
            sig: meth.sig,
          });
        }
      }
    }
    bufStart = end + 1;
  };

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") {
      flush(i);
      depth++;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
      bufStart = i + 1;
    } else if (c === ";") {
      bufStart = i + 1;
    }
  }
  return items;
}

/** Kotlin：`fun name(...)` 按行识别（同时支持表达式体与花括号体） */
function outlineKotlin(src: string, clean: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = clean.split("\n");
  const rawLines = src.split("\n");
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // 先按行首缩进估深度（Kotlin 用缩进，不用花括号判断嵌套类）
    const indent = line.length - line.trimStart().length;
    const fun = /\bfun\s+(?:<[^>]*>\s*)?(?:[\w$.]+\.)?`?([A-Za-z_$][\w$]*)`?\s*\(/.exec(trimmed);
    if (fun) {
      const sig = /\(([^)]*)\)\s*(?::\s*([\w$.<>?, ]+))?/.exec(trimmed);
      const params = sig ? sig[1].trim() : "";
      const ret = sig && sig[2] ? sig[2].trim() : "";
      items.push({
        name: fun[1],
        line: i + 1,
        kind: "method",
        depth: Math.max(1, Math.floor(indent / 4) + 1),
        sig: ret ? `${ret} (${params})` : `(${params})`,
      });
      void rawLines;
      void depth;
      continue;
    }
    const cls = /\b(class|interface|object|enum class)\s+`?([A-Za-z_$][\w$]*)`?/.exec(trimmed);
    if (cls) {
      items.push({
        name: cls[2],
        line: i + 1,
        kind: "class",
        depth: Math.max(0, Math.floor(indent / 4)),
      });
    }
  }
  return items;
}

/** 判断是不是 Java/Kotlin 源码（按文件名） */
export function isJavaLikePath(nameOrPath: string | null | undefined): boolean {
  if (!nameOrPath) return false;
  return /\.(java|kt|kts)$/i.test(nameOrPath);
}

/** 主入口：源码 → 大纲（按行号升序） */
export function parseOutline(src: string, isKotlin: boolean): OutlineItem[] {
  if (!src) return [];
  const clean = stripNoise(src);
  const items = isKotlin ? outlineKotlin(src, clean) : outlineJava(clean);
  // 行号排序（Kotlin 行扫描本来就顺序；Java 也顺序，这里兜底）
  items.sort((a, b) => a.line - b.line);
  return items;
}
