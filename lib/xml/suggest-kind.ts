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

export function isSuggestKind(v: unknown): v is SuggestKind {
  return typeof v === "string" && (ALL as string[]).includes(v);
}

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
