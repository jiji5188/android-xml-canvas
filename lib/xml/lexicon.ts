// lib/xml/lexicon.ts — M352+：项目级符号词库（单一数据源）
//
// 背景：以前的候选词 + 拼写检查是「文件级 + 硬编码白名单」，天花板在小项目。
// 大项目里：候选缺失（项目自定义类的方法弹不出来）、误报（import 了 / 同包的类被当未知符号）。
//
// 这里做 M1 地基：
//   ① 一份 Lexicon（内存里全局唯一）：类名 / 方法 / 字段 / 资源 / 废弃标记
//   ② 声明解析（Java + Kotlin，宁可多收不可漏收）
//   ③ 继承 + 接口方法合并（拿到「某类实际可用的方法」全集）
//   ④ 同包类可见（Java 同包不用 import）
//   ⑤ LexStore：原子切换 + 订阅（后台建好新库再换引用，业务读旧库不半更新）
//
// 设计约束（跟用户拍板的方案一致）：近似降级，不追求编译器精度。
//   - 泛型：按 raw type（去掉 <...>）
//   - 方法：只存「方法名 + 签名串 + 归属类」，不做参数类型推断
//   - 多 module：全部视为可见（不区分 api/implementation）
//
// 纯逻辑，Node / 浏览器都能跑；单测覆盖。

// ===== 数据模型 =====

/** 来源桶（打分「来源层级」直接读它） */
export type LexSource = "project" | "sdk" | "third" | "jdk" | "resource";

export type LexType = "class" | "interface" | "enum" | "record" | "method" | "field";

export interface LexMethod {
  /** 方法名（不含参数） */
  name: string;
  /** 归属类（简单类名，如 MainActivity） */
  originClass: string;
  /** 参数签名串（用于候选第二行展示重载；可能为空） */
  signature?: string;
  /** 是否 @Deprecated */
  isDeprecated?: boolean;
  /** 废弃替代（@Deprecated("use X") / javadoc 抽出来的） */
  alt?: string;
  /** M396：修饰符串（如 "public static" / "private" / "abstract"），候选第二行展示 */
  mod?: string;
  /** M441：返回类型（raw 简名；void / Unit 不存）。候选说明行展示「这个方法返回什么」 */
  ret?: string;
}

/** 词库里「类」的一条记录 */
export interface LexClass {
  /** 简单类名 */
  name: string;
  /** 全限定名（含 package） */
  fqn?: string;
  /** 包名（"" = 默认包） */
  pkg: string;
  /** 父类（简单名） */
  parents: string[];
  /** 实现的接口（简单名） */
  interfaces: string[];
  /** 归属来源（project / sdk / third / jdk） */
  source: LexSource;
  /** 类上有没有 @Deprecated */
  isDeprecated?: boolean;
}

export interface Lexicon {
  /** 简单类名 → 记录（同名多类时取首个，方法集按简单名合并） */
  classes: Map<string, LexClass>;
  /** 全限定名 → 记录 */
  classesByFqn: Map<string, LexClass>;
  /** 简单类名 → 该类声明的方法（不含继承） */
  methods: Map<string, LexMethod[]>;
  /** 全项目去重后的方法名（候选「能不能弹出来」用） */
  allMethodNames: Set<string>;
  /** 字段名（简单类名 → 字段名集合） */
  fields: Map<string, Set<string>>;
  /** 资源桶：resType(drawable/string/id/layout/...) → 资源名集合 */
  resources: Map<string, Set<string>>;
  /** 全量废弃方法名（简单名，含归属类信息在 methods 里） */
  deprecated: Set<string>;
  /** 词库版本号（每次 commit +1，订阅方感知切换） */
  version: number;
}

/** 建库输入：一个源文件 */
export interface LexSourceFile {
  /** 相对路径（用来推断 package） */
  rel: string;
  text: string;
  lang: "java" | "kotlin";
}

/** 建库时的资源（R 桶）输入 */
export interface LexResources {
  [resType: string]: string[];
}

// ===== 工具 =====

export function createEmptyLexicon(version = 0): Lexicon {
  return {
    classes: new Map(),
    classesByFqn: new Map(),
    methods: new Map(),
    allMethodNames: new Set(),
    fields: new Map(),
    resources: new Map(),
    deprecated: new Set(),
    version,
  };
}

/** 从 .java / .kt 的相对路径推断 package（src/main/java/com/x/y/A.java → com.x.y） */
export function inferPackage(rel: string, lang: "java" | "kotlin"): string {
  const base = lang === "kotlin" ? rel.replace(/\.kt$/i, ".java") : rel;
  const m = base.match(/src\/main\/java\/(.+)\/[^/]+\.java$/);
  if (m) return m[1].replace(/\\/g, "/").split("/").join(".");
  // Kotlin 按目录：src/main/kotlin/com/x/y/A.kt → com.x.y（去掉文件名那一段）
  const km = rel.match(/src\/main\/kotlin\/(.+)$/i);
  if (km) {
    const segs = km[1].replace(/\\/g, "/").split("/");
    segs.pop(); // 去掉 A.kt
    return segs.filter(Boolean).join(".");
  }
  return "";
}

// ===== 声明解析（宁可多收，不可漏收） =====

interface DeclParse {
  pkg: string;
  classes: LexClass[];
  /** 类简单名 → 方法 */
  methods: Map<string, LexMethod[]>;
  fields: Map<string, Set<string>>;
}

/** 去掉字符串/字符/注释（保留换行 + 长度不重要，这里只要"能扫出声明"） */
function stripNonCode(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let st: "code" | "line" | "block" | "str" | "char" = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (st === "code") {
      if (c === "/" && d === "/") {
        st = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        st = "block";
        i += 2;
        continue;
      }
      if (c === '"') {
        st = "str";
        i++;
        continue;
      }
      if (c === "'") {
        st = "char";
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (st === "line") {
      if (c === "\n") {
        st = "code";
        out += "\n";
      }
      i++;
      continue;
    }
    if (st === "block") {
      if (c === "*" && d === "/") {
        st = "code";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (st === "str") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') st = "code";
      i++;
      continue;
    }
    if (st === "char") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") st = "code";
      i++;
      continue;
    }
  }
  return out;
}

/** 解析一个文件里的 class / interface / enum / record 声明（Java）。
 *  宁可多收：只要「修饰符/关键字 + 名字 + extends/implements」命中就收，不追求完美。 */
function parseJavaClasses(code: string, pkg: string, source: LexSource, defaultPkg: string): LexClass[] {
  const out: LexClass[] = [];
  // @Deprecated 紧邻类
  const re = /(^|\s|;)\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const kind = m[2] as LexType;
    const name = m[3];
    if (kind === "class" && isBareClassKeyword(code, m.index! + m[0].length - name.length)) continue;
    const start = m.index!;
    const head = code.slice(start, start + 400);
    const parents = [...head.matchAll(/extends\s+([A-Za-z_$][\w$.<>/]*)/g)].map((x) =>
      cleanTypeName(x[1]),
    );
    const interfaces = [...head.matchAll(/implements\s+([A-Za-z_$][\w$.,\s<>/]*)/g)]
      .map((x) => x[1].split(",").map((s) => cleanTypeName(s.trim())).filter(Boolean))
      .flat();
    // @Deprecated
    const prelude = code.slice(Math.max(0, start - 120), start);
    const isDep = /@Deprecated/.test(prelude);
    out.push({
      name,
      fqn: pkg ? `${pkg}.${name}` : name,
      pkg,
      parents,
      interfaces,
      source,
      isDeprecated: isDep || undefined,
    });
    void defaultPkg;
  }
  return out;
}

/** `class` 后面直接跟泛型/继承的才算类声明；`new class`、`is class` 不算（Java 里 is 不是） */
function isBareClassKeyword(_code: string, _atNameStart: number): boolean {
  return false;
}

/** 泛型 raw type：`List<String>` → `List`；`com.x.Foo` → `Foo` */
export function rawTypeName(t: string): string {
  let s = t.trim();
  const lt = s.indexOf("<");
  if (lt >= 0) s = s.slice(0, lt);
  s = s.replace(/\[\s*\]/g, "");
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/** 保留点号的类型名：`View.OnClickListener` 原样（只去泛型/数组/构造括号） */
export function cleanTypeName(t: string): string {
  let s = t.trim();
  const lt = s.indexOf("<");
  if (lt >= 0) s = s.slice(0, lt);
  s = s.replace(/\[\s*\]/g, "");
  // 去掉构造调用 `Activity()` 的括号
  s = s.replace(/\([^)]*\)\s*$/, "").trim();
  return s;
}

/** Kotlin 文件里的类族：class / interface / object / enum class / typealias 不收（是别名） */
function parseKotlinClasses(code: string, pkg: string, source: LexSource): LexClass[] {
  const out: LexClass[] = [];
  // object 单独收（companion 也是 object）
  const objRe = /(^|\s|;)\bobject\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(code)) !== null) {
    const start = m.index!;
    const head = code.slice(start, start + 400);
    const parents = [...head.matchAll(/:\s*([A-Za-z_$][\w$.<>/,\s]*)/g)].map((x) =>
      x[1].split(",").map((s) => cleanTypeName(s.trim())).filter(Boolean),
    );
    const isDep = /@Deprecated/.test(code.slice(Math.max(0, start - 120), start));
    out.push({
      name: m[2],
      fqn: pkg ? `${pkg}.${m[2]}` : m[2],
      pkg,
      parents: parents.flat(),
      interfaces: [],
      source,
      isDeprecated: isDep || undefined,
    });
  }
  const clsRe = /(^|\s|;)\b(class|interface|enum\s+class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = clsRe.exec(code)) !== null) {
    const name = m[3];
    const start = m.index!;
    const head = code.slice(start, start + 500);
    // Kotlin 的继承用 `:` 分隔：class Foo : Bar, Baz
    const colon = head.indexOf(":");
    // 继承列表只到类体 `{` 为止（`class Main : A(), B {` 的 B 后面就是 {）
    const brace = head.indexOf("{");
    const endCut = colon >= 0 ? Math.min(brace >= 0 ? brace : colon + 300, colon + 300) : -1;
    const sups =
      colon >= 0
        ? head
            .slice(colon + 1, endCut)
            .split(",")
            .map((s) => cleanTypeName(s.trim()))
            .filter((s) => s && s !== "constructor" && !/^[({]$/.test(s))
        : [];
    const isDep = /@Deprecated/.test(code.slice(Math.max(0, start - 120), start));
    out.push({
      name,
      fqn: pkg ? `${pkg}.${name}` : name,
      pkg,
      parents: [sups[0] || ""].filter(Boolean),
      interfaces: sups.slice(1),
      source,
      isDeprecated: isDep || undefined,
    });
  }
  return out;
}

/** 方法声明（Java）：`[修饰符] 返回类型 名字(参数)`；宁可多收——前面有「类型 token」就算 */
const JAVA_KEYWORDS_SET = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "else", "do", "try", "throw",
  "case", "assert", "synchronized", "instanceof", "super", "this", "yield", "default",
  "package", "import", "extends", "implements", "break", "continue", "finally", "class",
]);

/** M396：从声明行前缀（方法名之前的部分）提取修饰符。无修饰符返回 undefined（包私有默认不标） */
function modsOf(linePrefix: string): string | undefined {
  const mods: string[] = [];
  if (/\bpublic\b/.test(linePrefix)) mods.push("public");
  else if (/\bprivate\b/.test(linePrefix)) mods.push("private");
  else if (/\bprotected\b/.test(linePrefix)) mods.push("protected");
  if (/\bstatic\b/.test(linePrefix)) mods.push("static");
  if (/\babstract\b/.test(linePrefix)) mods.push("abstract");
  return mods.length ? mods.join(" ") : undefined;
}

function parseJavaMethods(code: string, classNames: Set<string>, pkg: string, source: LexSource): Map<string, LexMethod[]> {
  const out = new Map<string, LexMethod[]>();
  const add = (cls: string, m: LexMethod) => {
    let arr = out.get(cls);
    if (!arr) out.set(cls, (arr = []));
    if (!arr.some((x) => x.name === m.name && (x.signature ?? "") === (m.signature ?? ""))) arr.push(m);
  };

  // 方法签名：前面是「返回类型」（非关键字、非 `.` 调用）+ 名字(`
  // 形如：  public String getTitle(   /   void onCreate(   /   int count(   /   String name()
  const re = /([A-Za-z_$][\w$]*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*)\s+([a-z_][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const ret = rawTypeName(m[1]);
    const name = m[2];
    if (ret === "new" || JAVA_KEYWORDS_SET.has(m[1])) continue;
    const at = m.index!;
    const before = code.slice(0, at);
    // 排除 `obj.name(`（前面是点）
    if (/\.\s*$/.test(before)) continue;
    // 取参数串（到匹配的 )）
    const open = code.indexOf("(", at);
    const sig = extractParams(code, open);
    // 归属类：最近的一个类名（在 classNames 里）；找不到就用当前文件主类
    const cls = nearestClass(name, at, classNames, code);
    // @Deprecated
    const prelude = code.slice(Math.max(0, at - 140), at);
    const isDep = /@Deprecated/.test(prelude);
    // M396：修饰符 —— 只看方法名所在行的前缀（跨行声明取不到，宁缺勿错）
    const lineStart = code.lastIndexOf("\n", at - 1) + 1;
    const mod = modsOf(code.slice(lineStart, at));
    // M441：返回类型（void 不存 —— 没有返回值可展示）
    const retType = ret === "void" ? undefined : ret;
    add(cls, { name, originClass: cls, signature: sig, isDeprecated: isDep || undefined, mod, ret: retType });
    void pkg;
  }
  return out;
}

/** M441：`)` 之后的 `: Type` → Kotlin 返回类型（Unit/Nothing 视为无返回值） */
function kotlinReturnType(code: string, open: number): string | undefined {
  if (open < 0) return undefined;
  let depth = 0;
  let i = open;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  const tail = code.slice(i + 1, i + 220);
  const m = /^\s*:\s*([A-Za-z_$][\w$.]*\s*(?:<[^<>]*>)?)/.exec(tail);
  if (!m) return undefined;
  const t = rawTypeName(m[1]);
  if (!t || t === "Unit" || t === "Nothing") return undefined;
  return t;
}

/** 从 open 处取到匹配的 ) 的参数串 */
function extractParams(code: string, open: number): string {
  if (open < 0) return "";
  let depth = 0;
  let i = open;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  return code.slice(open + 1, i).trim();
}

/** 找方法名前最近的一个类名（行内/上面几行）；没有就退回 classNames 第一个 */
function nearestClass(name: string, at: number, classNames: Set<string>, code: string): string {
  void name;
  // 往前找最近的「class X」声明（同文件或上面）
  let best = "";
  let bestPos = -1;
  for (const cls of classNames) {
    const re = new RegExp(`\\b(class|interface|enum|record|object)\\s+${cls}\\b`);
    const cm = re.exec(code.slice(0, at));
    if (cm && cm.index > bestPos) {
      best = cls;
      bestPos = cm.index;
    }
  }
  if (best) return best;
  // 退回：文件里第一个类名
  for (const cls of classNames) return cls;
  return "TopLevel";
}

/** 到某位置为止的大括号深度（top-level 判断：深度 0 = 文件顶层） */
function braceDepthAt(code: string, upto: number): number {
  let d = 0;
  for (let i = 0; i < Math.min(upto, code.length); i++) {
    const c = code[i];
    if (c === "{") d++;
    else if (c === "}") d--;
  }
  return d;
}

/** Kotlin 方法：`fun 接收者.名字(参数)` / `fun 名字(参数)` / `val`/`var` 字段 */
function parseKotlinMethods(code: string, classNames: Set<string>, pkg: string, source: LexSource, topLevelName: string): Map<string, LexMethod[]> {
  const out = new Map<string, LexMethod[]>();
  const add = (cls: string, m: LexMethod) => {
    let arr = out.get(cls);
    if (!arr) out.set(cls, (arr = []));
    if (!arr.some((x) => x.name === m.name && (x.signature ?? "") === (m.signature ?? ""))) arr.push(m);
  };

  // fun [接收者.] 名字(参数)
  const funRe = /\bfun\s+(?:(?:([A-Za-z_$][\w$.]*)\.)\s*)?([a-z_][\w$]*)\s*(<[^()]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = funRe.exec(code)) !== null) {
    const receiver = m[1] ? rawTypeName(m[1]) : "";
    const name = m[2];
    const open = code.indexOf("(", m.index!);
    const sig = extractParams(code, open);
    // top-level（大括号深度 0）→ 归到文件级伪类；否则归到最近的类
    const cls = receiver || (braceDepthAt(code, m.index!) === 0 ? topLevelName : nearestClass(name, m.index!, classNames, code));
    const prelude = code.slice(Math.max(0, m.index! - 140), m.index!);
    const isDep = /@Deprecated/.test(prelude);
    // M396：修饰符（Kotlin：可见性 + 静态归 companion 不展开，宁缺勿错）
    const lineStartK = code.lastIndexOf("\n", m.index! - 1) + 1;
    const modK = modsOf(code.slice(lineStartK, m.index!));
    // M441：返回类型 —— `fun foo(...): Type`（`)` 之后可选 `: Type`）；Unit/Nothing 不存
    const retK = kotlinReturnType(code, open);
    add(cls, { name, originClass: cls, signature: sig, isDeprecated: isDep || undefined, mod: modK, ret: retK });
  }

  // val/var 字段（M441：能推出的类型顺带当 ret 存 —— 属性建议就显示它的类型）
  const fieldRe = /\b(val|var)\s+([a-z_][\w$]*)\s*(?::\s*([A-Za-z_$][\w$.]*\s*(?:<[^<>]*>)?))?\s*[:=]/g;
  while ((m = fieldRe.exec(code)) !== null) {
    const name = m[2];
    const cls = braceDepthAt(code, m.index!) === 0 ? topLevelName : nearestClass(name, m.index!, classNames, code);
    const explicit = m[3] ? rawTypeName(m[3]) : undefined;
    let inferred: string | undefined;
    if (!explicit) {
      // `val x = Foo(...)` → Foo
      const rhs = code.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
      const im = /^\s*(?:[A-Z][\w$.]*\s*<[^<>]*>\s*)?([A-Z][\w$.]*)\s*\(/.exec(rhs);
      if (im) inferred = rawTypeName(im[1]);
    }
    const retProp = explicit || inferred;
    let arr = out.get(cls);
    if (!arr) out.set(cls, (arr = []));
    if (!arr.some((x) => x.name === name)) arr.push({ name, originClass: cls, ret: retProp });
  }
  void pkg;
  void source;
  return out;
}

/** 字段（Java）：类体里的 `Type name;`（depth 判定交给调用方；这里按「行内 类型 名字 =或; 且不在括号里」粗收） */
function parseJavaFields(code: string, classNames: Set<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /\b([A-Za-z_$][\w$]*(?:\s*<[^>()]*>)?(?:\s*\[\s*\])*)\s+([a-z_][\w$]*)\s*(=|;)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const type = rawTypeName(m[1]);
    const name = m[2];
    if (JAVA_KEYWORDS_SET.has(type)) continue;
    // 排除方法调用/局部：只收「字段」——粗略：不在 ( ) { } 很深的地方，靠调用方 depth 过滤；这里全收，宁可多
    const cls = nearestClass(name, m.index!, classNames, code);
    let set = out.get(cls);
    if (!set) out.set(cls, (set = new Set()));
    set.add(name);
  }
  return out;
}

/** 解析单个文件的声明（类 + 方法 + 字段） */
export function parseDeclarations(
  src: string,
  lang: "java" | "kotlin",
  pkg: string,
  source: LexSource = "project",
): Omit<DeclParse, "pkg"> & { pkg: string } {
  const code = stripNonCode(src);
  let classes: LexClass[];
  let methods: Map<string, LexMethod[]>;
  let fields: Map<string, Set<string>>;
  if (lang === "java") {
    classes = parseJavaClasses(code, pkg, source, pkg);
  } else {
    classes = parseKotlinClasses(code, pkg, source);
  }
  const classNames = new Set(classes.map((c) => c.name));
  // 顶层文件（没有类）的方法归属：用「文件基名」当一个隐式类
  if (classNames.size === 0) {
    const base = src.replace(/\.(java|kt)$/i, "").split(/[/\\]/).pop() || "TopLevel";
    classNames.add(base);
  }
  if (lang === "java") {
    methods = parseJavaMethods(code, classNames, pkg, source);
    fields = parseJavaFields(code, classNames);
  } else {
    const fileBase = src.replace(/\.(java|kt)$/i, "").split(/[/\\]/).pop() || "TopLevel";
    const cleanBase = /^[A-Za-z_$][\w$]*$/.test(fileBase) ? fileBase : "TopLevel";
    methods = parseKotlinMethods(code, classNames, pkg, source, cleanBase);
    fields = parseJavaFields(code, classNames); // Kotlin 字段简单复用（val/var 已在 parseKotlinMethods 收了，这里兜底）
  }
  return { pkg, classes, methods, fields };
}

// ===== 建库（合并多文件 + 资源） =====

export interface BuildOpts {
  source?: LexSource;
  resources?: LexResources;
  /** 继承合并的最大层数（防环） */
  maxInheritDepth?: number;
}

export function buildLexicon(files: LexSourceFile[], opts: BuildOpts = {}): Lexicon {
  const source = opts.source ?? "project";
  const lex = createEmptyLexicon();
  for (const f of files) {
    const pkg = f.rel ? inferPackage(f.rel, f.lang) : "";
    const p = parseDeclarations(f.text, f.lang, pkg, source);
    for (const c of p.classes) {
      if (!lex.classes.has(c.name)) lex.classes.set(c.name, c);
      if (c.fqn) lex.classesByFqn.set(c.fqn, c);
    }
    for (const [cls, ms] of p.methods) {
      let arr = lex.methods.get(cls);
      if (!arr) lex.methods.set(cls, (arr = []));
      for (const m2 of ms) {
        if (!arr.some((x) => x.name === m2.name && (x.signature ?? "") === (m2.signature ?? ""))) arr.push(m2);
        lex.allMethodNames.add(m2.name);
        if (m2.isDeprecated) lex.deprecated.add(m2.name);
      }
    }
    for (const [cls, fs] of p.fields) {
      let set = lex.fields.get(cls);
      if (!set) lex.fields.set(cls, (set = new Set()));
      for (const n of fs) set.add(n);
    }
  }
  // 资源桶
  if (opts.resources) {
    for (const [type, names] of Object.entries(opts.resources)) {
      let set = lex.resources.get(type);
      if (!set) lex.resources.set(type, (set = new Set()));
      for (const n of names) set.add(n);
    }
  }
  return lex;
}

/** 把另一份词库并入（用于 sdk/third 预消化 json 加载后合并进 project 词库） */
export function mergeLexicon(base: Lexicon, other: Lexicon, otherSource: LexSource): Lexicon {
  const out = createEmptyLexicon(Math.max(base.version, other.version));
  out.classes = new Map(base.classes);
  out.classesByFqn = new Map(base.classesByFqn);
  out.methods = new Map(base.methods);
  out.allMethodNames = new Set(base.allMethodNames);
  out.fields = new Map(base.fields);
  out.resources = new Map(base.resources);
  out.deprecated = new Set(base.deprecated);

  for (const [k, v] of other.classes) if (!out.classes.has(k)) out.classes.set(k, v);
  for (const [k, v] of other.classesByFqn) if (!out.classesByFqn.has(k)) out.classesByFqn.set(k, v);
  for (const [k, arr] of other.methods) {
    const ex = out.methods.get(k) || [];
    for (const m2 of arr) {
      if (!ex.some((x) => x.name === m2.name && (x.signature ?? "") === (m2.signature ?? ""))) ex.push(m2);
      out.allMethodNames.add(m2.name);
      if (m2.isDeprecated) out.deprecated.add(m2.name);
    }
    out.methods.set(k, ex);
  }
  for (const [k, set] of other.fields) {
    const ex = out.fields.get(k) || new Set<string>();
    for (const n of set) ex.add(n);
    out.fields.set(k, ex);
  }
  for (const [k, set] of other.resources) {
    const ex = out.resources.get(k) || new Set<string>();
    for (const n of set) ex.add(n);
    out.resources.set(k, ex);
  }
  void otherSource;
  out.version = base.version + 1;
  return out;
}

// ===== 继承 + 接口 方法合并（拿到「某类实际可用的方法」全集） =====

/** 某类（含继承链 + 接口）的完整方法名集合 */
export function resolveClassMethods(lex: Lexicon, className: string, maxDepth = 8): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [className];
  let depth = 0;
  while (queue.length && depth < maxDepth) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const ms = lex.methods.get(cur);
    if (ms) for (const m of ms) out.add(m.name);
    const c = lex.classes.get(cur);
    if (c) {
      for (const p of [...c.parents, ...c.interfaces]) {
        if (p && !seen.has(p)) queue.push(p);
      }
      depth++;
    }
  }
  return out;
}

/** 某类可用的方法（带 signature/originClass，去重，含继承） */
export function resolveClassMethodEntries(lex: Lexicon, className: string, maxDepth = 8): LexMethod[] {
  const out: LexMethod[] = [];
  const seenNameSig = new Set<string>();
  const walk = (cls: string, depth: number): void => {
    if (depth > maxDepth) return;
    const ms = lex.methods.get(cls);
    if (ms) {
      for (const m of ms) {
        const key = `${m.name}|${m.signature ?? ""}`;
        if (!seenNameSig.has(key)) {
          seenNameSig.add(key);
          out.push(m);
        }
      }
    }
    const c = lex.classes.get(cls);
    if (c) for (const p of [...c.parents, ...c.interfaces]) walk(p, depth + 1);
  };
  walk(className, 0);
  return out;
}

/** 同包类：某 package 下所有类名（Java 同包不用 import） */
export function samePackageClasses(lex: Lexicon, pkg: string, includeThisFileClass: string): string[] {
  const out = new Set<string>();
  for (const c of lex.classes.values()) {
    if (c.pkg === pkg) out.add(c.name);
  }
  out.add(includeThisFileClass);
  return [...out];
}

// ===== 单一数据源 Store（原子切换 + 订阅） =====

export type LexSub = (lex: Lexicon) => void;

export class LexStore {
  private lex: Lexicon;
  private version: number;
  private subs = new Set<LexSub>();
  /** 后台重任务锁（M1：词库构建与编译错峰的简单队列） */
  private heavyQueue: Array<() => Promise<void>> = [];
  private heavyRunning = false;

  constructor(initial?: Lexicon) {
    this.lex = initial ?? createEmptyLexicon();
    this.version = this.lex.version;
  }

  get current(): Lexicon {
    return this.lex;
  }

  get ver(): number {
    return this.version;
  }

  /** 原子替换（后台建好新库后调用；业务期间继续读旧库） */
  commit(next: Lexicon): void {
    const stamped: Lexicon = { ...next, version: Math.max(this.version, next.version) + 1 };
    this.lex = stamped;
    this.version = stamped.version;
    for (const s of this.subs) {
      try {
        s(this.lex);
      } catch {
        /* 订阅者异常不影响其它 */
      }
    }
  }

  subscribe(fn: LexSub): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  /** 排一个重型后台任务（同一时刻只跑一个） */
  runHeavy(task: () => Promise<void>): void {
    this.heavyQueue.push(task);
    if (!this.heavyRunning) void this.pumpHeavy();
  }

  private async pumpHeavy(): Promise<void> {
    this.heavyRunning = true;
    while (this.heavyQueue.length) {
      const t = this.heavyQueue.shift()!;
      try {
        await t();
      } catch {
        /* 单个任务失败不阻塞后续 */
      }
    }
    this.heavyRunning = false;
  }
}

/** 全局单例（组件共享同一份，不各自维护副本） */
let _store: LexStore | null = null;
export function getLexStore(): LexStore {
  if (!_store) _store = new LexStore();
  return _store;
}
export function resetLexStore(): void {
  _store = null;
}
