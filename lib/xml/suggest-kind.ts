// lib/xml/suggest-kind.ts — M99：候选词分类（一套标签，XML 和 Java/Kotlin 共用）
//
// 为什么单独一个文件：候选弹窗的「分类角标」要跨两个数据层
// （keyword-suggest 管 XML、java-vocab 管 Java/Kotlin），
// 分类定义和判定规则放一处才不会两边跑偏。
//
// 标签刻意用单字——手机弹窗一行只有 26px 高，用「声明 / 关键字」这种
// 两个词会把候选词本身挤没：声(声明) 类(类/类型) 方(方法) 变(变量) 常(常量) 引(引用) 属(属性)

export type SuggestKind = "decl" | "class" | "method" | "var" | "const" | "ref" | "prop" | "plain";

/** 弹窗右侧那个角标（单字，尽量窄） */
export const KIND_LABEL: Record<SuggestKind, string> = {
  decl: "声",
  class: "类",
  method: "方",
  var: "变",
  const: "常",
  ref: "引",
  prop: "属",
  plain: "词",
};

/** 长按 / 悬停时给的完整说明 */
export const KIND_NAME: Record<SuggestKind, string> = {
  decl: "声明（关键字 / 修饰符）",
  class: "类 / 类型",
  method: "方法",
  var: "变量",
  const: "常量",
  ref: "引用",
  prop: "属性",
  plain: "词",
};

const ALL: SuggestKind[] = ["decl", "class", "method", "var", "const", "ref", "prop", "plain"];

/* ===================== XML 侧 ===================== */

/** 老的上下文类型（tag/attr/value/resource/plain）→ 新分类 */
export function kindFromXmlContext(ctx: "tag" | "attr" | "value" | "resource" | "plain"): SuggestKind {
  switch (ctx) {
    case "tag":
      return "class"; // 标签名本身就是个类（TextView / LinearLayout）
    case "attr":
      return "prop";
    case "value":
      return "const"; // match_parent / center_vertical 这类枚举值
    case "resource":
      return "ref"; // @drawable/xxx
    default:
      return "var";
  }
}

/**
 * 按「长什么样」兜底判类（上下文不完全可靠时用）：
 *   @xxx/yyy        → 引
 *   #ff0000         → 常（颜色字面量）
 *   android:text    → 属（带命名空间）
 *   TextView        → 类
 *   MAX_COUNT       → 常
 *   user_name / id  → 变
 */
export function classifyXmlItem(text: string, ctx: "tag" | "attr" | "value" | "resource" | "plain"): SuggestKind {
  const t = text.trim();
  if (!t) return "plain";
  if (t.startsWith("@") || t.startsWith("?")) return "ref";
  if (t.startsWith("#")) return "const";
  if (ctx === "tag") return "class";
  if (ctx === "attr") return "prop";
  if (ctx === "value") {
    // 字符串值（带空格 / 中文 / 大写开头）不是常量，别给它挂「常」
    if (/^[a-z][a-z0-9_]*$/.test(t) && !t.includes("-")) return "const";
    return "var";
  }
  if (ctx === "resource") return "ref";
  // plain：看形状
  if (/^[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*$/.test(t)) return "prop"; // ns:name
  if (/^[A-Z][A-Z0-9_]+$/.test(t)) return "const"; // 全大写常量
  if (/^[A-Z]/.test(t)) return "class";
  return "var";
}

/* ===================== Java / Kotlin 侧 ===================== */

export interface JavaDocTokens {
  /** 局部变量 / 字段 / 参数（小写开头，赋过值或当过形参） */
  vars: string[];
  /** 全大写常量（MAX_COUNT / TAG） */
  consts: string[];
  /** 本文件里调用过的方法 */
  methods: string[];
  /** 本文件里出现的大写开头类型名 */
  types: string[];
  /** import 进来的类 + R.xxx 这类既有引用 */
  refs: string[];
}

/** 从文档里抠出「本文件已有的符号」，让候选能优先给当前文件的变量/方法 */
export function extractJavaTokens(doc: string): JavaDocTokens {
  const vars = new Set<string>();
  const consts = new Set<string>();
  const methods = new Set<string>();
  const types = new Set<string>();
  const refs = new Set<string>();

  // 常量：全大写（含数字下划线），至少 3 个字符
  for (const m of doc.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) consts.add(m[1]);

  // 赋值左侧：count = 0 / userName = ...（排除 ==）
  for (const m of doc.matchAll(/\b([a-z_$][\w$]*)\s*=(?!=)/g)) vars.add(m[1]);
  // 形参：(TextView tv, int count)
  for (const m of doc.matchAll(/[,(]\s*(?:final\s+)?[A-Z_$][\w$<>\[\].,\s?]*?\s+([a-z_$][\w$]*)\s*[,)]/g)) vars.add(m[1]);
  // for (int i = 0 …
  for (const m of doc.matchAll(/\bfor\s*\(\s*(?:final\s+)?[\w<>\[\].]+\s+([a-z_$][\w$]*)\s*:/g)) vars.add(m[1]);
  // 字段/局部变量声明：String name;
  for (const m of doc.matchAll(/(?:^|[;{}])\s*(?:private|public|protected|static|final|var|val|\s)*[A-Z][\w$<>\[\].]*\s+([a-z_$][\w$]*)\s*[;=]/g)) vars.add(m[1]);

  // 方法调用：xxx.foo( / foo(
  for (const m of doc.matchAll(/\.\s*([a-z_$][\w$]*)\s*\(/g)) methods.add(m[1]);
  // 方法声明：void foo(
  for (const m of doc.matchAll(/\b(?:void|boolean|int|long|float|double|char|String|[A-Z][\w$<>\[\]]*)\s+([a-z_$][\w$]*)\s*\(/g)) methods.add(m[1]);

  // 类型：大写开头的标识符（排除全大写常量）
  for (const m of doc.matchAll(/\b([A-Z][a-z0-9_$][\w$]*)\b/g)) types.add(m[1]);
  // import 的类
  for (const m of doc.matchAll(/\bimport\s+[\w.]*\.([A-Z][\w$]*)\s*;?/g)) refs.add(m[1]);
  // R.id.xxx / R.layout.xxx 整串
  for (const m of doc.matchAll(/\bR\.\w+\.[\w]+/g)) refs.add(m[0]);

  const clean = (s: Set<string>) => [...s].filter((v) => v.length >= 2 && v.length <= 40).slice(0, 200);
  return { vars: clean(vars), consts: clean(consts), methods: clean(methods), types: clean(types), refs: clean(refs) };
}

/**
 * M389：作用域感知的局部符号提取。
 * 与 extractJavaTokens（全文扫，不区分作用域）不同，这里只看「光标所在方法的体内」的局部变量/形参，
 * 加上类成员（字段/常量）——字段是类作用域，任何方法里都可见。
 * 这样在 onCreate 里打的局部 count 不会泄漏到 onResume 的候选里。
 *
 * 轻量做法（不做完整语义分析）：
 *   1. 用「花括号深度 + 方法签名行」定位光标所在的最近一层方法体；
 *   2. 只从该方法体切片里提局部变量/形参；字段/常量从全文件提（类作用域）。
 * 返回：{ locals, fields, consts }
 */
export interface ScopedSymbols {
  /** 光标所在方法体内的局部变量 + 形参 */
  locals: string[];
  /** 类成员字段（类作用域，处处可见） */
  fields: string[];
  /** 类内常量（全大写，类作用域） */
  consts: string[];
}

/** 找光标 offset 所在的「最近一层方法体」文本切片。找不到就返回全文件（退化为字段/常量可见） */
function enclosingMethodBody(doc: string, offset: number): string {
  // 方法签名：行内出现 `返回类型 方法名(`，深度从 0 升到 1 后，配对花括号到闭合
  const lines = doc.split("\n");
  let lineStart = 0;
  // 定位光标所在行
  let curLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const ls = lineStart;
    lineStart += lines[i].length + 1;
    if (offset >= ls && offset < ls + lines[i].length + 1) {
      curLine = i;
      break;
    }
  }
  // 从光标往上找「方法签名行」（带 `(` 且前面有返回类型/修饰符，且花括号在后续闭合）
  // 简化：找 offset 之前、深度最低、以 `)` 开头或含 `(` 的最近签名行
  for (let l = curLine; l >= 0; l--) {
    const head = lines[l].trim();
    if (!head || head.startsWith("//") || head.startsWith("/*") || head.startsWith("*")) continue;
    // 方法签名特征：行尾有 `)` 或 `)` 后接 `{`，且不含 `;`（声明体）
    if (/\b\w+\s*\([^)]*\)\s*(\{|\s*)$/.test(head) && !/;$/.test(head)) {
      // 从这行起累计花括号深度，深度回到 0 时为方法体结束
      let depth = 0;
      let started = false;
      let end = -1;
      for (let i = l; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") {
            depth--;
            if (started && depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end !== -1) break;
      }
      if (end === -1) end = lines.length - 1;
      return lines.slice(l, end + 1).join("\n");
    }
    if (head.includes("class ") || head.startsWith("public class") || head.startsWith("private class")) break; // 到类定义，往外不找方法
  }
  return doc; // 没找到方法体 → 全文件（字段/常量仍有效）
}

export function extractScopedSymbols(doc: string, offset: number): ScopedSymbols {
  const body = enclosingMethodBody(doc, offset);
  const locals = new Set<string>();
  const fields = new Set<string>();
  const consts = new Set<string>();
  const inMethod = body !== doc;

  // 局部（只看当前方法体切片）—— 光标在类层级（body===doc）时没有局部，避免泄漏
  if (inMethod) {
    for (const m of body.matchAll(/\b([a-z_$][\w$]*)\s*=(?!=)/g)) locals.add(m[1]);
    for (const m of body.matchAll(/[(,]\s*(?:final\s+)?[A-Z_$][\w$<>\[\].,\s?]*?\s+([a-z_$][\w$]*)\s*[,)]/g)) locals.add(m[1]);
    for (const m of body.matchAll(/\bfor\s*\(\s*(?:final\s+)?[\w<>\[\].]+\s+([a-z_$][\w$]*)\s*:/g)) locals.add(m[1]);
  }

  // 字段/常量：类作用域 → 全文件提，但只认带修饰符的（private/public/protected/static）才算成员
  for (const m of doc.matchAll(/\b(?:private|public|protected)\s+(?:static\s+|final\s+)*(?:(?:[A-Za-z][\w$<>\[\].]*|int|long|float|double|boolean|char|byte|short|void))\s+([a-z_$][\w$]*)\s*[;=]/g)) fields.add(m[1]);
  for (const m of doc.matchAll(/\b(?:private|public|protected)\s+static\s+final\s+[\w.<>\[\]]*\s+([A-Z][A-Z0-9_]{1,})\s*=/g)) consts.add(m[1]);

  const clean = (s: Set<string>) => [...s].filter((v) => v.length >= 2 && v.length <= 40).slice(0, 200);
  return { locals: clean(locals), fields: clean(fields), consts: clean(consts) };
}

/** 一个候选词该挂哪个角标（Java 侧，按来源优先） */
export function classifyJavaWord(word: string): SuggestKind {
  const w = word.trim();
  if (!w) return "plain";
  if (w.startsWith("@")) return "ref"; // 注解 = 引用一个类
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(w)) return "const";
  if (/^[A-Z]/.test(w)) return "class";
  if (w.startsWith("R.")) return "ref";
  return "method";
}

/**
 * M394：候选词类型排序权重 —— 用户要的层级：声明 > 变量 > 常量 > 类 > 方法。
 * 同一匹配质量档内，kindPriority 小的排前面。数字越小越靠前。
 * decl(关键字/声明) 0 → var(变量) 1 → const(常量) 2 → class(类) 3 → method(方法) 4 → 其余 5
 */
export const KIND_PRIORITY: Record<SuggestKind, number> = {
  decl: 0,
  var: 1,
  const: 2,
  class: 3,
  method: 4,
  ref: 5,
  prop: 5,
  plain: 6,
};
