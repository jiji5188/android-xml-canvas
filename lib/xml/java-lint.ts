// lib/xml/java-lint.ts - M70(C2):Java/Kotlin 轻量静态检查
//
// 不指望在这里做真正的编译:目标是「明显会编译不过的东西别直接甩给用户」。
// 检查项(全部本地、无依赖、够快):
//   1. 括号/花括号/方括号不平衡(带开括号所在行)
//   2. 字符串/字符字面量没闭合(会连带整段后续代码判错,所以优先报这个)
//   3. R.id.xxx 在项目 layout 里不存在(拼错 id 的最高频来源)
//   4. 用了常见类但没 import(Intent / Toast / Bundle / TextView ...)
//   5. @Override 后面跟的不是方法声明
// 结果分 error / warn 两档;formatJavaLint 固定带「未编译验证」声明,避免模型谎称编译通过。

export type JavaLintSeverity = "error" | "warn";

import { TAG_TO_CLASS, isAssignableTo } from "./java-res-env";
import { findMethodTypos } from "./java-methods";
import { nearestName } from "./nearest-name";
import { extractJavaSymbols, findUnknownSymbols } from "./java-symbols";
import { findAssignMismatches } from "./java-assign";
import { findCaseMismatches } from "./java-case";

// M179:输出侧复用了这个方法(XML 资源引用检查也用),从 shared 模块 re-export 兼容旧引用
export { nearestName };

export interface JavaLintIssue {
  /** 1 起行号 */
  line: number;
  /** M202:1 起列号(编辑器精确下划线用) */
  col?: number;
  /** M202:下划线长度(默认 1) */
  len?: number;
  sev: JavaLintSeverity;
  /** 机器可读的小标记,方便测试与后续分组 */
  code:
    | "brace"
    | "quote"
    | "rid"
    | "import"
    | "override"
    | "rtype"
    | "ridtype"
    | "method"
    | "sym"
    | "return"
    | "dup"
    | "voidret"
    | "assign"
    | "unusedimport"
    | "case";
  msg: string;
  /** M179:能自动修复时给出 from → to */
  fix?: { from: string; to: string };
}

export interface JavaLintOpts {
  isKotlin?: boolean;
  /** 项目里真实存在的 id 名(不含 @+id/ 前缀)。传了才查 R.id */
  ids?: Iterable<string>;
  /** M177:项目里各类资源名。传了对应类型才查 R.string / R.layout / R.drawable ... */
  res?: {
    layout?: Iterable<string>;
    string?: Iterable<string>;
    drawable?: Iterable<string>;
    color?: Iterable<string>;
    dimen?: Iterable<string>;
    mipmap?: Iterable<string>;
    style?: Iterable<string>;
  };
  /** M177:id → 控件标签(TextView...),用于 findViewById 赋值类型校验 */
  idTag?: Record<string, string>;
  /** 允许「用了但不 import」的名字(同包类、内部类) */
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
  /** 与原文等长:注释与字符串内容替换成空格(保留换行),用于结构检查 */
  code: string;
  /** 逐字符是否落在字符串/字符字面量里 */
  inStr: boolean[];
  /** M98:文件结束时仍未闭合的字面量起始偏移(null = 都闭合了) */
  openAt: number | null;
}

/** 把注释和字面量内容抹成空格,保持偏移量与行号不变
 *
 * M98:以前只认 `"` / `'` / `//` / `/* *\/`,三种真实写法会被当成代码,
 * 于是里面的括号被拿去配对 → 误报「括号不配对」:
 *   1. Java 文本块 `"""..."""`(内容里的 " 会提前结束掩码)
 *   2. Kotlin 原始字符串 `"""..."""`(`"""{"a":1}"""` 这种 JSON 模板最典型)
 *   3. Kotlin 字符串模板 `"${map["k"]}"`(内层引号会把外层提前关掉)
 * 现在用状态栈处理:raw(三引号)、tpl(`${...}` 模板嵌套)。
 */
function mask(src: string, isKotlin = false): Masked {
  const out: string[] = [];
  const inStr: boolean[] = [];
  let i = 0;
  type St = "code" | "line" | "block" | "str" | "char" | "raw" | "tpl";
  const stack: { st: St; quote?: string; depth?: number; at?: number }[] = [];
  const top = () => stack[stack.length - 1];
  stack.push({ st: "code" });
  /** 按原文长度占位:换行保留换行,其余变空格 */
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
      // 三引号:Java 文本块 / Kotlin 原始字符串
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
      // 闭合三引号。Java 文本块里 `\` 仍会转义,Kotlin 原始字符串完全不转义
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

    // tpl:Kotlin 字符串模板 `${...}`,里面还能再套字符串和花括号
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
          // 模板结束,回到外层字符串
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
      // 转义:`\"` / `\'` / `\\` 都把后一个字符一起吞掉
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
      // Java 不允许裸换行的字符串字面量(Kotlin 原始字符串走 raw,不来这里)
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
  /** M202:偏移 → 1 起列号(供编辑器画精确下划线) */
  const colOf = (offset: number): number => offset - starts[lineOf(starts, offset) - 1] + 1;

  // 1) 字面量没闭合(先查,否则后面括号检查全是噪音)
  //    M98:改成看 mask 的结束状态 -- 以前靠 inStr 扫一遍,遇到文件末尾正好是 "abc" 会误报
  const lastQuoteLine = masked.openAt === null ? 0 : lineOf(starts, masked.openAt);
  if (lastQuoteLine) {
    issues.push({
      line: lastQuoteLine,
      col: masked.openAt !== null ? colOf(masked.openAt) : undefined,
      len: 1,
      sev: "error",
      code: "quote",
      msg: "字符串或字符字面量没有闭合(少了收尾的引号)",
    });
  }

  // 2) 括号平衡。字面量没闭合时跳过,避免误导
  if (!lastQuoteLine) {
    const stack: { ch: string; at: number }[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    /** M98:已经报过「不配对」就不再补一条「没闭合」-- 同一个错报两次最像误报 */
    let mismatched = false;
    for (let i = 0; i < masked.code.length; i++) {
      const c = masked.code[i];
      if (c === "(" || c === "[" || c === "{") stack.push({ ch: c, at: i });
      else if (c === ")" || c === "]" || c === "}") {
        const top = stack.pop();
        if (!top) {
          issues.push({
            line: lineOf(starts, i),
            col: colOf(i),
            len: 1,
            sev: "error",
            code: "brace",
            msg: `多余的 "${c}":前面没有对应的开括号`,
          });
          mismatched = true;
          break;
        }
        if (top.ch !== pairs[c]) {
          issues.push({
            line: lineOf(starts, top.at),
            col: colOf(top.at),
            len: 1,
            sev: "error",
            code: "brace",
            msg: `括号不配对:"${top.ch}"(第 ${lineOf(starts, top.at)} 行)却遇到 "${c}"`,
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
        col: colOf(top.at),
        len: 1,
        sev: "error",
        code: "brace",
        msg: `"${top.ch}" 没有闭合(缺 ${top.ch === "{" ? "}" : top.ch === "(" ? ")" : "]"})`,
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
      const sug = nearestName(name, ids);
      issues.push({
        line: lineOf(starts, m.index || 0),
        col: colOf(m.index || 0),
        len: m[0].length,
        sev: "warn",
        code: "rid",
        msg: `R.id.${name} 在项目布局里不存在（拼错？或者还没在 xml 里声明 @+id/${name}）${sug ? `（是不是想写 ${sug}）` : ""}`,
        fix: sug ? { from: `R.id.${name}`, to: `R.id.${sug}` } : undefined,
      });
    }
  }

  // 3b) M177:R.string / R.layout / R.drawable / R.color / R.dimen / R.mipmap / R.style 是否真存在
  const RES_KINDS = ["layout", "string", "drawable", "color", "dimen", "mipmap", "style"] as const;
  const RES_LABEL: Record<string, string> = {
    layout: "布局",
    string: "字符串",
    drawable: "图片/drawable",
    color: "颜色",
    dimen: "尺寸",
    mipmap: "启动图标",
    style: "样式",
  };
  for (const kind of RES_KINDS) {
    const given = opts.res?.[kind];
    if (!given) continue;
    const set = new Set(Array.from(given));
    if (!set.size) continue;
    const seen = new Set<string>();
    for (const m of masked.code.matchAll(new RegExp(`\\bR\\s*\\.\\s*${kind}\\s*\\.\\s*([A-Za-z_]\\w*)`, "g"))) {
      const name = m[1];
      if (set.has(name) || seen.has(name)) continue;
      seen.add(name);
      const sug = nearestName(name, set);
      issues.push({
        line: lineOf(starts, m.index || 0),
        col: colOf(m.index || 0),
        len: m[0].length,
        sev: "warn",
        code: "rtype",
        msg: `R.${kind}.${name} 不存在（项目里没有这个${RES_LABEL[kind]}资源，检查拼写或资源名）${sug ? `（是不是想写 ${sug}）` : ""}`,
        fix: sug ? { from: `R.${kind}.${name}`, to: `R.${kind}.${sug}` } : undefined,
      });
    }
  }

  // 3c) M177:findViewById 的赋值类型与布局里的控件对不上
  const idTag = opts.idTag && Object.keys(opts.idTag).length ? opts.idTag : null;
  if (idTag) {
    for (const m of masked.code.matchAll(/\b([A-Z]\w*)\s+([a-z_]\w*)\s*=\s*(?:\([^()]*?\)\s*)?[\w.]*?findViewById\s*\(\s*R\s*\.\s*id\s*\.\s*([A-Za-z_]\w*)\s*\)/g)) {
      const declType = m[1];
      const idName = m[3];
      const actual = idTag[idName];
      if (!actual) continue;
      const want = TAG_TO_CLASS[actual];
      if (!want) continue;
      if (isAssignableTo(want, declType)) continue;
      // M202：下划线圈在 findViewById 里的 R.id.xxx 上（而不是整行）
      const rPart = /R\s*\.\s*id\s*\.\s*[A-Za-z_]\w*/.exec(m[0]);
      const rOff = rPart ? m[0].indexOf(rPart[0]) : 0;
      issues.push({
        line: lineOf(starts, m.index || 0),
        col: rPart ? colOf((m.index || 0) + rOff) : undefined,
        len: rPart ? rPart[0].length : undefined,
        sev: "warn",
        code: "ridtype",
        msg: `findViewById(R.id.${idName}) 拿到的是 ${actual}(${want}),赋给 ${declType} 会 ClassCastException`,
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
    // 只当类型用(后面跟变量名/泛型/括号)才算,避免撞上同名变量
    const used = new RegExp(`\\b${simple}\\s*(?:<|\\[|\\.|\\(|\\s+[a-z_]\\w*\\s*[=;,)]|\\s+[a-z_]\\w*\\s*:)`);
    const usedM = used.exec(masked.code);
    if (!usedM) continue;
    issues.push({
      line: lineOf(starts, usedM.index),
      col: colOf(usedM.index),
      len: simple.length,
      sev: "warn",
      code: "import",
      msg: `用到 ${simple} 但没 import(应加 import ${fq};)`,
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
        const at = lines[i].indexOf("@Override");
        issues.push({
          line: i + 1,
          col: at >= 0 ? at + 1 : 1,
          len: at >= 0 ? "@Override".length : 1,
          sev: "warn",
          code: "override",
          msg: "@Override 后面没有紧跟方法声明(多写了一个 @Override?)",
        });
      }
    }
  }

  // 6) M178:方法名拼错(setTxt → setText)
  if (!opts.isKotlin) {
    for (const t of findMethodTypos(masked.code)) {
      issues.push({
        line: t.line,
        col: t.col,
        len: t.name.length,
        sev: "warn",
        code: "method",
        msg: `没有 ${t.name}() 这个方法,是不是想写 ${t.suggestion}()?`,
        fix: { from: t.name, to: t.suggestion },
      });
    }
  }

  // 7) M203：未声明的标识符（本类没字段/参数/局部变量、不是方法名、不是关键字、不是已知类）
  {
    const sy = extractJavaSymbols(text, !!opts.isKotlin);
    // 保守：只有看到「类体/构造器结构」才启用，避免方法体片段（看不到类字段）误报
    const hasClassStructure =
      /\bclass\s+[A-Z]/.test(text) || /^\s*(?:public|private|protected)?\s*[A-Z]\w*\s*\(/m.test(text);
    if (hasClassStructure && sy.declared.size + sy.methods.size > 0) {
      // 已知类型名：import 的简单名 + 常见类简单名 + 本类自己声明的类型（字段/参数类型里的首字母大写词）
      const knownTypes = new Set<string>();
      for (const m of masked.code.matchAll(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;?/gm)) {
        const fq = m[1];
        knownTypes.add(fq.slice(fq.lastIndexOf(".") + 1));
      }
      for (const simple of Object.keys(COMMON_IMPORTS)) knownTypes.add(simple);
      // 泛型/基本类型名（int/String/List/... 出现在声明里的）
      for (const m of masked.code.matchAll(/\b([A-Z]\w*)\s+(?:[a-z_]\w*)\s*[=;:)]/g)) knownTypes.add(m[1]);
      const starts2 = starts; // 复用上面算的
      const unknowns = findUnknownSymbols(masked.code, sy, knownTypes, starts2);
      const reported = new Set<string>();
      for (const u of unknowns) {
        if (reported.has(u.name)) continue; // 同名只报一次（最高频来源）
        reported.add(u.name);
        const sug = nearestName(u.name, Array.from(sy.declared).filter((d) => d[0] === d[0].toLowerCase()));
        issues.push({
          line: u.line,
          col: u.col,
          len: u.len,
          sev: "error",
          code: "sym",
          msg: `用了 ${u.name} 但本类没声明（不是字段/参数/局部变量/方法，也不是已 import 的类）${sug ? `（是不是想写 ${sug}）` : "（打错字？还是忘声明？）"}`,
        });
      }
    }
  }

  // 8) M204：控制流类硬错（return 路径缺失 / void 带 return 值 / 同名重复定义）
  {
    const sy = extractJavaSymbols(text, !!opts.isKotlin);
    const lines = text.split("\n");
    // 逐行找方法签名（带返回类型、方法名、是否 void、行号）
    const sigRe = /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:[\w.<>\[\],\s]+?\s)?([a-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?[;{]/gm;
    // 找所有方法的 [sigLine, name, isVoid, bodyOpenPos]
    const methods: { sig: number; name: string; isVoid: boolean; retType: string }[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sigRe.exec(masked.code))) {
      const fullSig = sm[0];
      const isVoid = /\bvoid\b/.test(fullSig) || /\svoid\s*\(/.test(fullSig);
      const retTypeM = fullSig.match(/(?:[\w.<>\[\],\s]+?\s)?(void|\w+(?:<[^>()]*>)?(?:\[\s*\])*)\s+\w+\s*\(/);
      methods.push({
        sig: masked.code.slice(0, sm.index).split("\n").length, // 1 基行号
        name: sm[1],
        isVoid,
        retType: retTypeM ? retTypeM[1] : "",
      });
    }

    // 8a) void 方法却带了 return <值>（return 后面跟了表达式）
    for (const md of methods) {
      if (!md.isVoid) continue; // 只查 void 方法
      const off = smOffset(masked.code, md.sig);
      const bodyStart = masked.code.indexOf("{", off);
      if (bodyStart < 0) continue;
      const bodyChunk = masked.code.slice(bodyStart, bodyStart + 600);
      // 找 `return <非空>;`（return 后跟了值，而非 `return;`）
      const retValM = /return\s+([^;\n\[\s][^;\n]*|[^;\n\s][^;\n]*);/.exec(bodyChunk);
      if (retValM) {
        const lineInChunk = bodyChunk.slice(0, retValM.index).split("\n").length;
        const rl = md.sig + lineInChunk - 1;
        const allLines = masked.code.split("\n");
        const thatLine = allLines[rl - 1] || "";
        const retIdx = thatLine.indexOf("return");
        issues.push({
          line: rl,
          col: retIdx + 1,
          len: thatLine.length - retIdx || 1,
          sev: "error",
          code: "voidret",
          msg: `void 方法 ${md.name}() 不能 return 值（写了 return ${retValM[1].trim()};）`,
        });
      }
    }

    // 8b) 非 void 方法没有 return 路径（方法体里找 `return` / `throw`）
    for (const md of methods) {
      if (md.isVoid) continue; // 只查非 void
      if (!md.retType) continue; // 构造器/解析不到返回类型的，跳过（避免误报）
      const off = smOffset(masked.code, md.sig);
      if (off < 0) continue;
      let depth = 0,
        i = 0,
        end = -1;
      const bStart = masked.code.indexOf("{", off);
      if (bStart < 0) continue;
      for (i = bStart; i < masked.code.length; i++) {
        const ch = masked.code[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) continue;
      const body = masked.code.slice(bStart, end + 1);
      if (!/\breturn\b/.test(body) && !/\bthrow\b/.test(body)) {
        issues.push({
          line: md.sig,
          col: (masked.code.slice(off).split("\n")[0] || "").indexOf(md.name) + 1,
          len: md.name.length,
          sev: "error",
          code: "return",
          msg: `${md.name}() 返回类型是 ${md.retType}，但方法体里没有 return / throw（所有路径都要返回值）`,
        });
      }
    }

    // 8c) 同名重复定义（两个方法/字段同名同参）—— 保守：只查字段重复
    {
      const fieldNames = new Map<string, number>(); // name → 第一次出现的行号
      const fieldRe2 = /^\s*(?:(?:public|private|protected|static|final|transient|volatile)\s+)*([A-Za-z_]\w*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe2.exec(masked.code))) {
        const name = fm[2];
        const ln = masked.code.slice(0, fm.index).split("\n").length;
        if (fieldNames.has(name)) {
          issues.push({
            line: ln,
            col: 1,
            len: name.length,
            sev: "error",
            code: "dup",
            msg: `字段 ${name} 重复定义（前面第 ${fieldNames.get(name)} 行已声明过）`,
          });
        } else fieldNames.set(name, ln);
      }
    }
  }

  /** 取 1 基行号对应的文本偏移（简化：从头数换行） */
  function smOffset(code: string, line1: number): number {
    if (line1 <= 1) return 0;
    let off = 0;
    let ln = 1;
    while (ln < line1 && off < code.length) {
      const nl = code.indexOf("\n", off + 1);
      if (nl < 0) break;
      off = nl;
      ln++;
    }
    return off + 1;
  }

  // 9) M205：赋值类型不匹配（int x = "abc" / int z = 1.5 / String s = 123 这类硬冲突）
  // 注意用原始 text（不 masked）—— 要看字符串字面量才能判 int x = "abc" 这种冲突
  {
    for (const a of findAssignMismatches(text)) {
      issues.push({
        line: a.line,
        col: a.col,
        len: a.len,
        sev: "error",
        code: "assign",
        msg: `类型不匹配：左边声明为 ${a.declared}，右边是 ${a.actual}`,
      });
    }
  }

  // 10) M205：import 了但没用到的类（warn 级，不算编译错，只是冗余）
  {
    const usedTypes = new Set<string>();
    // 正文里出现的首字母大写单词 = 用到的类型（粗略但够用）
    const noImport = text
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l))
      .join("\n");
    for (const m of noImport.matchAll(/\b([A-Z]\w*)\b/g)) usedTypes.add(m[1]);
    // 逐条 import 行（带行号 + 简单名）
    const importLines: { line: number; simple: string; fq: string }[] = [];
    const tLines = text.split("\n");
    for (let i = 0; i < tLines.length; i++) {
      const m = /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;?/.exec(tLines[i]);
      if (m) importLines.push({ line: i + 1, simple: m[1].slice(m[1].lastIndexOf(".") + 1), fq: m[1] });
    }
    for (const im of importLines) {
      if (im.simple === "" || im.simple === "*") continue; // 通配 import 不查
      if (!usedTypes.has(im.simple)) {
        issues.push({
          line: im.line,
          col: 1,
          len: im.fq.length,
          sev: "warn",
          code: "unusedimport",
          msg: `import 了 ${im.fq} 但代码里没用过（可以删掉）`,
        });
      }
    }
  }

  // 11) M206：大小写写错（Java/Kotlin 区分大小写）——string→String、toast→Toast、settext→setText
  {
    const declaredNames = new Set<string>();
    for (const m of text.matchAll(/\b(?:class|interface|enum|record)\s+([A-Z]\w*)/g)) declaredNames.add(m[1]);
    for (const m of text.matchAll(/\b[A-Za-z_][\w<>\[\]]*\s+([a-z_]\w*)\s*\(/g)) declaredNames.add(m[1]);
    for (const c of findCaseMismatches(text, declaredNames)) {
      issues.push({
        line: c.line,
        col: c.col,
        len: c.len,
        sev: "error",
        code: "case",
        msg:
          c.kind === "type"
            ? `大小写写错了：${c.written} → ${c.correct}（Java/Kotlin 区分大小写，类型名首字母要大写）`
            : `大小写写错了：${c.written} → ${c.correct}（Java/Kotlin 区分大小写法名，驼峰要正确）`,
      });
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

/** 人话输出。永远带「未编译验证」声明 -- 不要让模型以为这是编译结果。 */
export function formatJavaLint(issues: JavaLintIssue[], label = "这段代码"): string {
  const head = "(静态检查,未编译验证 -- 不保证能编译通过,最终请以 gradle 构建为准)";
  if (!issues.length) {
    return `${label}没查出明显问题 ${head}`;
  }
  const errs = issues.filter((i) => i.sev === "error");
  const warns = issues.filter((i) => i.sev === "warn");
  const parts: string[] = [`${label}查出 ${errs.length} 个错误、${warns.length} 个可疑点 ${head}`];
  for (const i of issues) {
    parts.push(`- ${i.sev === "error" ? "错误" : "注意"} L${i.line}:${i.msg}`);
  }
  if (errs.length) parts.push("先修错误,再处理注意项;改完记得把整处逻辑再过一遍。");
  return parts.join("\n");
}
