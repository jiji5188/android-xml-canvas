// lib/xml/java-symbols.ts - M203：Java 类的轻量"符号表"
//
// 目标：不编译、纯文本，给 lint 提供"这个类自己声明了什么"，
// 让"用了未声明的标识符"这条检查有依据（而不是猜）。
//
// 读五类符号：
//   1. 类字段：`private int x;` / `public String title;` / `static final int N = 3;`
//   2. 构造器参数：`SubmitData(String title, String action, List<String> data, boolean isRt)`
//   3. 方法参数：`void f(int a, String b)`
//   4. 局部变量：方法体内 `int a = 0;` / `for (int i=0; ...)` / `String s = ...`
//   5. 本类方法名：`void doX() {}` / `int getFoo() {`
//
// 返回一个 Set，调用方（lint）用它判断"标识符 X 是否本类已知"。
// Kotlin 差异：`val x = 0` / `var y: Int = 0` / 无参数类型标注（`fun f(a: Int)`）
// 这里先做 Java；Kotlin 用 `isKotlin` 标志走宽松路径。

export interface JavaSymbols {
  /** 所有已声明标识符（字段+参数+局部变量+方法名+构造参数），用于"未声明"判断 */
  declared: Set<string>;
  /** 本类方法名（`this.method()` 调用不算未知） */
  methods: Set<string>;
}

const JAVA_KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double else " +
    "enum extends final finally float for goto if implements import instanceof int interface long " +
    "native new package private protected public return short static strictfp super switch " +
    "synchronized this throw throws transient try void volatile while " +
    // M205d：字面量不是标识符（之前报「用了 null/true/false 但没声明」）
    "null true false"
  ).split(/\s+/),
);

/** 类型名（含泛型/数组）—— 用来从声明里抠出"被声明的变量名" */
const TYPE_RE =
  // 类型：可带泛型 <...>、数组 []、嵌套点号；变量名：下划线/数字
  /(?:[A-Z]\w*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*\s+|[A-Za-z_]\w*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*\s+)?([a-z_]\w*)/;

function collectDeclaredFromParams(paramText: string, out: Set<string>, isKotlin = false) {
  const parts = splitTopLevel(paramText, ",");
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    if (isKotlin) {
      // Kotlin: name: Type → 取冒号前最后词
      const colon = p.indexOf(":");
      const left = (colon >= 0 ? p.slice(0, colon) : p).trim();
      const m2 = left.match(/([a-zA-Z_$]\w*)\s*$/);
      if (m2) out.add(m2[1]);
    } else {
      // Java: Type name → 取最后词（跳过类型）
      p = p.replace(/^final\s+/, "");
      const m = p.match(/([a-zA-Z_$]\w*)\s*$/);
      if (m) out.add(m[1]);
    }
  }
}

/** 按顶层逗号切分（<>/[]/() 里的逗号不当切割点） */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "[" || ch === "(") depth++;
    else if (ch === ">" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function extractJavaSymbols(src: string, isKotlin = false): JavaSymbols {
  const declared = new Set<string>();
  const methods = new Set<string>();
  if (!src || !src.trim()) return { declared, methods };

  if (isKotlin) {
    // Kotlin：val/var 属性 + fun 参数 + 方法名
    for (const m of src.matchAll(/\b(?:val|var)\s+([a-z_]\w*)/g)) declared.add(m[1]);
    for (const m of src.matchAll(/\bfun\s+(?:\w+\s+)?([a-zA-Z_$]\w*)\s*\(([^)]*)\)/g)) {
      methods.add(m[1]);
      collectDeclaredFromParams(m[2] || "", declared, true);
    }
    // M207：Kotlin lambda 隐式参数 `it`（forEach { it } 最常见），否则必误报
    if (/\bit\b/.test(src)) declared.add("it");
    // `{ x -> ... }` / `{ a, b -> ... }` 显式 lambda 参数
    for (const m of src.matchAll(/\{\s*([a-z_]\w*(?:\s*,\s*[a-z_]\w*)*)\s*->/g)) {
      for (const p of (m[1] || "").split(",")) {
        const t = p.trim();
        if (t) declared.add(t);
      }
    }
    return { declared, methods };
  }

  // ===== Java 路径 =====

  // 1) 字段声明（类体里、方法外的 `修饰 类型 名;`）。用正则抓行首修饰 + 分号结尾的整行。
  const fieldRe =
    /^\s*(?:(?:public|private|protected|static|final|transient|volatile)\s+)*([A-Z]\w*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*|[a-z_]\w*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_]\w*)\s*(?:=|;)/gm;
  for (const m of src.matchAll(fieldRe)) {
    // 排除明显是方法签名的（方法签名不会以 ; 结尾且会有 ( )）
    const line = m[0];
    if (/^\s*(?:public|private|protected|static|final|transient|volatile)\s*$/.test(line)) continue;
    declared.add(m[2]);
  }

  // 2) 构造器 / 方法参数
  // 构造器：`Name(Type a, Type b) {`（类名 = 构造器名，首字母大写）
  const ctorRe = /^\s*(?:public|private|protected)?\s*([A-Z]\w*)\s*\(([^)]*)\)/m;
  const ctorM = ctorRe.exec(src);
  if (ctorM) collectDeclaredFromParams(ctorM[2], declared);

  // 方法参数：`returnType name(params) {` 或 `abstract ... name(params);`
  const methodSigRe =
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:[\w.<>\[\],\s]+?\s)?([a-z_]\w*)\s*\(([^)]*)\)\s*[{;]/gm;
  for (const m of src.matchAll(methodSigRe)) {
    methods.add(m[1]);
    collectDeclaredFromParams(m[2] || "", declared);
  }

  // 4) 局部变量（方法体内 `int a = 0;` / `for (int i=0; ...)`）
  const localRe = /(?<!\w)(?:int|long|double|float|char|boolean|byte|short|String|[A-Z]\w*(?:<[^>()]*>)?|[A-Z]\w*\[\])\s+([a-z_]\w*)\s*(=|[;,(])/g;
  for (const m of src.matchAll(localRe)) declared.add(m[1]);

  // 4b) M203b: catch (Exception e) → e
  for (const m of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) collectDeclaredFromParams(m[1] || "", declared);

  // 4c) M203b: 增强 for `for (String s : list)` → s
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:final\s+)?[A-Za-z_][\w.<>\[\]]*\s+([a-z_]\w*)\s*:/g)) {
    declared.add(m[1]);
  }

  // 4d) M203b: lambda 参数 `v -> ...` / `(a, b) -> ...`
  for (const m of src.matchAll(/\(\s*([a-z_]\w*(?:\s*,\s*[a-z_]\w*)*)\s*\)\s*->/g)) {
    for (const p of (m[1] || "").split(",")) {
      const t = p.trim();
      if (t) declared.add(t);
    }
  }
  for (const m of src.matchAll(/(?:^|[^\w.])([a-z_]\w*)\s*->/g)) declared.add(m[1]);

  // 4e) M203b: 泛型类型变量 `<T>` / `<T, R>`
  for (const m of src.matchAll(/<\s*([A-Z]\w*(?:\s*,\s*[A-Z]\w*)*)\s*>/g)) {
    for (const p of (m[1] || "").split(",")) {
      const t = p.trim();
      if (t) declared.add(t);
    }
  }

  // `this.xxx` / `super.xxx` 字段（补全 this 引用的字段名）
  for (const m of src.matchAll(/(?:this|super)\.([a-z_]\w*)/g)) declared.add(m[1]);

  // 5) 把关键字排除掉（字段正则可能误抓 `int` 当变量名等）
  for (const k of JAVA_KEYWORDS) declared.delete(k);

  return { declared, methods };
}

/**
 * 在"已知符号表"前提下，找出语句里出现但**未声明、不是关键字、不是方法名、不是 import 的类名**的标识符。
 * 返回 [{ name, line, col }] 供 lint 精确下划线。
 *
 * 规则（保守，优先避免误报）：
 *   - 只在"表达式语句"行里查（`x==y;` / `x=y;` / 裸 `x;`）
 *   - 跳过 `new Type(...)` / `Type name = ...` 里的类型名（类型不算"用的变量"）
 *   - 跳过方法调用 `obj.method()` 里的 obj（可能是参数/字段传进来的，宽松）
 *   - 字符串/注释已被 mask，不会进来
 */
export interface UnknownSymbol {
  name: string;
  line: number;
  /** 1 起列号 */
  col: number;
  /** 长度 */
  len: number;
}

export function findUnknownSymbols(
  maskedCode: string,
  symbols: JavaSymbols,
  knownTypes: Set<string>,
  starts: number[],
): UnknownSymbol[] {
  const out: UnknownSymbol[] = [];
  const lines = maskedCode.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // 只考虑"表达式语句"——末尾是 ; 且整行不是控制流/注解/声明
    const trimmed = ln.trim();
    if (!/;/.test(trimmed)) continue;
    // 跳过 import / package / 注解 / 控制流 / 方法签名 / 字段声明
    if (/^\s*(import|package|@|public\s|private\s|protected\s|static\s|final\s|class\s|interface\s|enum\s|void\s|\w+\s+\w+\s*\()/m.test(
      trimmed,
    ))
      continue;
    // 跳过 new Type() 的构造行
    const rowTokens = /(^|[^\w$])([A-Za-z_$][\w$]*)/g;
    let tm: RegExpExecArray | null;
    while ((tm = rowTokens.exec(ln))) {
      const name = tm[2];
      const prefix = tm[1];
      const col = (tm.index || 0) + (prefix ? prefix.length : 0) + 1;
      const before = ln.slice(0, tm.index + (prefix ? prefix.length : 0));
      const afterIdx = tm.index + (prefix ? prefix.length : 0) + name.length;
      // 跳过 new 后面的类型
      if (prefix?.trimEnd().endsWith("new")) continue;
      // M203b：成员访问（前面是 .）不算变量——`Build.VERSION.SDK_INT` 的 VERSION/SDK_INT
      if (before.trimEnd().endsWith(".")) continue;
      // M203b：大写开头按 Java 习惯是类型/常量，不当变量报（dsdxvbb/lhh4 是小写，仍会抓）
      if (/^[A-Z]/.test(name)) continue;
      if (symbols.declared.has(name)) continue;
      if (symbols.methods.has(name)) continue;
      if (knownTypes.has(name)) continue;
      if (JAVA_KEYWORDS.has(name)) continue;
      // 跳过方法调用接收者：`name(` 或 `name.` 后面跟 ( / .
      const rest = ln.slice(afterIdx);
      if (/^\s*\(/.test(rest) || /^\s*\./.test(rest)) {
        // 方法调用/属性访问的接收者——宽松跳过（避免误报）
        continue;
      }
      // M203b：`name:` 是标签/case，`name[])` 等跳过
      if (/^\s*:/.test(rest)) continue;
      // M203b：注解 @name
      if (before.trimEnd().endsWith("@")) continue;
      // 跳过赋值左边 `x =`（x 没声明才报，但赋值左边的裸标识符基本就是 bug，保留报）
      out.push({ name, line: i + 1, col, len: name.length });
    }
  }
  return out;
}
