// lib/xml/java-lint.ts — M70（C2）：Java/Kotlin 轻量静态检查
//
// 不指望在这里做真正的编译：目标是「明显会编译不过的东西别直接甩给用户」。
// 检查项（全部本地、无依赖、够快）：
//   1. 括号/花括号/方括号不平衡（带开括号所在行）
//   2. 字符串/字符字面量没闭合（会连带整段后续代码判错，所以优先报这个）
//   3. R.id.xxx 在项目 layout 里不存在（拼错 id 的最高频来源）
//   4. 用了常见类但没 import（Intent / Toast / Bundle / TextView …）
//   5. @Override 后面跟的不是方法声明
// 结果分 error / warn 两档；formatJavaLint 固定带「未编译验证」声明，避免模型谎称编译通过。

export type JavaLintSeverity = "error" | "warn";

export interface JavaLintIssue {
  /** 1 起行号 */
  line: number;
  sev: JavaLintSeverity;
  /** 机器可读的小标记，方便测试与后续分组 */
  code: "brace" | "quote" | "rid" | "import" | "override";
  msg: string;
}

export interface JavaLintOpts {
  isKotlin?: boolean;
  /** 项目里真实存在的 id 名（不含 @+id/ 前缀）。传了才查 R.id */
  ids?: Iterable<string>;
  /** 允许「用了但不 import」的名字（同包类、内部类） */
  allowNames?: Iterable<string>;
}

/** 常见类的简单名 → 所在包。只列高频、几乎不会同名冲突的。 */
const COMMON_IMPORTS: Record<string, string> = {
  Intent: "android.content.Intent",
  Context: "android.content.Context",
  SharedPreferences: "android.content.SharedPreferences",
  Bundle: "android.os.Bundle",
  Handler: "android.os.Handler",
  Looper: "android.os.Looper",
  Toast: "android.widget.Toast",
  TextView: "android.widget.TextView",
  Button: "android.widget.Button",
  ImageView: "android.widget.ImageView",
  EditText: "android.widget.EditText",
  RecyclerView: "androidx.recyclerview.widget.RecyclerView",
  LinearLayoutManager: "androidx.recyclerview.widget.LinearLayoutManager",
  Log: "android.util.Log",
  Uri: "android.net.Uri",
  Bitmap: "android.graphics.Bitmap",
  Color: "android.graphics.Color",
  View: "android.view.View",
  LayoutInflater: "android.view.LayoutInflater",
  Gson: "com.google.gson.Gson",
  JSONObject: "org.json.JSONObject",
  ArrayList: "java.util.ArrayList",
  HashMap: "java.util.HashMap",
  List: "java.util.List",
  Map: "java.util.Map",
  Objects: "java.util.Objects",
};

interface Masked {
  /** 与原文等长：注释与字符串内容替换成空格（保留换行），用于结构检查 */
  code: string;
  /** 逐字符是否落在字符串/字符字面量里 */
  inStr: boolean[];
  /** M98：文件结束时仍未闭合的字面量起始偏移（null = 都闭合了） */
  openAt: number | null;
}

/** 把注释和字面量内容抹成空格，保持偏移量与行号不变
 *
 * M98：以前只认 `"` / `'` / `//` / `/* *\/`，三种真实写法会被当成代码，
 * 于是里面的括号被拿去配对 → 误报「括号不配对」：
 *   1. Java 文本块 `"""…"""`（内容里的 " 会提前结束掩码）
 *   2. Kotlin 原始字符串 `"""…"""`（`"""{"a":1}"""` 这种 JSON 模板最典型）
 *   3. Kotlin 字符串模板 `"${map["k"]}"`（内层引号会把外层提前关掉）
 * 现在用状态栈处理：raw（三引号）、tpl（`${…}` 模板嵌套）。
 */
function mask(src: string, isKotlin = false): Masked {
  const out: string[] = [];
  const inStr: boolean[] = [];
  let i = 0;
  type St = "code" | "line" | "block" | "str" | "char" | "raw" | "tpl";
  const stack: { st: St; quote?: string; depth?: number; at?: number }[] = [];
  const top = () => stack[stack.length - 1];
  stack.push({ st: "code" });
  /** 按原文长度占位：换行保留换行，其余变空格 */
  const blank = (text: string, isStr: boolean) => {
    for (const ch of text) {
      out.push(ch === "\n" ? "\n" : " ");
      inStr.push(isStr);
    }
  };
  while (i < src.length) {
    const cur = top();
    const st = cur.st;
    const c = src[i];
    const n = src[i + 1];
    const n2 = src[i + 2];

    if (st === "code") {
      if (c === "/" && n === "/") {
        stack.push({ st: "line" });
        blank("//", false);
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        stack.push({ st: "block" });
        blank("/*", false);
        i += 2;
        continue;
      }
      // 三引号：Java 文本块 / Kotlin 原始字符串
      if (c === '"' && n === '"' && n2 === '"') {
        stack.push({ st: "raw", at: i });
        blank('"""', true);
        i += 3;
        continue;
      }
      if (c === '"') {
        stack.push({ st: "str", quote: '"', at: i });
        blank('"', true);
        i++;
        continue;
      }
      if (c === "'") {
        stack.push({ st: "char", quote: "'", at: i });
        blank("'", true);
        i++;
        continue;
      }
      out.push(c);
      inStr.push(false);
      i++;
      continue;
    }

    if (st === "line") {
      if (c === "\n") {
        stack.pop();
        out.push("\n");
        inStr.push(false);
      } else {
        blank(c, false);
      }
      i++;
      continue;
    }

    if (st === "block") {
      if (c === "*" && n === "/") {
        stack.pop();
        blank("*/", false);
        i += 2;
        continue;
      }
      blank(c, false);
      i++;
      continue;
    }

    if (st === "raw") {
      // 闭合三引号。Java 文本块里 `\` 仍会转义，Kotlin 原始字符串完全不转义
      if (c === "\\" && !isKotlin) {
        blank(src.slice(i, i + 2), true);
        i += 2;
        continue;
      }
      if (c === '"' && n === '"' && n2 === '"') {
        stack.pop();
        blank('"""', true);
        i += 3;
        continue;
      }
      blank(c, true);
      i++;
      continue;
    }

    // tpl：Kotlin 字符串模板 `${…}`，里面还能再套字符串和花括号
    if (st === "tpl") {
      if (c === '"' && n === '"' && n2 === '"') {
        stack.push({ st: "raw", at: i });
        blank('"""', true);
        i += 3;
        continue;
      }
      if (c === '"') {
        stack.push({ st: "str", quote: '"', at: i });
        blank('"', true);
        i++;
        continue;
      }
      if (c === "{") cur.depth = (cur.depth ?? 0) + 1;
      else if (c === "}") {
        const d = (cur.depth ?? 0) - 1;
        if (d <= 0) {
          // 模板结束，回到外层字符串
          stack.pop();
          blank("}", true);
          i++;
          continue;
        }
        cur.depth = d;
      }
      blank(c, c !== "\n");
      i++;
      continue;
    }

    // str / char
    const quote = cur.quote ?? '"';
    if (c === "\\") {
      // 转义：`\"` / `\'` / `\\` 都把后一个字符一起吞掉
      blank(src.slice(i, i + 2), true);
      i += 2;
      continue;
    }
    if (st === "str" && isKotlin && c === "$" && n === "{") {
      stack.push({ st: "tpl", depth: 0, at: i });
      blank("${", true);
      i += 2;
      continue;
    }
    if (c === quote) {
      stack.pop();
      blank(quote, true);
      i++;
      continue;
    }
    if (c === "\n" && st === "str") {
      // Java 不允许裸换行的字符串字面量（Kotlin 原始字符串走 raw，不来这里）
      blank("\n", true);
      i++;
      continue;
    }
    blank(c, true);
    i++;
  }
  // 文件结束时还停在字面量里 → 那个字面量没闭合
  const open = [...stack].reverse().find((s) => s.st === "str" || s.st === "char" || s.st === "raw" || s.st === "tpl");
  return { code: out.join(""), inStr, openAt: open ? (open.at ?? 0) : null };
}

function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 主检查入口 */
export function lintJava(src: string, opts: JavaLintOpts = {}): JavaLintIssue[] {
  const text = src || "";
  const issues: JavaLintIssue[] = [];
  if (!text.trim()) return issues;

  const masked = mask(text, !!opts.isKotlin);
  const starts = lineStarts(text);

  // 1) 字面量没闭合（先查，否则后面括号检查全是噪音）
  //    M98：改成看 mask 的结束状态 —— 以前靠 inStr 扫一遍，遇到文件末尾正好是 "abc" 会误报
  const lastQuoteLine = masked.openAt === null ? 0 : lineOf(starts, masked.openAt);
  if (lastQuoteLine) {
    issues.push({
      line: lastQuoteLine,
      sev: "error",
      code: "quote",
      msg: "字符串或字符字面量没有闭合（少了收尾的引号）",
    });
  }

  // 2) 括号平衡。字面量没闭合时跳过，避免误导
  if (!lastQuoteLine) {
    const stack: { ch: string; at: number }[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    /** M98：已经报过「不配对」就不再补一条「没闭合」—— 同一个错报两次最像误报 */
    let mismatched = false;
    for (let i = 0; i < masked.code.length; i++) {
      const c = masked.code[i];
      if (c === "(" || c === "[" || c === "{") stack.push({ ch: c, at: i });
      else if (c === ")" || c === "]" || c === "}") {
        const top = stack.pop();
        if (!top) {
          issues.push({
            line: lineOf(starts, i),
            sev: "error",
            code: "brace",
            msg: `多余的 "${c}"：前面没有对应的开括号`,
          });
          mismatched = true;
          break;
        }
        if (top.ch !== pairs[c]) {
          issues.push({
            line: lineOf(starts, top.at),
            sev: "error",
            code: "brace",
            msg: `括号不配对："${top.ch}"（第 ${lineOf(starts, top.at)} 行）却遇到 "${c}"`,
          });
          mismatched = true;
          break;
        }
      }
    }
    if (stack.length && !mismatched) {
      const top = stack[stack.length - 1];
      issues.push({
        line: lineOf(starts, top.at),
        sev: "error",
        code: "brace",
        msg: `"${top.ch}" 没有闭合（缺 ${top.ch === "{" ? "}" : top.ch === "(" ? ")" : "]"}）`,
      });
    }
  }

  // 3) R.id.xxx 是否真存在
  const ids = opts.ids ? new Set(Array.from(opts.ids)) : null;
  if (ids && ids.size) {
    const seen = new Set<string>();
    for (const m of masked.code.matchAll(/\bR\s*\.\s*id\s*\.\s*([A-Za-z_]\w*)/g)) {
      const name = m[1];
      if (ids.has(name) || seen.has(name)) continue;
      seen.add(name);
      issues.push({
        line: lineOf(starts, m.index || 0),
        sev: "warn",
        code: "rid",
        msg: `R.id.${name} 在项目布局里不存在（拼错？或者还没在 xml 里声明 @+id/${name}）`,
      });
    }
  }

  // 4) 常见类没 import
  const imports = new Set<string>();
  for (const m of masked.code.matchAll(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;?/gm)) {
    const fq = m[1];
    imports.add(fq);
    imports.add(fq.slice(fq.lastIndexOf(".") + 1));
  }
  const pkg = /^\s*package\s+([\w.]+)/m.exec(masked.code)?.[1] || "";
  const allow = new Set(opts.allowNames ? Array.from(opts.allowNames) : []);
  // 本文件自己声明的类/接口/枚举不算缺 import
  for (const m of masked.code.matchAll(/\b(?:class|interface|enum|record)\s+([A-Z]\w*)/g)) allow.add(m[1]);
  for (const [simple, fq] of Object.entries(COMMON_IMPORTS)) {
    if (imports.has(simple) || allow.has(simple)) continue;
    if (fq.startsWith(pkg + ".") && pkg) continue;
    const re = new RegExp(`\\b${simple}\\b`);
    if (!re.test(masked.code)) continue;
    // 只当类型用（后面跟变量名/泛型/括号）才算，避免撞上同名变量
    const used = new RegExp(`\\b${simple}\\s*(?:<|\\[|\\.|\\(|\\s+[a-z_]\\w*\\s*[=;,)]|\\s+[a-z_]\\w*\\s*:)`);
    if (!used.test(masked.code)) continue;
    issues.push({
      line: 1,
      sev: "warn",
      code: "import",
      msg: `用到 ${simple} 但没 import（应加 import ${fq};）`,
    });
  }

  // 5) @Override 后面要跟方法声明
  if (!opts.isKotlin) {
    const lines = masked.code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/@Override\b/.test(lines[i])) continue;
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith("@"))) j++;
      const next = lines[j] || "";
      if (!/\(/.test(next) && !/\b(class|interface|enum)\b/.test(next)) {
        issues.push({
          line: i + 1,
          sev: "warn",
          code: "override",
          msg: "@Override 后面没有紧跟方法声明（多写了一个 @Override？）",
        });
      }
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

/** 人话输出。永远带「未编译验证」声明 —— 不要让模型以为这是编译结果。 */
export function formatJavaLint(issues: JavaLintIssue[], label = "这段代码"): string {
  const head = "（静态检查，未编译验证 —— 不保证能编译通过，最终请以 gradle 构建为准）";
  if (!issues.length) {
    return `${label}没查出明显问题 ${head}`;
  }
  const errs = issues.filter((i) => i.sev === "error");
  const warns = issues.filter((i) => i.sev === "warn");
  const parts: string[] = [`${label}查出 ${errs.length} 个错误、${warns.length} 个可疑点 ${head}`];
  for (const i of issues) {
    parts.push(`- ${i.sev === "error" ? "错误" : "注意"} L${i.line}：${i.msg}`);
  }
  if (errs.length) parts.push("先修错误，再处理注意项；改完记得把整处逻辑再过一遍。");
  return parts.join("\n");
}
