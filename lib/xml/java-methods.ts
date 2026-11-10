// lib/xml/java-methods.ts — M178：常见控件方法名拼错（setTxt / setVisiblity / findviewbyid …）
//
// 不做完整类型推导，只做「已知方法表 + 编辑距离」：调用名不在表里、但跟表里某个方法只差 1~2 个字符，
// 就提示「是不是想写 xxx」。误报率很低（真实方法都在表里，差两个字符的同名方法几乎不存在）。

/** 高频方法白名单（View / TextView / EditText / AdapterView / Activity 常见调用） */
export const KNOWN_METHODS: string[] = [
  // View
  "setVisibility", "getVisibility", "setBackground", "setBackgroundColor", "setBackgroundResource",
  "setLayoutParams", "getLayoutParams", "setPadding", "setId", "getId", "setTag", "getTag",
  "setEnabled", "isEnabled", "setAlpha", "setRotation", "setTranslationX", "setTranslationY",
  "setScaleX", "setScaleY", "requestLayout", "invalidate", "post", "postDelayed", "removeCallbacks",
  "setOnClickListener", "setOnLongClickListener", "performClick", "callOnClick",
  "setFocusable", "setFocusableInTouchMode", "requestFocus", "clearFocus", "setSelected", "isSelected",
  // TextView / EditText
  "setText", "getText", "setTextColor", "setTextSize", "setGravity", "setHint", "setHintTextColor",
  "setSingleLine", "setMaxLines", "setLines", "setTypeface", "append", "setEllipsize",
  "setOnEditorActionListener", "setTextWatcher", "addTextChangedListener", "getEditableText",
  // ImageView
  "setImageResource", "setImageDrawable", "setImageBitmap", "setImageURI", "setScaleType",
  "setColorFilter", "setAdjustViewBounds",
  // CompoundButton / SeekBar / ProgressBar
  "setChecked", "isChecked", "setOnCheckedChangeListener", "setProgress", "getProgress",
  "setMax", "getMax", "setOnSeekBarChangeListener", "setIndeterminate",
  // AdapterView / RecyclerView
  "setAdapter", "getAdapter", "setOnItemClickListener", "setOnItemLongClickListener",
  "setSelection", "getSelectedItem", "getSelectedItemPosition", "setLayoutManager", "setHasFixedSize",
  "setItemAnimator", "notifyDataSetChanged", "notifyItemChanged", "notifyItemInserted",
  "notifyItemRemoved", "notifyItemRangeChanged",
  // Activity / Fragment
  "setContentView", "findViewById", "getString", "startActivity", "startActivityForResult",
  "setResult", "finish", "onBackPressed", "getIntent", "setTitle", "getSupportFragmentManager",
  "getFragmentManager", "beginTransaction", "addToBackStack", "replace", "commit", "commitAllowingStateLoss",
  "runOnUiThread", "getApplicationContext", "getSharedPreferences", "getResources", "setRequestedOrientation",
  // Toast / Dialog / Menu / Toolbar
  "makeText", "show", "dismiss", "setMessage", "setTitle", "setPositiveButton", "setNegativeButton",
  "setNeutralButton", "create", "setSupportActionBar", "setDisplayHomeAsUpEnabled", "setNavigationOnClickListener",
  "getMenuInflater", "inflate", "onCreateOptionsMenu", "onOptionsItemSelected", "setMenu",
  // Log / 通用
  "println", "isFinishing", "isDestroyed", "getWindow", "setSoftInputMode", "addFlags", "putExtra",
  "getStringExtra", "getIntExtra", "getBooleanExtra", "putString", "getString", "apply", "edit",
  // M185b：数据库/游标（ContentValues / Cursor / SQLiteDatabase）
  // 这些是官方真实方法，缺了会大量误报（实测 put→post、getInt→getId）
  "put", "putNull", "getAsString", "getAsInteger", "getAsLong", "getAsBoolean", "getAsDouble",
  "getAsFloat", "getAsByteArray", "containsKey", "keySet", "size", "clear", "remove",
  "moveToFirst", "moveToNext", "moveToPrevious", "moveToPosition", "moveToLast", "isFirst", "isLast",
  "isBeforeFirst", "isAfterLast", "getCount", "getPosition", "getColumnCount",
  "getColumnIndex", "getColumnIndexOrThrow", "getColumnName", "getColumnNames", "close",
  "getInt", "getLong", "getShort", "getFloat", "getDouble", "getBlob", "isNull", "requery",
  "insert", "insertOrThrow", "update", "delete", "query", "rawQuery", "execSQL",
  "beginTransaction", "setTransactionSuccessful", "endTransaction", "getWritableDatabase", "getReadableDatabase",
  // SharedPreferences 全家族（M205b：之前漏 putInt/putLong 等，报「没有 putInt() 这个方法」误报）
  "putInt", "putLong", "putBoolean", "putString", "putFloat", "putStringSet",
  "getBoolean", "getFloat", "getString", "getStringSet", "getAll", "contains", "edit", "apply", "commit",
  "remove", "clear", "getDefaultSharedPreferences", "getSharedPreferences", "registerOnSharedPreferenceChangeListener",
  "unregisterOnSharedPreferenceChangeListener", "onSharedPreferenceChanged", "get",
  // M205c：org.json JSONObject / JSONArray 全家族（之前缺 optLong → 被当成 getLong 的拼写错）
  "optString", "optInt", "optLong", "optDouble", "optBoolean", "optJSONObject", "optJSONArray",
  "optStringSet", "optJSONArrayOrNull", "getJSONObject", "getJSONArray", "getJSONObjectOrNull",
  "has", "keys", "names", "length", "toMap", "accumulate", "write", "toString",
  "toJSONObject", "toJSONArray", "join", "quote",
  // M205c：其它高频但之前漏的（真实 api，缺了就会误报成拼写错）
  "parseLong", "parseInt", "parseBoolean", "parseDouble", "valueOf", "format", "intern",
  "substring", "trim", "isEmpty", "matches", "replaceAll", "replaceFirst", "concat",
  "charAt", "indexOf", "lastIndexOf", "startsWith", "endsWith", "equalsIgnoreCase",
  "split", "toUpperCase", "toLowerCase", "hashCode", "getClass", "wait", "notify",
  "sleep", "currentTimeMillis", "nanoTime", "exitTime", "getInstance", "newInstance",
  // M205d：Java 标准库高频方法（之前缺 hash/Objects.hash 等，被当拼写错建议 has）
  "hash", "equals", "clone", "compare", "compareTo", "toString", "values",
  "entrySet", "keySet", "containsKey", "containsValue", "size", "addAll", "putAll",
  "putIfAbsent", "computeIfAbsent", "getOrDefault", "forEach", "iterator", "of", "asList",
  "copyOf", "requireNonNull", "isNull", "nonNull", "deepEquals", "equalsIgnoreCase",
  "notifyAll", "interrupt", "join", "setName", "getName", "run", "call", "apply",
  "accept", "test", "andThen", "compose",
  // M208：Throwable 家族 + 常用标准库（以前全缺，把 getMessage 当拼错报 setMessage）
  "getMessage", "getLocalizedMessage", "getCause", "getStackTrace", "printStackTrace",
  "addSuppressed", "getSuppressed", "initCause", "fillInStackTrace", "toString", "hashCode", "equals",
  "isEmpty", "isBlank", "strip", "trim", "length", "charAt", "substring", "toLowerCase", "toUpperCase",
  "split", "replace", "replaceAll", "replaceFirst", "matches", "contains", "startsWith", "endsWith",
  "indexOf", "lastIndexOf", "compareTo", "concat", "format", "valueOf", "isDigit", "isLetter",
  "isEmpty", "nonEmpty",
  // M214：Intent 全家族（此前缺 getFlags，被建议成 getClass —— 编辑距离 2 配对的典型误报）
  "getFlags", "setFlags", "addFlags", "clearFlags", "removeFlags",
  "getAction", "setAction", "getData", "setData", "setDataAndType", "getDataString",
  "getType", "setType", "getCategories", "addCategory", "removeCategory", "hasCategory",
  "getExtras", "putExtras", "replaceExtras", "removeExtra",
  "putCharExtra", "putLongExtra", "putDoubleExtra", "putFloatExtra", "putShortExtra",
  "putByteArrayExtra", "putCharSequenceExtra", "putStringArrayListExtra", "putIntegerArrayListExtra",
  "getLongExtra", "getShortExtra", "getDoubleExtra", "getFloatExtra", "getCharExtra", "getByteExtra",
  "getSerializableExtra", "getParcelableExtra", "getParcelableArrayListExtra",
  "getStringArrayListExtra", "getIntegerArrayListExtra", "getCharSequenceArrayListExtra",
  "getBundleExtra", "getComponent", "setComponent", "setClassName", "setClass", "getSelector",
  "setSelector", "cloneFilter", "getIdentifier", "toUri", "parseUri", "normalizeMimeType",
  "createChooser", "makeMainActivity", "setActivityAction", "getDataUri", "hasFileDescriptorExtra",
  // M214：Bundle 全家族（extras 载体，之前大量缺失）
  "getBundle", "putBundle", "getParcelable", "putParcelable", "getSerializable", "putSerializable",
  "getCharSequence", "putCharSequence", "getStringArray", "putStringArray", "getIntArray",
  "putIntArray", "getLongArray", "putLongArray", "getDoubleArray", "putDoubleArray",
  "getFloatArray", "putFloatArray", "getBooleanArray", "putBooleanArray", "getShortArray",
  "putShortArray", "getIntegerArrayList", "getStringArrayList", "getCharSequenceArrayList",
  "getParcelableArrayList", "isEmpty", "putAll", "keySet", "size", "containsKey", "remove", "clear",
  // M214：Uri / Intent.Builder 家族
  "fromFile", "withAppendedPath", "withAuthority", "withScheme", "withPath", "withFragment",
  "withQuery", "getLastPathSegment", "getPathSegments", "getQueryParameter", "getQueryParameters",
  "buildUpon", "build", "encode", "decode", "getScheme", "getHost", "getPort", "getPath",
  "getFragment", "getEncodedPath", "getAuthority", "getEncodedAuthority", "getRawPath",
  "getEncodedSchemeSpecificPart", "getSchemeSpecificPart", "getRawQuery", "getRawFragment",
  "getQuery", "getCategories", "getUri", "normalizeUri",
  // M214：Activity / Context 常见调用（getSystemService / 文件 / 服务 / 广播）
  "getCallingActivity", "setIntent", "getLocalClassName", "getPackageManager", "getSystemService",
  "getAssets", "getFilesDir", "getCacheDir", "getExternalFilesDir", "getExternalCacheDir",
  "openFileOutput", "openFileInput", "deleteFile", "fileList", "getDir", "getMainLooper",
  "getApplication", "isTaskRoot", "moveTaskToBack", "recreate", "setTheme", "getTheme",
  "requestPermissions", "checkSelfPermission", "shouldShowRequestPermissionRationale",
  "openOptionsMenu", "closeOptionsMenu", "invalidateOptionsMenu", "getWindow",
  "requestWindowFeature", "setVolumeControlStream", "getPackageInfo", "getInstalledPackages",
  "getInstalledApplications", "bindService", "unbindService", "startService", "stopService",
  "startForegroundService", "getContentResolver", "openInputStream", "openOutputStream",
  "queryIntentActivities", "resolveActivity", "registerReceiver", "unregisterReceiver",
  "sendBroadcast", "sendOrderedBroadcast", "getApplicationInfo", "getInstalledServices",
  "getRunningServices", "isIgnoringBatteryOptimizations", "requestIgnoreBatteryOptimizations",
  "isDeviceIdleMode", "isPowerSaveMode", "registerComponentListener",
  "unregisterComponentListener", "getServicesForComponent", "startInstrumentation",
];

const KNOWN = new Set(KNOWN_METHODS);

/** M208：开头字母是常见动词首字母时，d==1 但动词不同的不能当拼写错 */
const VERB_INITIALS = new Set(["g", "s", "i", "h", "p", "c", "t"]);

// M179：editDistance 挪到 nearest-name.ts 共用；这里 re-export 保持既有 import 路径可用
import { editDistance } from "./nearest-name";

export { editDistance };

/** 找最接近的已知方法（距离 ≤ maxDist 才算） */
export function suggestMethod(name: string, maxDist = 2): string | null {
  if (KNOWN.has(name)) return null;
  const low = name.toLowerCase();
  let best: string | null = null;
  let bestD = maxDist + 1;
  for (const cand of KNOWN_METHODS) {
    const d = editDistance(name, cand, maxDist);
    if (d >= bestD) continue;
    // M205c 防误报：动词不同的不算拼写错（optLong → getLong 这种，编辑距离 2 但语义完全不同）
    // 要求：与原名前 2 个字符相同（忽略大小写），或只差 1 个字符
    const cl = cand.toLowerCase();
    const sharedPrefix = cl.length >= 2 && low.length >= 2 && cl.slice(0, 2) === low.slice(0, 2);
    if (d > 1 && !sharedPrefix) continue;
    // M214：d==2 时再加一道门槛——前 4 个字符（忽略大小写）要一致，否则两个毫不
    // 相关的 API 会被配成"拼写错"（getFlags → getClass 就是这么误报的；前 4 字符
    // "getf" vs "getc" 不同）。重复字符类真拼错（setTexttt → setText）前 4 字符相同，不受影响；
    // 单字符错 d==1 也不受影响，大小写型 findviewbyid 走下面的 lowerHint 通道
    if (d === 2 && cl.slice(0, 4) !== low.slice(0, 4)) continue;
    // M208：d==1 但只差在开头动词（get↔set / is↔has ...）→ 不是拼错，是两个不同方法
    //       真实误报：getMessage() 被建议成 setMessage()
    if (d === 1 && !sharedPrefix && VERB_INITIALS.has(low[0]) && VERB_INITIALS.has(cl[0]) && low[0] !== cl[0]) {
      continue;
    }
    bestD = d;
    best = cand;
    if (d === 1) break;
  }
  return bestD <= maxDist ? best : null;
}

/** 首字母小写的方法名相似度（findviewbyid → findViewById 距离 2，但大小写差 3 处，先归一化再比） */
function lowerHint(name: string, cand: string): number {
  // 去掉大小写差异后按「连续大写段」比较：findviewbyid vs findViewById → 归一化后相等
  return editDistance(name.toLowerCase(), cand.toLowerCase(), 2);
}

export interface MethodTypo {
  /** 行号（1 基） */
  line: number;
  /** M202：行内列号（1 基），编辑器精确下划线用 */
  col: number;
  name: string;
  suggestion: string;
}

export interface FindMethodTyposOpts {
  /** 跳过这些名字（本文件自己定义的方法） */
  declared?: Iterable<string>;
}

/** 在代码里找「调用名拼错」的地方 */
export function findMethodTypos(code: string, opts: FindMethodTyposOpts = {}): MethodTypo[] {
  const declared = new Set<string>([...opts.declared ?? []]);
  // 本文件声明的方法（`void foo(` / `public String bar(`）不算拼错
  for (const m of code.matchAll(/\b[A-Za-z_][\w<>[\]]*\s+([a-z_]\w*)\s*\(/g)) declared.add(m[1]);

  const out: MethodTypo[] = [];
  const seen = new Set<string>();
  const lines = code.split("\n");
  const check = (name: string, lineNo: number, colNo: number) => {
    if (KNOWN.has(name) || declared.has(name) || seen.has(name)) return;
    // M185b：短名（≤ 3 字符，如 put / get / add / run）不查 ——
    // 编辑距离只有 2 时几乎必误报（put→post），而这些短方法名本来就不是拼写坑
    if (name.length <= 3) return;
    // 大小写归一化后再找（findviewbyid 这类）
    let sug = suggestMethod(name, 2);
    if (!sug) {
      for (const cand of KNOWN_METHODS) {
        if (lowerHint(name, cand) <= 1) {
          sug = cand;
          break;
        }
      }
    }
    if (!sug) return;
    seen.add(name);
    out.push({ line: lineNo, col: colNo, name, suggestion: sug });
  };
  // 无接收者的调用（findviewbyid(...)）只在这几个动词开头时才查，否则跟局部函数/关键字打架
  const BARE_VERB = /^(?:get|set|find|make|start|finish|show|add|remove|notify|post|run|is|has|on)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(/\.\s*([a-z_][A-Za-z0-9_]*)\s*\(/g)) {
      // m[1] 是方法名：整段匹配以 `.`（或 `.`+空格）开头，名字起点 = m.index + 前缀长度
      const prefix = m[0].slice(0, m[0].indexOf(m[1]));
      check(m[1], i + 1, m.index + prefix.length + 1);
    }
    for (const m of line.matchAll(/(?:^|[^.\w$])([a-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (!BARE_VERB.test(m[1])) continue;
      // m.index===0 时名字就是行首；否则前面吃掉了 1 个字符
      const nameAt = m.index === 0 ? m.index : m.index + 1;
      check(m[1], i + 1, nameAt + 1);
    }
  }
  return out;
}
