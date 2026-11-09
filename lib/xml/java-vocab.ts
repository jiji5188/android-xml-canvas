// lib/xml/java-vocab.ts — M96：Java 代码编辑的词汇表 + 符号栏
//
// 编辑器里 .java 文件走 CodeMirror 的 java 语法高亮，但候选列表以前只有 XML 那套
// （标签 / 属性 / 值），在 Java 里几乎等于没有。这里补三组：
//   ① 声明 / 修饰 / 控制流关键字   ② 常用类（JDK + Android）   ③ 常用方法
// 再加一条「符号栏」：Java 里高频的 {} () ; -> :: @Override 等，按 lang 切换。
//
// 纯数据 + 纯函数，方便单测；不做语义分析，只按前缀过滤 + 去重。

import { extractJavaTokens, type SuggestKind } from "./suggest-kind";

export interface JavaSymbol {
  label: string;
  insert: string;
  back?: number;
  title?: string;
}

/** 声明类 + 修饰符 + 控制流（顺序即候选排序权重，靠前更常用） */
export const JAVA_KEYWORDS: string[] = [
  "public",
  "private",
  "protected",
  "class",
  "interface",
  "enum",
  "extends",
  "implements",
  "static",
  "final",
  "abstract",
  "void",
  "new",
  "return",
  "import",
  "package",
  "this",
  "super",
  "null",
  "true",
  "false",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "throws",
  "instanceof",
  "synchronized",
  "volatile",
  "transient",
  "native",
  "assert",
  "var",
  "record",
  "sealed",
  "permits",
  "yield",
  "int",
  "long",
  "short",
  "byte",
  "char",
  "float",
  "double",
  "boolean",
];

/** 基础类型 + 常用 JDK 类 + Android 类 */
export const JAVA_TYPES: string[] = [
  "String",
  "StringBuilder",
  "StringBuffer",
  "Object",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Boolean",
  "Character",
  "List",
  "ArrayList",
  "LinkedList",
  "Map",
  "HashMap",
  "LinkedHashMap",
  "TreeMap",
  "Set",
  "HashSet",
  "TreeSet",
  "Queue",
  "Deque",
  "Collections",
  "Arrays",
  "Objects",
  "Optional",
  "Math",
  "System",
  "Exception",
  "RuntimeException",
  "IllegalArgumentException",
  "IllegalStateException",
  "NullPointerException",
  "IOException",
  "Thread",
  "Runnable",
  "Handler",
  "Looper",
  "Message",
  "Log",
  "Toast",
  "Context",
  "Activity",
  "AppCompatActivity",
  "Fragment",
  "Intent",
  "Bundle",
  "Uri",
  "Bitmap",
  "Color",
  "View",
  "ViewGroup",
  "TextView",
  "Button",
  "ImageView",
  "EditText",
  "CheckBox",
  "Switch",
  "ProgressBar",
  "SeekBar",
  "LinearLayout",
  "FrameLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "ScrollView",
  "RecyclerView",
  "ListView",
  "Adapter",
  "ViewHolder",
  "Dialog",
  "AlertDialog",
  "LayoutInflater",
  "SharedPreferences",
  "HandlerThread",
  "ExecutorService",
  "Executors",
];

/** 常用方法（含生命周期 / 视图 / 集合 / 断言） */
export const JAVA_METHODS: string[] = [
  "toString",
  "equals",
  "hashCode",
  "getClass",
  "onCreate",
  "onStart",
  "onResume",
  "onPause",
  "onStop",
  "onDestroy",
  "setContentView",
  "findViewById",
  "setText",
  "getText",
  "setVisibility",
  "setOnClickListener",
  "setOnLongClickListener",
  "setEnabled",
  "setTag",
  "getTag",
  "setBackgroundColor",
  "setAdapter",
  "notifyDataSetChanged",
  "startActivity",
  "startActivityForResult",
  "finish",
  "getIntent",
  "runOnUiThread",
  "postDelayed",
  "removeCallbacks",
  "getSharedPreferences",
  "getString",
  "getApplicationContext",
  "getContext",
  "requireContext",
  "addView",
  "removeView",
  "add",
  "remove",
  "get",
  "put",
  "size",
  "isEmpty",
  "containsKey",
  "keySet",
  "values",
  "forEach",
  "stream",
  "filter",
  "map",
  "collect",
  "join",
  "format",
  "valueOf",
  "parseInt",
  "compareTo",
  "setUp",
  "tearDown",
  "assertEquals",
  "assertTrue",
  "assertNotNull",
];

/** Java 里高频打出的符号 / 片段（.java 文件时替换 XML 那套符号栏） */
export const JAVA_SYMBOLS: JavaSymbol[] = [
  { label: "{}", insert: "{}", back: 1, title: "代码块（光标落在中间）" },
  { label: "()", insert: "()", back: 1, title: "括号（光标落在中间）" },
  { label: "[]", insert: "[]", back: 1, title: "数组下标 / 数组类型" },
  { label: "<>", insert: "<>", back: 1, title: "泛型" },
  { label: ";", insert: ";", title: "语句结尾" },
  { label: '""', insert: '""', back: 1, title: "字符串（光标落在中间）" },
  { label: "' '", insert: "''", back: 1, title: "字符（光标落在中间）" },
  { label: "->", insert: "->", title: "Lambda 箭头" },
  { label: "::", insert: "::", title: "方法引用" },
  { label: "==", insert: "==", title: "相等比较" },
  { label: "!=", insert: "!=", title: "不等比较" },
  { label: "&&", insert: "&&", title: "逻辑与" },
  { label: "||", insert: "||", title: "逻辑或" },
  { label: "!", insert: "!", title: "逻辑非" },
  { label: "=", insert: "=", title: "赋值" },
  { label: "+", insert: " + ", title: "加 / 字符串拼接" },
  { label: "?", insert: " ? ", title: "三元 / 泛型通配" },
  { label: ":", insert: " : ", title: "三元分支 / 增强 for" },
  { label: ",", insert: ", ", title: "分隔参数" },
  { label: ".", insert: ".", title: "成员访问" },
  { label: "@Override", insert: "@Override", title: "重写注解" },
  { label: "@Test", insert: "@Test", title: "JUnit 测试注解" },
  { label: "Log.d(", insert: 'Log.d("TAG", "");', title: "打日志" },
  { label: "new ", insert: "new ", title: "创建对象" },
  { label: "TODO", insert: "// TODO: ", title: "待办注释" },
  // M209：常用 Java 脚手架（选了就插入一整个块，光标留在中间）
  { label: "if/else", insert: "if () {\n\n} else {\n\n}", back: 1, title: "if / else 分支" },
  { label: "for", insert: "for (int i = 0; i < n; i++) {\n\n}", back: 1, title: "循环" },
  { label: "for-in", insert: "for (Item it : items) {\n\n}", back: 1, title: "增强 for" },
  { label: "try/catch", insert: "try {\n\n} catch (Exception e) {\n\n}", back: 1, title: "try / catch" },
  { label: "while", insert: "while () {\n\n}", back: 1, title: "while 循环" },
  { label: "switch", insert: "switch () {\n    case 0:\n      break;\n    default:\n      break;\n}", back: 1, title: "switch 分支" },
  { label: "Activity", insert: "public class MainActivity extends Activity {\n\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        setContentView(R.layout.activity_main);\n    }\n}", back: 1, title: "Activity 模板" },
  { label: "Fragment", insert: "public class MyFragment extends Fragment {\n\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n    }\n}", back: 1, title: "Fragment 模板" },
];

const WORD = /[A-Za-z0-9_$]/;

/** 光标左边正在输入的词 */
function wordBefore(doc: string, offset: number): { prefix: string; start: number } {
  let start = offset;
  while (start > 0 && WORD.test(doc[start - 1])) start--;
  // 注解：把紧贴的 @ 一起算进前缀（否则 @Ov 会被当成 Ov）
  if (start > 0 && doc[start - 1] === "@") start--;
  return { prefix: doc.slice(start, offset), start };
}

/** 粗略判断是否在注释里（行注释看本行，块注释看未闭合的 /* ） */
function inComment(doc: string, offset: number): boolean {
  const lineStart = doc.lastIndexOf("\n", offset - 1) + 1;
  const lineHead = doc.slice(lineStart, offset);
  if (lineHead.includes("//")) return true;
  const before = doc.slice(0, offset);
  const open = before.lastIndexOf("/*");
  const close = before.lastIndexOf("*/");
  return open !== -1 && open > close;
}

/** 粗略判断是否在字符串字面量里 */
function inString(doc: string, offset: number): boolean {
  const lineStart = doc.lastIndexOf("\n", offset - 1) + 1;
  const lineHead = doc.slice(lineStart, offset).replace(/\\./g, "");
  return (lineHead.match(/"/g) || []).length % 2 === 1;
}

const MAX_ITEMS = 24; // M98：从 12 提到 24，配合弹窗滚动（320px 高）让常用词尽量都露出来

/**
 * Java 候选：关键字 / 类型 / 方法三组按前缀过滤，保留原顺序（常用优先）。
 * 前缀长度 < 1 返回 null；`@` 开头直接给注解。
 */
export function computeJavaSuggest(
  doc: string,
  cursor: { line: number; col: number },
): { line: number; col: number; prefix: string; kind: SuggestKind; items: string[]; kinds: SuggestKind[] } | null {
  const lines = doc.split("\n");
  const li = Math.max(0, Math.min(cursor.line - 1, lines.length - 1));
  const lineText = lines[li] ?? "";
  const col = Math.max(1, Math.min(cursor.col, lineText.length + 1));
  const offset = lines.slice(0, li).reduce((n, l) => n + l.length + 1, 0) + col - 1;

  if (inComment(doc, offset) || inString(doc, offset)) return null;

  const { prefix } = wordBefore(doc, offset);
  const isAt = prefix.startsWith("@");
  const body = isAt ? prefix.slice(1) : prefix;
  if (body.length < 2 && !isAt) return null;

  // M99：本文件已有的变量/常量/方法/类型/引用排在词表前面
  //        ——写 `user` 时最想看到的是这个文件里的 userName，而不是 JDK 的 UserManager
  const tok = extractJavaTokens(doc);
  const pool: { text: string; kind: SuggestKind }[] = [];
  const addAll = (words: string[], kind: SuggestKind) => {
    for (const w of words) pool.push({ text: w, kind });
  };
  if (isAt) {
    addAll(["Override", "Test", "NonNull", "Nullable", "SuppressWarnings", "Deprecated"].map((a) => "@" + a), "ref");
  } else {
    addAll(tok.vars, "var");
    addAll(tok.consts, "const");
    addAll(tok.methods, "method");
    addAll(tok.refs, "ref");
    addAll(tok.types, "class");
    addAll(JAVA_KEYWORDS, "decl");
    addAll(JAVA_TYPES, "class");
    addAll(JAVA_METHODS, "method");
  }

  const lower = body.toLowerCase();
  const seen = new Set<string>();
  const picked: { text: string; kind: SuggestKind }[] = [];
  const push = (it: { text: string; kind: SuggestKind }) => {
    const key = isAt ? it.text : it.text;
    // M99：自己不要当候选（文档 token 会把刚打的半个词也扫进来）
    if (it.text === prefix || it.text === body) return;
    if (seen.has(key) || picked.length >= MAX_ITEMS) return;
    seen.add(key);
    picked.push(it);
  };
  // 第一轮只留「前缀开头」的（最常见的匹配），不够 6 条再补「包含」的
  for (const it of pool) {
    if (it.text.toLowerCase().startsWith(lower)) push(it);
  }
  if (picked.length < 6) {
    for (const it of pool) {
      if (!it.text.toLowerCase().startsWith(lower) && it.text.toLowerCase().includes(lower)) push(it);
    }
  }
  if (picked.length === 0) return null;
  const items = picked.map((p) => p.text);
  const kinds = picked.map((p) => p.kind);
  return { line: cursor.line, col, prefix, kind: kinds[0] ?? "plain", items, kinds };
}
