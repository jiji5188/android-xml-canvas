// lib/xml/java-vocab.ts — M96：Java 代码编辑的词汇表 + 符号栏
//
// 编辑器里 .java 文件走 CodeMirror 的 java 语法高亮，但候选列表以前只有 XML 那套
// （标签 / 属性 / 值），在 Java 里几乎等于没有。这里补三组：
//   ① 声明 / 修饰 / 控制流关键字   ② 常用类（JDK + Android）   ③ 常用方法
// 再加一条「符号栏」：Java 里高频的 {} () ; -> :: @Override 等，按 lang 切换。
//
// 纯数据 + 纯函数，方便单测；不做语义分析，只按前缀过滤 + 去重。

import { extractJavaTokens, extractScopedSymbols, KIND_PRIORITY, RECEIVER_KIND_PRIORITY, type SuggestKind } from "./suggest-kind";
import { getLexStore } from "./lexicon";
import { rankCandidates } from "./lexicon-rank";
import type { Lexicon } from "./lexicon";
import { KNOWN_METHODS } from "./java-methods";
import { extractDocSymbolTypes, varTypeAt, retTypeOf, fqnOf } from "./doc-symbol-types";
import { rTableTypes, type RIndex } from "./r-index";

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
  // M455：监听器匿名类模板要用到的类型（自动补 import）
  AdapterView: "android.widget.AdapterView",
  AbsListView: "android.widget.AbsListView",
  CompoundButton: "android.widget.CompoundButton",
  RatingBar: "android.widget.RatingBar",
  SearchView: "android.widget.SearchView",
  MediaPlayer: "android.media.MediaPlayer",
  KeyEvent: "android.view.KeyEvent",
  DragEvent: "android.view.DragEvent",
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
  // M393：Object —— 所有类的默认基类（不写字面类型/import/var 时 receiver 多半解析到它）
  //   obj. 弹这些：toString/equals/hashCode/getClass/notify/notifyAll/wait/clone
  Object: ["toString", "hashCode", "equals", "getClass", "notify", "notifyAll", "wait", "clone"],
  // M395：Toast 常用的静态方法（Toast.makeText / show）
  Toast: ["makeText", "show", "cancel", "setGravity", "setDuration", "setView", "getView", "setText"],
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

/** M396：整个类都是静态方法的类型 */
const ALL_STATIC_TYPES = new Set(["Math", "Collections", "Arrays"]);
/** M396：已知的静态方法（`类型.方法`）—— 其余按实例方法（public） */
const STATIC_TYPE_METHODS = new Set([
  "Toast.makeText",
  "Log.d", "Log.e", "Log.i", "Log.v", "Log.w",
  "String.valueOf", "String.format",
  "Integer.parseInt", "Integer.valueOf",
  "Long.parseLong", "Long.valueOf",
  "Double.parseDouble", "Double.valueOf",
  "Uri.parse", "Uri.fromFile",
  "Bitmap.createBitmap",
  "Thread.sleep", "Thread.currentThread",
  "Context.getSystemService",
]);

/** M396：SDK 类型方法的修饰符（成员列表展示用）。SDK 方法默认 public；静态的补充 static */
export function modForTypeMethod(type: string, name: string): string {
  if (ALL_STATIC_TYPES.has(type) || STATIC_TYPE_METHODS.has(type + "." + name)) return "public static";
  return "public";
}

/** M391：按「接收者类型」给的公开常量/字段表（`fn.VISIBLE` / `ll.VERTICAL` 之类）。
 *  只收高频的几个；每个类几个到十几个，避免表爆炸。
 *  这些是 static 常量，作为字段（var 类）进候选，kind 仍按 const。 */
export const JAVA_TYPE_CONSTANTS: Record<string, string[]> = {
  View: ["VISIBLE", "INVISIBLE", "GONE", "FOCUSABLE", "FOCUSABLES_TOUCH_MODE"],
  LinearLayout: ["HORIZONTAL", "VERTICAL"],
  ScrollView: ["FOCUSABLE", "GONE"],
  Gravity: ["TOP", "BOTTOM", "LEFT", "RIGHT", "CENTER", "CENTER_VERTICAL", "CENTER_HORIZONTAL", "CENTER_IN_PARENT", "START", "END"],
  LayoutParams: ["MATCH_PARENT", "WRAP_CONTENT"],
  Integer: ["MAX_VALUE", "MIN_VALUE", "SIZE"],
  Long: ["MAX_VALUE", "MIN_VALUE"],
  Double: ["NaN", "POSITIVE_INFINITY", "NEGATIVE_INFINITY"],
  Math: ["PI", "E"],
  ViewF: ["VISIBLE", "INVISIBLE", "GONE"],
};

/** 某类型的公开常量（继承：TextView/EditText 也认 View 的 VISIBLE/GONE） */
export function constantsForType(type: string): string[] {
  const out = new Set<string>();
  const direct = JAVA_TYPE_CONSTANTS[type];
  if (direct) for (const c of direct) out.add(c);
  // 常见继承链：View 的子类共享 VISIBLE/GONE/INVISIBLE
  if (["TextView", "EditText", "Button", "ImageView", "ViewGroup", "LinearLayout", "ScrollView", "RecyclerView", "ListView"].includes(type)) {
    for (const c of JAVA_TYPE_CONSTANTS.View ?? []) out.add(c);
  }
  return [...out];
}

/** M452：receiver 类型的方法返回类型表（name → ret），用于给静态表里的裸方法名补返回类型 */
function retMapForType(lex: Lexicon | undefined | null, type: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!lex || !type) return m;
  for (const x of resolveTypeMethodsFromLex(lex, type)) if (x.ret && !m.has(x.name)) m.set(x.name, x.ret);
  return m;
}

/** M453：receiver 类型的参数类型表（name → "Runnable, long"，无参 = ""），用于给静态表里的裸方法名补参数 */
function sigMapForType(lex: Lexicon | undefined | null, type: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!lex || !type) return m;
  for (const x of resolveTypeMethodsFromLex(lex, type))
    if (x.signature !== undefined && !m.has(x.name)) m.set(x.name, x.signature);
  return m;
}

/** 项目词库里某类型的成员方法（含继承/接口），返回 {name, signature, isDeprecated}。SDK 类不在词库 → 空 */
export function resolveTypeMethodsFromLex(
  lex: Lexicon | null | undefined,
  type: string,
): { name: string; signature?: string; isDeprecated: boolean; mod?: string; ret?: string }[] {
  if (!lex || !type) return [];
  const out: { name: string; signature?: string; isDeprecated: boolean; mod?: string; ret?: string }[] = [];
  const seen = new Set<string>();
  const walk = (c: string, depth: number): void => {
    if (depth > 8 || seen.has(c)) return;
    seen.add(c);
    const ms = lex.methods.get(c);
    if (ms)
      for (const m of ms)
        out.push({ name: m.name, signature: m.signature, isDeprecated: !!m.isDeprecated, mod: m.mod, ret: m.ret });
    const cls = lex.classes.get(c);
    if (cls) for (const p of [...cls.parents, ...cls.interfaces]) walk(p, depth + 1);
  };
  walk(type, 0);
  // 去重（同名同签名）
  const dedup = new Set<string>();
  return out.filter((m) => {
    const k = m.name + "|" + (m.signature ?? "");
    if (dedup.has(k)) return false;
    dedup.add(k);
    return true;
  });
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

/** 类型名简化：`List<String>` → `List`；`android.widget.TextView` → `TextView` */
function rawSimpleType(t: string): string {
  let s = t.trim();
  const lt = s.indexOf("<");
  if (lt >= 0) s = s.slice(0, lt);
  s = s.replace(/\[\s*\]/g, "");
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/**
 * M395：receiver 是否更像「类名」（静态成员访问，如 Toast./String./Integer.）。
 * 是的话按静态访问处理（列该类成员），而不是当未知变量。
 */
function isKnownClassRef(name: string, lex?: Lexicon | null): boolean {
  if (JAVA_TYPE_METHODS[name] || JAVA_TYPE_CONSTANTS[name]) return true;
  if (JAVA_TYPES.includes(name)) return true;
  if (lex) {
    if (lex.classes.has(name)) return true;
    for (const c of lex.classes.values()) if (c.name === name) return true;
  }
  // Java 命名惯例：类型名大写开头，变量/字段小写开头
  return /^[A-Z]/.test(name);
}

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

/** 候选说明行的输入形状（pool / cand / memberMode 共用） */
type SubItem = {
  text: string;
  kind: SuggestKind;
  signature?: string;
  mod?: string;
  ret?: string;
  fqn?: string;
};

/**
 * M441：候选说明行 —— 让用户一眼看出「这是什么东西」：
 *   变量 → 声明类型（TextView / int）
 *   方法 → 返回类型（有返回值才写，void 不写）
 *   类   → 完整类名（android.widget.TextView）
 * 查不到就退回旧行为（签名 / 修饰符），不编造。
 */
function subForItem(it: SubItem, docSym: ReturnType<typeof extractDocSymbolTypes>, lex: Lexicon | undefined, offset: number): string | undefined {
  const t = it.text;
  const modSuffix = it.mod ? " · " + it.mod : "";
  if (it.kind === "var") {
    // M441：变量的声明类型（本文件里能查到就显示）
    return varTypeAt(docSym, t, offset) ?? (it.mod || undefined);
  }
  if (it.kind === "class" || it.kind === "ref") {
    // M441：类候选统一给完整类名（`ref` 也常是类引用，如文档里出现过的 TextView）
    if (t.startsWith("@") || t.startsWith("R.")) return undefined;
    const fqn = it.fqn ?? JAVA_IMPORTS[t] ?? fqnOf(docSym, t) ?? lex?.classes.get(t)?.fqn;
    if (fqn && fqn !== t) return fqn;
    return undefined;
  }
  if (it.kind === "method") {
    // M453：参数已移到主行 `name(参数)`，说明行只留「修饰符 · 返回类型」
    const ret = it.ret ?? retTypeOf(docSym, t);
    if (ret) return it.mod ? it.mod + " · " + ret : ret;
    return it.mod || undefined;
  }
  if (it.kind === "const" && it.mod) return it.mod;
  if (it.signature !== undefined) return "(" + it.signature + ")" + modSuffix;
  return undefined;
}

/**
 * Java 候选：关键字 / 类型 / 方法三组按前缀过滤，保留原顺序（常用优先）。
 * 前缀长度 < 1 返回 null；`@` 开头直接给注解。
 */
export function computeJavaSuggest(
  doc: string,
  cursor: { line: number; col: number },
  lex?: Lexicon, // M352：项目词库（传了就走打分排序；没传保留旧行为）
  recency?: Map<string, number>, // M352 M3：使用记忆（近期选中过的高分）
  rIndex?: RIndex | null, // M465：项目 R 表索引（R. / R.layout. 候选）
): { line: number; col: number; prefix: string; kind: SuggestKind; items: string[]; kinds: SuggestKind[]; subs?: (string | undefined)[]; sigs?: (string | undefined)[] } | null {
  const lines = doc.split("\n");
  const li = Math.max(0, Math.min(cursor.line - 1, lines.length - 1));
  const lineText = lines[li] ?? "";
  const col = Math.max(1, Math.min(cursor.col, lineText.length + 1));
  const offset = lines.slice(0, li).reduce((n, l) => n + l.length + 1, 0) + col - 1;

  if (inComment(doc, offset) || inString(doc, offset)) return null;

  // M441：文档内「变量类型 / 方法返回类型 / 类全名」——候选说明行用（纯文本近似，查不到就不写）
  const docSym = extractDocSymbolTypes(doc);

  // M285：检测 `receiver.` 后的方法调用 —— 根据 receiver 的声明类型给成员方法表
  let receiver: string | null = null;
  let receiverType: string | null = null;
  const { prefix, start: prefixStart } = wordBefore(doc, offset);
  const afterDot = prefixStart > 0 && doc[prefixStart - 1] === ".";
  // M465：R 表引用（R. / R.layout. / R.string.xxx）
  let rMode: "table" | "names" | null = null;
  let rType = "";
  if (afterDot) {
    // 当前词紧跟在 . 后面 → 取 . 左边的标识符
    let rs = prefixStart - 1;
    while (rs > 0 && /[A-Za-z0-9_$]/.test(doc[rs - 1])) rs--;
    receiver = doc.slice(rs, prefixStart - 1);
    // M465：receiver 就是 R → 列类型表；receiver 是类型且前面是「R.」→ 列该类型资源名
    if (rIndex) {
      if (receiver === "R") rMode = "table";
      else if (rs > 0 && doc[rs - 1] === ".") {
        let ps = rs - 1;
        let qs = ps;
        while (qs > 0 && /[A-Za-z0-9_$]/.test(doc[qs - 1])) qs--;
        if (doc.slice(qs, ps) === "R" && rIndex[receiver]?.length) {
          rMode = "names";
          rType = receiver;
        }
      }
    }
    if (receiver && receiver !== "this" && receiver !== "super" && /^[A-Za-z_]\w*$/.test(receiver)) {
      // 在文件里找 `X receiver` 声明拿到 X（跳过 receiver 自身那行，找类型）
      // M389：receiver 类型解析（之前只认 `Type x =`，漏了字段声明 `Type x;`）+ 词库字段表兜底
      // M395：终止符扩到 `[=;:,)]`（漏了方法参数 `Type x,` / `Type x)`、增强 for `Type x :`）；
      //   类型捕获允许泛型 `List<String>`
      const declRe = new RegExp(
        "\\b([A-Za-z_][\\w.]*(?:<[^<>]*>)?)\\s+" + receiver + "\\b\\s*[=;:,)]",
      );
      const dm = declRe.exec(doc);
      if (dm) receiverType = rawSimpleType(dm[1]);
      if (!receiverType && lex) {
        for (const [cls, set] of lex.fields) {
          if (set.has(receiver)) {
            receiverType = cls;
            break;
          }
        }
      }
      // M395：receiver 本身是已知类名（大写开头 / 词库里有的类 / 有方法表）→ 静态访问 Toast./String.
      if (!receiverType && isKnownClassRef(receiver, lex)) receiverType = receiver;
    }
  }
  const isAt = prefix.startsWith("@");
  const body = isAt ? prefix.slice(1) : prefix;

  // M465：R 表候选——R. 列类型（layout/string/...）；R.layout. 列该项目里的资源名
  if (rMode && rIndex) {
    const lp = body.toLowerCase();
    const wantR = (t: string) => !lp || t.toLowerCase().startsWith(lp);
    if (rMode === "table") {
      const types = rTableTypes(rIndex).filter(wantR).slice(0, MAX_ITEMS);
      if (!types.length) return null;
      return {
        line: cursor.line,
        col,
        prefix,
        kind: "const",
        items: types,
        kinds: types.map(() => "const" as SuggestKind),
        subs: types.map((t) => `R.${t} · ${(rIndex[t] || []).length} 项`),
        sigs: types.map(() => undefined),
      };
    }
    const names = (rIndex[rType] || []).filter(wantR).slice(0, MAX_ITEMS);
    if (!names.length) return null;
    const pickedNames = names;
    return {
      line: cursor.line,
      col,
      prefix,
      kind: "const",
      items: pickedNames,
      kinds: pickedNames.map(() => "const" as SuggestKind),
      subs: pickedNames.map((n) => `R.${rType}.${n}`),
      sigs: pickedNames.map(() => undefined),
    };
  }
  // M395：receiver 解析不到类型、又不是 this/super → 不弹候选（M465：R 表分支已提前返回，此处排除 rMode 避免重复）
  //   否则会退回通用池，把「本类方法」当成 j 的成员弹出来（用户实测：j 未声明时打 j.my 弹出 myMethod）。
  if (afterDot && receiver && receiver !== "this" && receiver !== "super" && !receiverType && !rMode) return null;
  // M392：普通词放开成 1 字母就弹（之前是 ≥2）。
  //   依据：候选池已按「词库 + 作用域」收窄过（类名只弹 import/项目里出现过的，变量只弹本方法+本类，方法没有类前提就不弹类里方法），
  //   且弹窗本身有最大高度（超了内部滚动，不会满屏）——所以 1 字母弹 10~20 条完全可接受，少打一个字更顺。
  //   memberMode（receiver 点号后）仍允许空前缀直接列成员。
  const memberMode = !isAt && !!receiverType && body.length < 2;
  if (body.length < 1 && !isAt && !memberMode && !rMode) return null;

  // M391：成员列表模式 —— `fn.` 刚打完点号（body 为空）或打了 1 个字母，
  //   直接按 receiver 类型列「公开方法 + 公开常量/字段」，不掺入全局/当前文件的泛用池，
  //   避免一上来弹一堆无关项目方法。1 字符时按前缀过滤，空时全列（限 24）。
  if (memberMode && receiverType) {
    const items: { text: string; kind: SuggestKind; signature?: string; mod?: string; ret?: string }[] = [];
    const p = body.toLowerCase();
    const want = (t: string) => !p || t.toLowerCase().startsWith(p);
    // M452/M453：静态表只有方法名，返回类型 / 参数从词库（SDK 索引）补
    const retMap = retMapForType(lex, receiverType);
    const sigMap = sigMapForType(lex, receiverType);
    for (const m of methodsForType(receiverType))
      if (want(m))
        items.push({
          text: m,
          kind: "method",
          signature: sigMap.has(m) ? sigMap.get(m) : undefined,
          mod: modForTypeMethod(receiverType, m),
          ret: retMap.get(m),
        });
    for (const c of constantsForType(receiverType)) if (want(c)) items.push({ text: c, kind: "const", mod: "public static" });
    // 项目词库里该类的方法（继承/接口）也并进来，排在 JDK 表后面
    for (const m of resolveTypeMethodsFromLex(lex, receiverType)) {
      if (want(m.name) && !items.some((x) => x.text === m.name))
        items.push({
          text: m.name,
          kind: "method",
          signature: m.signature,
          mod: m.mod ?? "public",
          ret: m.ret,
        });
    }
    if (items.length === 0) return null;
    const picked = items.slice(0, MAX_ITEMS);
    return {
      line: cursor.line,
      col,
      prefix,
      kind: picked[0].kind,
      items: picked.map((x) => x.text),
      kinds: picked.map((x) => x.kind),
      // M453：主行显示 `name(参数)`；说明行只留「修饰符 · 返回类型」
      sigs: picked.map((x) => (x.kind === "method" && x.signature !== undefined ? x.signature : undefined)),
      subs: picked.map((x) => subForItem(x, docSym, lex, offset)),
    };
  }

  // M99：本文件已有的变量/常量/方法/类型/引用排在词表前面
  //        ——写 `user` 时最想看到的是这个文件里的 userName，而不是 JDK 的 UserManager
  const tok = extractJavaTokens(doc);
  // M389：作用域感知 —— 当前方法体内的局部变量 + 类成员（字段/常量）
  const scoped = extractScopedSymbols(doc, offset);
  // M352 M3：候选条目带归属签名（第二行）；M396：再带修饰符（静态/公开/私有）
  const pool: SubItem[] = [];
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
        // M389：当前文件符号走作用域过滤 —— 局部变量只给光标所在方法的；字段/常量类作用域处处给。
        //   types 仍全文（类名处处可见），methods 全文（调用过的方法名作参考）。
        currentFile: { methods: tok.methods, classes: tok.types, fields: scoped.consts, vars: [...scoped.locals, ...scoped.fields] },
        receiverType,
        receiver,
      }, { recency });
      for (const it of ranked.ui) {
        pool.push({ text: it.text, kind: it.kind === "const" ? "const" : it.kind, signature: it.signature, mod: it.mod, ret: it.ret, fqn: it.fqn });
      }
      // M389：receiver 类型能认出且是 SDK 类（词库只有项目类）→ 把该类的高频成员方法并进池子，
      //   插到 pool 最前（比宽池子更准）。`titleView.` → setText/getText 排最前。
      if (receiverType && receiver !== "this") {
        const recv = methodsForType(receiverType);
        const retMap = retMapForType(lex, receiverType);
        // M453：参数也从词库（SDK 索引）补，主行显示 `name(参数)`
        const sigMap = sigMapForType(lex, receiverType);
        for (const m of [...recv].reverse())
          pool.unshift({
            text: m,
            kind: "method",
            signature: sigMap.has(m) ? sigMap.get(m) : undefined,
            mod: modForTypeMethod(receiverType, m),
            ret: retMap.get(m),
          });
        pool.unshift({ text: receiverType, kind: "class", fqn: JAVA_IMPORTS[receiverType] ?? lex.classes.get(receiverType)?.fqn });
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
        for (const m of [...recv].reverse()) pool.unshift({ text: m, kind: "method", mod: modForTypeMethod(receiverType, m) });
        pool.unshift({ text: receiverType, kind: "class", fqn: JAVA_IMPORTS[receiverType] });
      }
    }
  }

  const lower = body.toLowerCase();
  const seen = new Set<string>();
  // M394：候选带「匹配档位」（0=完全相等 / 1=前缀开头 / 2=中间包含），
  //   最后按 [档位, 类型层级] 排 —— 用户要的：声明 > 变量 > 常量 > 类 > 方法。
  //   先全收再排再截断（否则 24 条上限会先被方法占满，关键词根本挤不进来）。
  const cand: (SubItem & { tier: number; idx: number })[] = [];
  let seq = 0;
  const push = (it: SubItem, tier: number) => {
    // M99：自己不要当候选（文档 token 会把刚打的半个词也扫进来）
    // M390：关键词豁免 —— 关键词来自静态表（不是从文档扫的），不会被半截词污染；
    //   不豁免的话 `if`/`do` 这种 2 字符关键词永远弹不出来（打 1 字符不够最短，打满 2 字符=完整词被跳过）
    if ((it.text === prefix || it.text === body) && it.kind !== "decl") return;
    if (seen.has(it.text)) return;
    seen.add(it.text);
    cand.push({ ...it, tier, idx: seq++ });
  };
  // 第一轮：完全相等（M390：打满 int 应 int 在 interface 前）
  for (const it of pool) {
    if (it.text.toLowerCase() === lower) push(it, 0);
  }
  // 第二轮：前缀开头
  for (const it of pool) {
    const t = it.text.toLowerCase();
    if (t !== lower && t.startsWith(lower)) push(it, 1);
  }
  // 第三轮：不够 6 条才补「包含」
  if (cand.length < 6) {
    for (const it of pool) {
      const t = it.text.toLowerCase();
      if (!t.startsWith(lower) && t.includes(lower)) push(it, 2);
    }
  }
  if (cand.length === 0) return null;
  // M394：档位 → 类型层级 → 原顺序（稳定）
  //   注意：仅在「无 receiver」的通用词库场景按 声明>变量>常量>类>方法 排。
  //   有 receiver（fn./obj.）时是「某类的成员」语义，必须维持方法优先（receiver 方法已被 unshift 到池最前），
  //   否则打 fn.se 会先弹关键词 sealed、打 obj.to 会先弹类 Toast（实测回归）。
  if (receiverType) {
    // receiver 上下文：方法优先（成员语义），但仍按档位分
    cand.sort(
      (a, b) =>
        a.tier - b.tier ||
        (RECEIVER_KIND_PRIORITY[a.kind] ?? 6) - (RECEIVER_KIND_PRIORITY[b.kind] ?? 6) ||
        a.idx - b.idx,
    );
  } else {
    cand.sort(
      (a, b) =>
        a.tier - b.tier ||
        (KIND_PRIORITY[a.kind] ?? 6) - (KIND_PRIORITY[b.kind] ?? 6) ||
        a.idx - b.idx,
    );
  }
  const picked = cand.slice(0, MAX_ITEMS);
  const items = picked.map((p) => p.text);
  const kinds = picked.map((p) => p.kind);
  // M453：主行 `name(参数)`（只有方法带参数；无签名信息则不带括号）
  const sigs = picked.map((p) => (p.kind === "method" && p.signature !== undefined ? p.signature : undefined));
  // M396：带修饰符的再追加 " · 修饰符"，如 `(CharSequence text) · public` / `(int i) · private static`
  // M441：变量→声明类型；方法→返回类型；类→完整类名（查不到退回签名/修饰符）
  // M453：方法的参数已移到主行，说明行只留「修饰符 · 返回类型」
  const subs = picked.map((p) => subForItem(p, docSym, lex, offset));
  return { line: cursor.line, col, prefix, kind: kinds[0] ?? "plain", items, kinds, subs, sigs };
}
