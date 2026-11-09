// lib/xml/java-case.ts — M206：大小写敏感检查（Java / Kotlin 区分大小写）
//
// 场景：`string s = "x";`（应为 String）、`toast.makeText(...)`（应为 Toast）、
//       `textview.setText(...)`（应为 TextView）。
// 这些写法在 Java/Kotlin 里都是编译错误（identifier cannot be resolved），
// 但不像"拼写错一个字母"那样能被编辑距离抓到——它们只差大小写。
//
// 做法：拿已知类名/方法名建「小写索引」，遇到「不是正确写法、但小写后能对上」
// 的标识符 → 报「大小写写错了」。误报可控：只有已知名单里的才查。

import { KNOWN_METHODS } from "./java-methods";

/** 常见 Java / Android 类型（正确大小写） */
export const KNOWN_TYPES: string[] = [
  // Java 基础
  "String", "Integer", "Long", "Double", "Float", "Boolean", "Character", "Byte", "Short",
  "Object", "Number", "CharSequence", "StringBuilder", "StringBuffer", "Math", "System",
  "Thread", "RuntimeException", "Exception", "Error", "Throwable", "Override", "SuppressWarnings",
  // 集合
  "List", "ArrayList", "LinkedList", "Map", "HashMap", "LinkedHashMap", "Set", "HashSet",
  "TreeMap", "TreeSet", "Iterator", "Collections", "Arrays", "Optional",
  // 并发/IO
  "Handler", "Looper", "Message", "Runnable", "Callable", "Future", "Executor", "ExecutorService",
  "File", "InputStream", "OutputStream", "FileInputStream", "FileOutputStream", "BufferedReader",
  "BufferedWriter", "IOException", "Reader", "Writer", "Stream",
  // Android 核心
  "Activity", "Fragment", "Application", "Context", "Intent", "Bundle", "View", "ViewGroup",
  "LayoutInflater", "Toast", "Dialog", "AlertDialog", "Builder", "Window", "WindowManager",
  "SharedPreferences", "Editor", "Resources", "Color", "Drawable", "Bitmap", "BitmapFactory",
  "Uri", "MediaStore", "ContentResolver", "ContentValues", "Cursor", "SQLiteDatabase",
  "Log", "Build", "R", "Manifest", "Service", "BroadcastReceiver", "ContentProvider",
  "Lifecycle", "ViewModel", "LiveData", "MutableLiveData", "Observer",
  // 控件
  "TextView", "EditText", "Button", "ImageView", "ImageButton", "CheckBox", "RadioButton",
  "RadioGroup", "Switch", "ToggleButton", "SeekBar", "ProgressBar", "Spinner", "ListView",
  "GridView", "RecyclerView", "ScrollView", "HorizontalScrollView", "LinearLayout",
  "RelativeLayout", "FrameLayout", "ConstraintLayout", "TableLayout", "TableRow",
  "Toolbar", "ActionBar", "MenuItem", "Menu", "MenuInflater", "WebView", "VideoView",
  "SurfaceView", "CardView", "Snackbar", "FloatingActionButton", "TextInputLayout",
  // 动画/图形
  "Animation", "Animator", "ObjectAnimator", "ValueAnimator", "Canvas", "Paint", "Rect",
  "Path", "Matrix", "Gravity", "TypedValue", "TypedArray",
  // 网络/JSON
  "JSONObject", "JSONArray", "HttpURLConnection", "URL", "URLConnection", "OkHttpClient",
  "Request", "Response", "Gson",
  // 工具
  "Arrays", "Objects", "Collections", "TextUtils", "Pattern", "Matcher", "Date", "Calendar",
  "SimpleDateFormat", "TimeUnit", "UUID", "Random", "Locale", "Comparator",
];

export interface CaseMismatch {
  line: number;
  col: number;
  len: number;
  /** 写错的名字（如 string / toast / textview） */
  written: string;
  /** 正确写法（String / Toast / TextView） */
  correct: string;
  kind: "type" | "method";
}

// 小写 → 正确写法（一个名字只保留第一个，避免重名冲突）
const TYPE_MAP = new Map<string, string>();
const TYPE_SET = new Set<string>();
for (const t of KNOWN_TYPES) {
  TYPE_SET.add(t);
  const k = t.toLowerCase();
  if (!TYPE_MAP.has(k)) TYPE_MAP.set(k, t);
}
const METHOD_MAP = new Map<string, string>();
const METHOD_SET = new Set<string>();
for (const m of KNOWN_METHODS) {
  METHOD_SET.add(m);
  const k = m.toLowerCase();
  if (!METHOD_MAP.has(k)) METHOD_MAP.set(k, m);
}

// Java/Kotlin 关键字（不查大小写，避免把 if/for 报成 If/For）
const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "return", "throw", "throws", "try", "catch", "finally", "new", "this", "super", "null",
  "true", "false", "class", "interface", "enum", "extends", "implements", "public", "private",
  "protected", "static", "final", "abstract", "synchronized", "volatile", "transient", "native",
  "void", "int", "long", "double", "float", "boolean", "char", "byte", "short", "package",
  "import", "instanceof", "assert", "var", "val", "fun", "object", "when", "is", "as", "in",
  "out", "let", "run", "apply", "also", "with", "typealias", "companion", "data", "sealed",
  "override", "open", "internal", "lateinit", "suspend", "inline", "reified",
]);

/**
 * 找大小写写错的类型名/方法名。
 * @param declared 本文件自己声明的方法/类名（不查，避免误报）
 */
export function findCaseMismatches(
  code: string,
  declared: Iterable<string> = [],
): CaseMismatch[] {
  const out: CaseMismatch[] = [];
  const declaredSet = new Set<string>(declared);
  const seen = new Set<string>();
  const lines = code.split("\n");

  const push = (name: string, line: number, col: number, kind: "type" | "method", correct: string) => {
    const key = name + "@" + line + ":" + col;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line, col, len: name.length, written: name, correct, kind });
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const trimmed = ln.trim();
    // 跳过注释行
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // 1) 方法调用：`.name(` 里的 name
    for (const m of ln.matchAll(/\.\s*([A-Za-z_]\w*)\s*\(/g)) {
      const name = m[1];
      if (name.length < 3) continue;
      if (declaredSet.has(name)) continue;
      if (METHOD_SET.has(name)) continue; // 正确写法
      const low = name.toLowerCase();
      const correct = METHOD_MAP.get(low);
      if (correct && correct !== name) {
        const prefix = m[0].slice(0, m[0].indexOf(name));
        push(name, i + 1, m.index + prefix.length + 1, "method", correct);
      }
    }

    // 2) 声明位置的类型名：`Type name =` / `Type name;` / `Type name(`
    for (const m of ln.matchAll(/(?:^|[^\w.])([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=|;|,|\)|:)/g)) {
      const typeName = m[1];
      if (typeName.length < 3) continue;
      if (KEYWORDS.has(typeName)) continue;
      if (declaredSet.has(typeName)) continue;
      if (TYPE_SET.has(typeName)) continue; // 正确写法
      const low = typeName.toLowerCase();
      const correct = TYPE_MAP.get(low);
      if (correct && correct !== typeName) {
        const at = m.index + (m[1] ? m[0].indexOf(typeName) : 0);
        push(typeName, i + 1, at + 1, "type", correct);
      }
    }
  }
  return out;
}
