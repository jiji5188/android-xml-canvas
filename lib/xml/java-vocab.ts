// lib/xml/java-vocab.ts — M96：Java 代码编辑的词汇表 + 符号栏
//
// 编辑器里 .java 文件走 CodeMirror 的 java 语法高亮，但候选列表以前只有 XML 那套
// （标签 / 属性 / 值），在 Java 里几乎等于没有。这里补三组：
//   ① 声明 / 修饰 / 控制流关键字   ② 常用类（JDK + Android）   ③ 常用方法
// 再加一条「符号栏」：Java 里高频的 {} () ; -> :: @Override 等，按 lang 切换。
//
// 纯数据 + 纯函数，方便单测；不做语义分析，只按前缀过滤 + 去重。

import { extractJavaTokens, type SuggestKind } from "./suggest-kind";
import { getLexStore } from "./lexicon";
import { rankCandidates } from "./lexicon-rank";
import type { Lexicon } from "./lexicon";
import { KNOWN_METHODS } from "./java-methods";

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
  // M273：常用代码块（选了一整块插，光标停在要填的地方；用到的类会自动 import）
  {
    label: "onClick",
    insert: "setOnClickListener(new View.OnClickListener() {\n    @Override\n    public void onClick(View v) {\n        \n    }\n});",
    back: 10,
    title: "点击事件 setOnClickListener（光标在 onClick 内）",
  },
  {
    label: "toast",
    insert: 'Toast.makeText(this, "", Toast.LENGTH_SHORT).show();',
    back: 30,
    title: "Toast 短提示（光标在引号内）",
  },
  {
    label: "intent",
    insert: "Intent intent = new Intent(this, SecondActivity.class);\nstartActivity(intent);",
    back: 0,
    title: "跳转 Activity（改 SecondActivity 为实际类）",
  },
  {
    label: "handler",
    insert: "new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {\n    @Override\n    public void run() {\n        \n    }\n}, 1000);",
    back: 16,
    title: "延时任务 postDelayed（光标在 run 内）",
  },
  {
    label: "dialog",
    insert: 'new AlertDialog.Builder(this)\n    .setTitle("")\n    .setMessage("")\n    .setPositiveButton("确定", null)\n    .show();',
    back: 0,
    title: "AlertDialog 弹框",
  },
];

/** 简单类名 → 完整 import 路径（M273：选中候选时自动补 import）
 *  只收「包路径确定」的类；androidx / support 两派歧义的（AppCompatActivity / Fragment /
 *  RecyclerView / ConstraintLayout 等）故意不收——猜错插错反而把编译搞坏。
 *  java.lang 下的类本来就不用 import，不进表。
 */
export const JAVA_IMPORTS: Record<string, string> = {
  // android.widget
  TextView: "android.widget.TextView",
  Button: "android.widget.Button",
  ImageView: "android.widget.ImageView",
  ImageButton: "android.widget.ImageButton",
  EditText: "android.widget.EditText",
  CheckBox: "android.widget.CheckBox",
  RadioButton: "android.widget.RadioButton",
  RadioGroup: "android.widget.RadioGroup",
  Switch: "android.widget.Switch",
  ProgressBar: "android.widget.ProgressBar",
  SeekBar: "android.widget.SeekBar",
  Toast: "android.widget.Toast",
  LinearLayout: "android.widget.LinearLayout",
  FrameLayout: "android.widget.FrameLayout",
  RelativeLayout: "android.widget.RelativeLayout",
  TableLayout: "android.widget.TableLayout",
  TableRow: "android.widget.TableRow",
  ScrollView: "android.widget.ScrollView",
  HorizontalScrollView: "android.widget.HorizontalScrollView",
  ListView: "android.widget.ListView",
  GridView: "android.widget.GridView",
  Spinner: "android.widget.Spinner",
  ArrayAdapter: "android.widget.ArrayAdapter",
  BaseAdapter: "android.widget.BaseAdapter",
  Adapter: "android.widget.Adapter",
  Toolbar: "android.widget.Toolbar",
  // android.view
  View: "android.view.View",
  ViewGroup: "android.view.ViewGroup",
  LayoutInflater: "android.view.LayoutInflater",
  Gravity: "android.view.Gravity",
  MotionEvent: "android.view.MotionEvent",
  Menu: "android.view.Menu",
  MenuItem: "android.view.MenuItem",
  // android.content
  Context: "android.content.Context",
  Intent: "android.content.Intent",
  SharedPreferences: "android.content.SharedPreferences",
  DialogInterface: "android.content.DialogInterface",
  ContentValues: "android.content.ContentValues",
  // android.os
  Bundle: "android.os.Bundle",
  Handler: "android.os.Handler",
  Looper: "android.os.Looper",
  Message: "android.os.Message",
  HandlerThread: "android.os.HandlerThread",
  Build: "android.os.Build",
  // android.app
  Activity: "android.app.Activity",
  Dialog: "android.app.Dialog",
  AlertDialog: "android.app.AlertDialog",
  Application: "android.app.Application",
  Service: "android.app.Service",
  // android.util / graphics / net / text
  Log: "android.util.Log",
  SparseArray: "android.util.SparseArray",
  DisplayMetrics: "android.util.DisplayMetrics",
  Bitmap: "android.graphics.Bitmap",
  Color: "android.graphics.Color",
  Paint: "android.graphics.Paint",
  Canvas: "android.graphics.Canvas",
  Rect: "android.graphics.Rect",
  Uri: "android.net.Uri",
  TextWatcher: "android.text.TextWatcher",
  Editable: "android.text.Editable",
  InputType: "android.text.InputType",
  // java.util
  List: "java.util.List",
  ArrayList: "java.util.ArrayList",
  LinkedList: "java.util.LinkedList",
  Map: "java.util.Map",
  HashMap: "java.util.HashMap",
  LinkedHashMap: "java.util.LinkedHashMap",
  TreeMap: "java.util.TreeMap",
  Set: "java.util.Set",
  HashSet: "java.util.HashSet",
  TreeSet: "java.util.TreeSet",
  Queue: "java.util.Queue",
  Deque: "java.util.Deque",
  Collections: "java.util.Collections",
  Arrays: "java.util.Arrays",
  Objects: "java.util.Objects",
  Optional: "java.util.Optional",
  Iterator: "java.util.Iterator",
  // java.io / concurrent
  IOException: "java.io.IOException",
  File: "java.io.File",
  FileInputStream: "java.io.FileInputStream",
  FileOutputStream: "java.io.FileOutputStream",
  InputStream: "java.io.InputStream",
  OutputStream: "java.io.OutputStream",
  BufferedReader: "java.io.BufferedReader",
  BufferedWriter: "java.io.BufferedWriter",
  ExecutorService: "java.util.concurrent.ExecutorService",
  Executors: "java.util.concurrent.Executors",
};

/** M285：按「接收者类型」给的成员方法表（`button.` → 先看 Button/TextView 的方法）。
 *  只收最常见的那些类，避免表太大；每个类 10~30 个高频方法。
 *  未列出的类回退到全局 JAVA_METHODS + KNOWN_METHODS。 */
export const JAVA_TYPE_METHODS: Record<string, string[]> = {
  TextView: [
    "setText", "getText", "setTextColor", "setTextSize", "setTextStyle", "setGravity", "setHint",
    "setSingleLine", "setMaxLines", "setLines", "setEllipsize", "setTypeface", "setMovementMethod",
    "setError", "setErrorEnabled", "append", "getLineCount", "getTextLength", "getSelectedText",
    "selectAll", "setSelection", "setOnEditorActionListener", "setInputType", "isEditable", "isFocused",
  ],
  EditText: [
    "setText", "getText", "setHint", "setMaxLines", "setSingleLine", "setCursorVisible", "setSelection",
    "selectAll", "setInputType", "addTextChangedListener", "getEditableText", "setImeOptions", "setError",
  ],
  Button: [
    "setText", "getText", "setOnClickListener", "setOnLongClickListener", "setEnabled", "isEnabled", "setAllCaps",
    "setPadding", "setBackgroundResource", "setVisibility", "setVisibility", "getBackground", "invalidate", "post",
  ],
  ImageView: [
    "setImageResource", "setImageDrawable", "setImageBitmap", "setImageURI", "setScaleType", "setColorFilter",
    "setAdjustViewBounds", "setImageMatrix", "getDrawable", "isAdjustViewBounds", "setOnLongClickListener",
  ],
  View: [
    "setVisibility", "getVisibility", "setEnabled", "isEnabled", "setAlpha", "setTag", "getTag", "setId", "getId",
    "setBackgroundColor", "setBackgroundResource", "setLayoutParams", "getLayoutParams", "setPadding", "post", "postDelayed",
    "requestLayout", "invalidate", "setOnClickListener", "setOnLongClickListener", "performClick", "getWidth", "getHeight",
    "getLocationOnScreen", "getMeasuredWidth", "getMeasuredHeight", "setVisibility", "requestFocus", "clearFocus", "isSelected", "setSelected",
  ],
  ViewGroup: [
    "addView", "removeView", "removeAllViews", "getChildAt", "getChildCount", "indexOfChild", "getChildFor",
    "requestChildFocus", "setChildrenDrawnWithPadding", "getChildCount", "getChildAt", "addView", "removeViewAt",
  ],
  LinearLayout: ["setOrientation", "getOrientation", "addView", "setWeightSum", "getWeightSum", "setDividerDrawable"],
  ScrollView: ["setScrollView", "getVerticalScrollOffset", "fullScroll", "setFocusable"],
  RecyclerView: [
    "setAdapter", "getAdapter", "setLayoutManager", "getLayoutManager", "scrollToPosition", "scrollToPosition",
    "scrollBy", "getScrollState", "addOnScrollListener", "removeOnScrollListener", "setHasFixedSize", "getItemCount",
  ],
  ListView: ["setAdapter", "getAdapter", "setOnItemClickListener", "setOnItemLongClickListener", "setSelection", "getSelectedPosition"],
  AlertDialog: ["show", "dismiss", "setMessage", "setTitle", "setPositiveButton", "setNegativeButton", "setNeutralButton", "setCancelable", "isShowing"],
  Intent: [
    "putExtra", "getStringExtra", "getIntExtra", "getBooleanExtra", "putExtras", "getAction", "setAction", "getCategories",
    "setData", "setComponent", "addFlags", "getFlags", "setPackage", "setClassName", "setType", "getType", "hasExtra",
    "removeExtra", "putParcelable", "getParcelableExtra", "putStringArrayListExtra", "setResult", "setResultCode", "getResultCode",
  ],
  Bundle: ["putString", "getString", "putInt", "getInt", "putBoolean", "getBoolean", "putLong", "getLong", "putFloat", "getFloat", "putParcelable", "getParcelable", "containsKey", "keySet", "size", "isEmpty", "get", "remove", "clear", "putStringArrayList", "getStringArrayList", "putIntArrayList"],
  SharedPreferences: ["getString", "getInt", "getBoolean", "getLong", "getFloat", "getAll", "contains", "edit", "registerOnSharedPreferenceChangeListener", "unregisterOnSharedPreferenceChangeListener"],
  "SharedPreferences.Editor": ["putString", "putInt", "putBoolean", "putLong", "putFloat", "putStringSet", "putNull", "remove", "commit", "apply", "clear", "contains", "getAll", "asMap"],
  Handler: ["post", "postDelayed", "removeCallbacks", "sendEmptyMessage", "sendEmptyMessageDelayed", "sendMessage", "sendMessageDelayed", "removeCallbacksAndMessages", "hasMessages"],
  Thread: ["start", "run", "sleep", "join", "getName", "setName", "setPriority", "getPriority", "isAlive", "isInterrupted", "interrupt", "yield", "join"],
  Cursor: ["moveToFirst", "moveToNext", "moveToPrevious", "moveToPosition", "moveToLast", "isFirst", "isLast", "isBeforeFirst", "isAfterLast", "getCount", "getPosition", "getColumnCount", "getColumnIndex", "getColumnIndexOrThrow", "getColumnName", "getColumnName", "getInt", "getLong", "getFloat", "getDouble", "getString", "getBlob", "isNull", "close", "requery"],
  ContentValues: ["put", "putNull", "containsKey", "keySet", "size", "clear", "get", "getAsInteger", "getAsString", "getAsLong", "getAsBoolean", "getAsDouble"],
  Context: ["getSharedPreferences", "getResources", "getApplicationContext", "getSystemService", "getString", "getstring", "startActivity", "startService", "stopService", "registerReceiver", "unregisterReceiver", "getFilesDir", "getCacheDir", "getAssets", "openFileInput", "openFileOutput", "getPackageName", "getBaseContext", "sendBroadcast"],
  Activity: [
    "setContentView", "findViewById", "finish", "startActivity", "startActivityForResult", "getIntent", "setResult",
    "onCreate", "onStart", "onResume", "onPause", "onStop", "onDestroy", "runOnUiThread", "getSharedPreferences", "getResources",
    "getApplicationContext", "getSystemService", "getTitle", "setTitle", "getWindow", "setSoftInputMode", "setResult", "onBackPressed",
    "isFinishing", "isDestroyed", "getSupportFragmentManager", "getFragmentManager", "onActivityResult", "requestPermissions", "recreate",
  ],
  Log: ["d", "i", "w", "e", "v", "printStackTrace", "isLoggable"],
  Uri: ["parse", "toString", "getScheme", "getHost", "getPath", "getPathSegments", "getQueryParameter", "getQueryParameterNames", "getFragment", "buildUpon", "appendPath", "appendQueryParameter", "build", "encodeUri", "decodeUri"],
  Bitmap: ["getWidth", "getHeight", "getPixel", "setPixel", "copy", "copyPixelBitmap", "recycle", "isRecycled", "compress", "getByteCount", "getAllocationByteCount", "getDensity", "copyDensity"],
  String: ["length", "charAt", "substring", "toLowerCase", "toUpperCase", "trim", "isEmpty", "isBlank", "replace", "replaceAll", "split", "join", "format", "valueOf", "parseInt", "compareTo", "contains", "startsWith", "endsWith", "equals", "equalsIgnoreCase", "hashCode", "toString", "getBytes", "concat"],
  Integer: ["parseInt", "toString", "valueOf", "compareTo", "compare", "max", "min", "abs", "sum", "decode", "toHexString", "toBinaryString", "rotateLeft", "highestOneBit", "numToDigits", "size"],
  Long: ["parseLong", "toString", "valueOf", "compare", "compareTo", "max", "min", "abs", "decode", "toHexString", "size"],
  Double: ["parseDouble", "toString", "valueOf", "compare", "compareTo", "max", "min", "abs", "NaN", "isInfinite", "isFinite", "toHexString", "size"],
  Math: ["abs", "max", "min", "floor", "ceil", "round", "sqrt", "pow", "sin", "cos", "tan", "atan2", "log", "exp", "random", "E", "PI", "toInt"],
  List: ["add", "remove", "get", "set", "size", "isEmpty", "contains", "indexOf", "iterator", "toArray", "add", "addAll", "clear", "containsAll", "isEmpty", "listIterator", "removeAt", "subList"],
  Map: ["get", "put", "remove", "containsKey", "containsValue", "keySet", "values", "entrySet", "size", "isEmpty", "clear", "getOrDefault", "putIfAbsent", "computeIfAbsent", "merge", "forEach"],
  Collections: ["sort", "reverse", "shuffle", "unmodifiableList", "unmodifiableMap", "emptyList", "emptyMap", "singletonList", "singletonMap", "synchronizedList", "frequency", "max", "min", "fill"],
  Arrays: ["toString", "copyOf", "copyOfRange", "fill", "sort", "asList", "isAllocated", "equals", "binarySearch", "deepEquals", "setAll"],
};

/** 简单名 → 完整方法名映射表里没列出的，回退用 KNOWN_METHODS */
export function methodsForType(type: string): string[] {
  const arr = JAVA_TYPE_METHODS[type];
  return arr ? [...arr] : [];
}

/** 简单类名 → 该 import 的完整路径；不需 import（java.lang / 未知类）返回 null */
export function importForType(name: string): string | null {
  return JAVA_IMPORTS[name] || null;
}

export interface ImportInsert {
  /** 插入点（原文绝对偏移） */
  pos: number;
  /** 要插入的文本（可能多行 import） */
  text: string;
}

/**
 * M273：算出「把这些类 import 进去」要插在哪个位置、插什么。
 * 规则：
 *   - 已经 import（精确或通配）→ 跳过
 *   - 同名类已 import 了别的包 → 跳过（插进去会撞简单类名，编译更糟）
 *   - 插入点：最后一个 import 行之后 > package 行之后 > 文件开头
 * 全部已满足时返回 null。
 */
export function buildImportInsertMany(doc: string, fqns: string[]): ImportInsert | null {
  const targets = fqns.filter((f) => !!f);
  if (!targets.length) return null;
  const lines = doc.split("\n");
  const isImport = (t: string) => /^import\s+[\w.*]+\s*;/.test(t.trim());
  const isPkg = (t: string) => /^package\s+[\w.]+\s*;/.test(t.trim());

  const exact = new Set<string>();
  const wildcard = new Set<string>();
  const simpleToFqn = new Map<string, string>();
  for (const l of lines) {
    const t = l.trim();
    const w = t.match(/^import\s+([\w.]+)\.\*\s*;/);
    if (w) { wildcard.add(w[1]); continue; }
    const m = t.match(/^import\s+([\w.]+)\s*;/);
    if (m) {
      const fqn = m[1];
      exact.add(fqn);
      simpleToFqn.set(fqn.slice(fqn.lastIndexOf(".") + 1), fqn);
    }
  }

  const need: string[] = [];
  for (const fqn of targets) {
    const pkg = fqn.slice(0, fqn.lastIndexOf("."));
    const simple = fqn.slice(fqn.lastIndexOf(".") + 1);
    if (exact.has(fqn)) continue;
    if (wildcard.has(pkg)) continue;
    const other = simpleToFqn.get(simple);
    if (other && other !== fqn) continue; // 同名类已在别包，别插
    if (!need.includes(fqn)) need.push(fqn);
  }
  if (!need.length) return null;

  // 插入点：最后一个 import 之后；没有 import 就 package 之后；再没有就文件开头
  let lastImport = -1;
  let pkgLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isPkg(t)) { pkgLine = i; continue; }
    if (isImport(t)) { lastImport = i; continue; }
    // 骨架之外遇到第一行内容就停（注释行不算）
    if (t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*")) break;
  }
  let lineIdx = 0;
  if (lastImport >= 0) lineIdx = lastImport + 1;
  else if (pkgLine >= 0) lineIdx = pkgLine + 1;

  let pos = 0;
  for (let i = 0; i < lineIdx && i < lines.length; i++) pos += lines[i].length + 1;
  if (lineIdx >= lines.length) pos = doc.length;

  const text = need.map((f) => `import ${f};\n`).join("");
  return { pos, text };
}

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
  lex?: Lexicon, // M352：项目词库（传了就走打分排序；没传保留旧行为）
  recency?: Map<string, number>, // M352 M3：使用记忆（近期选中过的高分）
): { line: number; col: number; prefix: string; kind: SuggestKind; items: string[]; kinds: SuggestKind[]; subs?: (string | undefined)[] } | null {
  const lines = doc.split("\n");
  const li = Math.max(0, Math.min(cursor.line - 1, lines.length - 1));
  const lineText = lines[li] ?? "";
  const col = Math.max(1, Math.min(cursor.col, lineText.length + 1));
  const offset = lines.slice(0, li).reduce((n, l) => n + l.length + 1, 0) + col - 1;

  if (inComment(doc, offset) || inString(doc, offset)) return null;

  // M285：检测 `receiver.` 后的方法调用 —— 根据 receiver 的声明类型给成员方法表
  let receiver: string | null = null;
  let receiverType: string | null = null;
  const { prefix, start: prefixStart } = wordBefore(doc, offset);
  if (prefixStart > 0 && doc[prefixStart - 1] === ".") {
    // 当前词紧跟在 . 后面 → 取 . 左边的标识符
    let rs = prefixStart - 1;
    while (rs > 0 && /[A-Za-z0-9_]/.test(doc[rs - 1])) rs--;
    receiver = doc.slice(rs, prefixStart - 1);
    if (receiver && receiver !== "this" && /^[A-Za-z_]\w*$/.test(receiver)) {
      // 在文件里找 `X receiver` 声明拿到 X（跳过 receiver 自身那行，找类型）
      const declRe = new RegExp("\\b([A-Za-z_][\\w.]*)\\s+" + receiver + "\\b\\s*[=(]");
      const dm = declRe.exec(doc);
      if (dm) receiverType = dm[1].replace(/^.*\./, "");
    }
  }
  const isAt = prefix.startsWith("@");
  const body = isAt ? prefix.slice(1) : prefix;
  if (body.length < 2 && !isAt) return null;

  // M99：本文件已有的变量/常量/方法/类型/引用排在词表前面
  //        ——写 `user` 时最想看到的是这个文件里的 userName，而不是 JDK 的 UserManager
  const tok = extractJavaTokens(doc);
  // M352 M3：候选条目带归属签名（第二行）
  const pool: { text: string; kind: SuggestKind; signature?: string }[] = [];
  const addAll = (words: string[], kind: SuggestKind) => {
    for (const w of words) pool.push({ text: w, kind });
  };
  if (isAt) {
    addAll(["Override", "Test", "NonNull", "Nullable", "SuppressWarnings", "Deprecated"].map((a) => "@" + a), "ref");
  } else {
    // M352：有项目词库 → 候选池以词库（打分排序）为主，再并 JDK 类型/关键字兜底
    if (lex && lex.allMethodNames.size > 0) {
      const ranked = rankCandidates(body, {
        lex,
        currentFile: { methods: tok.methods, classes: tok.types, fields: tok.consts, vars: tok.vars },
        receiverType,
        receiver,
      }, { recency });
      for (const it of ranked.ui) {
        pool.push({ text: it.text, kind: it.kind === "const" ? "const" : it.kind, signature: it.signature });
      }
      // JDK 类型 + 关键字兜底（词库没覆盖的基础类型）
      addAll(JAVA_KEYWORDS, "decl");
      addAll(JAVA_TYPES, "class");
      // M355：词库分支也别把旧的宽池子丢了——M285 高频方法白名单 / 全量 JAVA_METHODS /
      //   本文件引用符号 tok.refs，以前无词库时全进候选，现在项目文件都建了词库，
      //   若不并回来，打字时 setText/findViewById 这些全局方法就看不到了（用户反馈丢功能）。
      //   放在 ranked.ui 之后，词库打分的仍排前面，宽池子只做补充。
      addAll(JAVA_METHODS, "method");
      addAll(KNOWN_METHODS, "method");
      addAll(tok.refs, "ref");
    } else {
      addAll(tok.vars, "var");
      addAll(tok.consts, "const");
      addAll(tok.methods, "method");
      addAll(tok.refs, "ref");
      addAll(tok.types, "class");
      addAll(JAVA_KEYWORDS, "decl");
      addAll(JAVA_TYPES, "class");
      addAll(JAVA_METHODS, "method");
      addAll(KNOWN_METHODS, "method"); // M285：高频白名单全量进候选（以前只有 JAVA_METHODS 里那几十条）
      // M285：有接收者且能认出类型 → 该类的高频成员方法排在最前（比全局表更准）
      if (receiverType && receiver !== "this") {
        const recv = methodsForType(receiverType);
        // 逆序 unshift，保持原数组顺序（setText 在数组前 → 排在前）
        for (const m of [...recv].reverse()) pool.unshift({ text: m, kind: "method" });
        pool.unshift({ text: receiverType, kind: "class" });
      }
    }
  }

  const lower = body.toLowerCase();
  const seen = new Set<string>();
  const picked: { text: string; kind: SuggestKind; signature?: string }[] = [];
  const push = (it: { text: string; kind: SuggestKind; signature?: string }) => {
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
  // M352 M3：第二行签名统一包成 (参数)（空参数显示 "()"，一眼看出是方法且无参）
  const subs = picked.map((p) => (p.signature !== undefined ? "(" + p.signature + ")" : undefined));
  return { line: cursor.line, col, prefix, kind: kinds[0] ?? "plain", items, kinds, subs };
}
