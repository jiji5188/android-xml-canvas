// lib/xml/doc-symbol-types.ts — M441：从当前文档里抽出「变量类型 / 方法返回类型 / 类全限定名」
//
// 目的（用户要求）：候选词弹窗的说明行不再只写签名/修饰符，还要能看出「这是什么东西」：
//   - 变量 → 它的声明类型（TextView / int / List<String>…）
//   - 方法 → 它的返回类型（有返回值才写，void/Unit 不写）
//   - 类   → 完整类名（android.widget.TextView）
//
// 定位：跟 java-symbols / lexicon 一致 —— 纯文本近似，不编译、不做类型推导。
// 宁可给不出（返回 undefined，UI 就只显示原说明），也不给错。
//
// 纯逻辑，Node / 浏览器都能跑。

export interface DocVarDecl {
  /** 声明类型（raw 简名，如 TextView / int / List） */
  type: string;
  /** 声明位置（文档绝对偏移），用于「离光标最近、且在光标之前」的优先 */
  pos: number;
}

export interface DocSymbolTypes {
  /** 变量名 → 声明列表（同名的多次声明都留着，按位置择优） */
  vars: Map<string, DocVarDecl[]>;
  /** 方法名 → 返回类型（raw 简名；void / Unit / Nothing 不收） */
  rets: Map<string, string>;
  /** 类名 → 全限定名（来自 import 语句，或本文件 package + 自身类声明） */
  fqns: Map<string, string>;
}

const EMPTY: DocSymbolTypes = { vars: new Map(), rets: new Map(), fqns: new Map() };

/** 把字符串/字符/注释换成空格（保留长度与换行，位置不漂移） */
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
    // str / char
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

/** 泛型嵌套最多两层（Map<String, List<String>>），再深就只取外层 —— 近似即可 */
const GEN = "(?:\\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>)?";
/** 类型：基本类型 / var / 大写开头的类名（可带泛型、数组） */
const TYPE = `(?:int|long|double|float|boolean|char|byte|short|var|void|[A-Z][\\w$]*${GEN}(?:\\s*\\[\\s*\\])*)`;

/** 不是方法名的关键字（`if (` `for (` 之类；TYPE 已过滤小写，这里主要防 `return X(` 之类漏网） */
const NOT_METHOD = new Set([
  "if", "for", "while", "switch", "catch", "synchronized", "return", "new", "else", "do", "try",
  "throw", "assert", "case", "instanceof", "super", "this", "package", "import", "yield",
]);

/** raw 简名：`java.util.List<String>` → `List`；`String[]` → `String` */
export function simpleTypeName(raw: string): string {
  let s = raw.trim();
  const lt = s.indexOf("<");
  if (lt >= 0) s = s.slice(0, lt);
  s = s.replace(/\[\s*\]/g, "").trim();
  const dot = s.lastIndexOf(".");
  if (dot >= 0) s = s.slice(dot + 1);
  return s.trim();
}

function addVar(out: DocSymbolTypes, name: string, type: string, pos: number) {
  if (!name || !type) return;
  const t = simpleTypeName(type);
  if (!t || t === "void" || NOT_METHOD.has(t)) return;
  const arr = out.vars.get(name);
  if (arr) {
    // 同一位置重复命中就跳过（多个正则可能覆盖同一处）
    if (arr.some((d) => d.pos === pos)) return;
    arr.push({ type: t, pos });
  } else out.vars.set(name, [{ type: t, pos }]);
}

function addRet(out: DocSymbolTypes, name: string, raw: string) {
  if (!name || out.rets.has(name)) return;
  const t = simpleTypeName(raw);
  // void / Unit / Nothing = 没有返回值，不显示
  if (!t || t === "void" || t === "Unit" || t === "Nothing" || NOT_METHOD.has(t)) return;
  out.rets.set(name, t);
}

/** 解析 import 语句 + package + 本文件类声明 → 简单名到全限定名 */
function collectFqns(code: string, out: DocSymbolTypes) {
  for (const m of code.matchAll(/^[ \t]*import\s+(?:static\s+)?([\w.]+)\s*;?[ \t]*$/gm)) {
    const fqn = m[1];
    if (!fqn || fqn.endsWith(".*")) continue;
    const segs = fqn.split(".");
    const simple = segs[segs.length - 1];
    if (!simple || !/^[A-Za-z_$][\w$]*$/.test(simple)) continue;
    if (!out.fqns.has(simple)) out.fqns.set(simple, fqn);
  }
  const pkgM = /^[ \t]*package\s+([\w.]+)\s*;?/m.exec(code);
  const pkg = pkgM ? pkgM[1] : "";
  // 本文件声明的类：同包可见，全名 = package + 简单名
  for (const m of code.matchAll(/\b(?:class|interface|enum|record|object)\s+([A-Z][\w$]*)/g)) {
    const name = m[1];
    if (!out.fqns.has(name) && pkg) out.fqns.set(name, `${pkg}.${name}`);
  }
}

/** Kotlin：`val/var name: Type`、参数 `name: Type`、`fun name(...): Type` */
function extractKotlin(code: string, out: DocSymbolTypes) {
  // val/var 属性（显式类型）
  for (const m of code.matchAll(
    /(?<![\w$.])(?:val|var)\s+([a-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$.]*\s*(?:<[^<>]*>)?)/g,
  )) {
    addVar(out, m[1], m[2], m.index!);
  }
  // val x = Foo(...) → 从右侧构造推断
  for (const m of code.matchAll(
    /(?<![\w$.])(?:val|var)\s+([a-z_$][\w$]*)\s*=\s*([A-Z][\w$.]*)\s*(?:<[^<>]*>)?\s*\(/g,
  )) {
    addVar(out, m[1], m[2], m.index!);
  }
  // 参数 / lambda 参数：`(name: Type` / `, name: Type`
  for (const m of code.matchAll(/[(,]\s*([a-z_$][\w$]*)\s*:\s*([A-Z][\w$.]*\s*(?:<[^<>]*>)?)/g)) {
    addVar(out, m[1], m[2], m.index!);
  }
  // fun 返回类型
  for (const m of code.matchAll(
    /\bfun\s+(?:[\w$.]+\.)?([a-z_$][\w$]*)\s*\([^()]*\)\s*:\s*([A-Za-z_$][\w$.]*\s*(?:<[^<>]*>)?)/g,
  )) {
    addRet(out, m[1], m[2]);
  }
}

/** Java：`Type name [=;,:)]` 变量声明 + `Type name(` 方法声明 */
function extractJava(code: string, out: DocSymbolTypes) {
  // 变量 / 字段 / 参数 / catch / for-each（后面紧跟 = ; , : ) 的才算声明）
  const varRe = new RegExp(`(?<![.\\w$])(?:final\\s+)?(${TYPE})\\s+([a-z_$][\\w$]*)\\s*(?=[=;,:)])`, "g");
  for (const m of code.matchAll(varRe)) {
    addVar(out, m[2], m[1], m.index!);
  }
  // 方法声明：`RetType name(`
  const retRe = new RegExp(`(?<![.\\w$])(${TYPE})\\s+([a-z_$][\\w$]*)\\s*\\(`, "g");
  for (const m of code.matchAll(retRe)) {
    if (NOT_METHOD.has(m[2])) continue;
    addRet(out, m[2], m[1]);
  }
}

/**
 * 抽文档内的「变量类型 / 方法返回类型 / 类全名」。
 * isKotlin 为 true 走 Kotlin 规则（`val x: Type`），否则走 Java 规则。
 */
export function extractDocSymbolTypes(doc: string, isKotlin = false): DocSymbolTypes {
  if (!doc || !doc.trim()) return EMPTY;
  const out: DocSymbolTypes = { vars: new Map(), rets: new Map(), fqns: new Map() };
  const code = maskNonCode(doc);
  collectFqns(code, out);
  if (isKotlin) extractKotlin(code, out);
  else extractJava(code, out);
  return out;
}

/**
 * 取「光标处该变量」的类型：优先光标之前最近的声明；都在光标之后（字段写在下面）就取第一个。
 */
export function varTypeAt(t: DocSymbolTypes, name: string, offset: number): string | undefined {
  const arr = t.vars.get(name);
  if (!arr || arr.length === 0) return undefined;
  let best: DocVarDecl | null = null;
  for (const d of arr) {
    if (d.pos <= offset && (!best || d.pos > best.pos)) best = d;
  }
  if (!best) best = arr.reduce((a, b) => (a.pos <= b.pos ? a : b));
  return best.type;
}

/** 方法返回类型（文档内声明的） */
export function retTypeOf(t: DocSymbolTypes, name: string): string | undefined {
  return t.rets.get(name);
}

/** 类全限定名（文档 import / package 里能查到的） */
export function fqnOf(t: DocSymbolTypes, name: string): string | undefined {
  const f = t.fqns.get(name);
  return f && f !== name ? f : undefined;
}
