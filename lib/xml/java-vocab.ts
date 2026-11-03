// lib/xml/java-vocab.ts — M96：Java 代码编辑的词汇表 + 符号栏
//
// 编辑器里 .java 文件走 CodeMirror 的 java 语法高亮，但候选列表以前只有 XML 那套
// （标签 / 属性 / 值），在 Java 里几乎等于没有。这里补三组：
//   ① 声明 / 修饰 / 控制流关键字   ② 常用类（JDK + Android）   ③ 常用方法
// 再加一条「符号栏」：Java 里高频的 {} () ; -> :: @Override 等，按 lang 切换。
//
// 纯数据 + 纯函数，方便单测；不做语义分析，只按前缀过滤 + 去重。

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
): { line: number; col: number; prefix: string; kind: "plain"; items: string[] } | null {
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

  const pool = isAt
    ? ["Override", "Test", "NonNull", "Nullable", "SuppressWarnings", "Deprecated"]
    : [...JAVA_KEYWORDS, ...JAVA_TYPES, ...JAVA_METHODS];

  const lower = body.toLowerCase();
  const seen = new Set<string>();
  const items: string[] = [];
  const push = (w: string) => {
    const key = isAt ? "@" + w : w;
    if (seen.has(key) || items.length >= MAX_ITEMS) return;
    seen.add(key);
    items.push(key);
  };
  // 第一轮只留「前缀开头」的（最常见的匹配），不够 6 条再补「包含」的
  for (const w of pool) {
    if (w.toLowerCase().startsWith(lower)) push(w);
  }
  if (items.length < 6) {
    for (const w of pool) {
      if (!w.toLowerCase().startsWith(lower) && w.toLowerCase().includes(lower)) push(w);
    }
  }
  if (items.length === 0) return null;
  return { line: cursor.line, col, prefix, kind: "plain", items };
}
