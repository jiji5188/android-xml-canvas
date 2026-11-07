// lib/xml/java-api-check.ts — M178：控件常见方法名拼错检查
//
// 场景：`TextView tv = ...; tv.setTxt("hi");` —— 编译器会报，但我们没有编译器，
// 所以用「已知变量类型 + 方法白名单 + 编辑距离」给一条温和的提醒（只在极近的拼写错误上触发）。
//
// 原则：宁可漏报，不可误报。触发要同时满足：
//   1. 接收者是我们认识的控件类型（局部变量声明或 findViewById 强转）
//   2. 方法名不在该类型（含 View 基类）的白名单里
//   3. 文件里没有自定义同名方法
//   4. 与某个白名单方法编辑距离 ≤ 1，且方法名长度 ≥ 5
//
// 纯函数，Node 可单测。

import { TAG_TO_CLASS } from "./java-res-env";

/** View 基类方法（所有控件都有） */
const VIEW_METHODS = [
  "setVisibility", "getVisibility", "setEnabled", "isEnabled", "setBackgroundColor", "setBackground",
  "setBackgroundResource", "setPadding", "setPaddingRelative", "setLayoutParams", "getLayoutParams",
  "setOnClickListener", "setOnLongClickListener", "setOnTouchListener", "setTag", "getTag",
  "findViewById", "getId", "setAlpha", "setTranslationX", "setTranslationY", "setScaleX", "setScaleY",
  "setRotation", "animate", "invalidate", "post", "postDelayed", "bringToFront", "setSelected",
  "setClickable", "setFocusable", "requestFocus", "performClick", "getWidth", "getHeight",
  "setMinimumWidth", "setMinimumHeight", "getContext", "getParent", "setContentDescription",
];

const WIDGET_METHODS: Record<string, string[]> = {
  TextView: [
    "setText", "getText", "setTextSize", "setTextColor", "setGravity", "setTypeface", "setHint",
    "append", "setSingleLine", "setMaxLines", "setEllipsize", "setTextAppearance", "setLineSpacing",
    "setLetterSpacing", "getLineCount", "setAllCaps", "setShadowLayer",
  ],
  Button: [],
  EditText: [
    "setHint", "getText", "setSelection", "getSelectionStart", "getSelectionEnd", "setError",
    "setInputType", "setImeOptions", "setText", "getEditableText", "setFilters", "setMaxLength",
    "addTextChangedListener", "setKeyListener",
  ],
  ImageView: [
    "setImageResource", "setImageDrawable", "setImageBitmap", "setImageURI", "setScaleType",
    "setColorFilter", "setAdjustViewBounds", "setMaxWidth", "setMaxHeight", "getDrawable",
  ],
  ImageButton: [],
  CheckBox: ["setChecked", "isChecked", "setOnCheckedChangeListener", "toggle"],
  RadioButton: ["setChecked", "isChecked", "toggle"],
  Switch: ["setChecked", "isChecked", "setOnCheckedChangeListener", "toggle"],
  SwitchCompat: ["setChecked", "isChecked", "setOnCheckedChangeListener", "toggle"],
  CompoundButton: ["setChecked", "isChecked", "setOnCheckedChangeListener", "toggle"],
  SeekBar: ["setProgress", "getProgress", "setMax", "getMax", "setOnSeekBarChangeListener", "setThumb", "setProgressDrawable"],
  ProgressBar: ["setProgress", "getProgress", "setMax", "getMax", "setIndeterminate", "setSecondaryProgress"],
  Spinner: ["setAdapter", "setSelection", "getSelectedItem", "getSelectedItemPosition", "setOnItemSelectedListener", "getSelectedView"],
  ListView: ["setAdapter", "setOnItemClickListener", "setOnItemLongClickListener", "setSelection", "getAdapter", "smoothScrollToPosition", "setEmptyView"],
  RecyclerView: ["setLayoutManager", "setAdapter", "getAdapter", "scrollToPosition", "smoothScrollToPosition", "setHasFixedSize", "addItemDecoration", "setItemAnimator"],
  GridView: ["setAdapter", "setNumColumns", "setOnItemClickListener", "getAdapter"],
  ScrollView: ["smoothScrollTo", "fullScroll", "scrollTo", "setFillViewport"],
  HorizontalScrollView: ["smoothScrollTo", "fullScroll", "scrollTo", "setFillViewport"],
  NestedScrollView: ["smoothScrollTo", "fullScroll", "scrollTo", "setFillViewport"],
  LinearLayout: ["setOrientation", "getOrientation", "setGravity", "setWeightSum", "addView", "removeView", "removeAllViews", "getChildCount", "getChildAt"],
  FrameLayout: ["addView", "removeView", "removeAllViews", "getChildCount", "getChildAt", "setForeground"],
  RelativeLayout: ["addView", "removeView", "removeAllViews", "getChildCount", "getChildAt"],
  ConstraintLayout: ["addView", "removeView", "removeAllViews", "getChildCount", "getChildAt"],
  TableLayout: ["addView", "setStretchAllColumns", "setShrinkAllColumns"],
  TableRow: ["addView", "getChildCount"],
  Toolbar: ["setTitle", "setSubtitle", "setNavigationOnClickListener", "setNavigationIcon", "inflateMenu", "setOnMenuItemClickListener", "getMenu"],
  CardView: ["setCardBackgroundColor", "setRadius", "setCardElevation", "setContentPadding", "setUseCompatPadding"],
  FloatingActionButton: ["setImageResource", "setOnClickListener", "show", "hide", "setCompatElevation"],
  TabLayout: ["addTab", "newTab", "setSelectedTabIndicatorColor", "setupWithViewPager", "addOnTabSelectedListener", "getTabCount"],
  ViewPager: ["setAdapter", "setCurrentItem", "getCurrentItem", "addOnPageChangeListener", "setOffscreenPageLimit"],
  ViewPager2: ["setAdapter", "setCurrentItem", "getCurrentItem", "registerOnPageChangeCallback", "setOrientation"],
  Chip: ["setText", "setChecked", "setChipIconResource", "setOnClickListener", "setCloseIcon"],
  ChipGroup: ["addView", "removeAllViews", "setSingleSelection", "setSelectionRequired", "getCheckedChipId"],
  TextInputLayout: ["setHint", "setError", "setErrorEnabled", "getEditText", "setCounterEnabled", "setHelperText"],
  TextInputEditText: [],
  WebView: ["loadUrl", "loadData", "loadDataWithBaseURL", "getSettings", "setWebViewClient", "setWebChromeClient", "reload", "goBack", "canGoBack", "evaluateJavascript"],
  VideoView: ["setVideoURI", "setVideoPath", "start", "pause", "stopPlayback", "seekTo", "getDuration", "isPlaying", "setMediaController"],
  SurfaceView: ["getHolder", "setZOrderOnTop"],
  View: [],
  ViewGroup: ["addView", "removeView", "removeAllViews", "getChildCount", "getChildAt", "removeViewAt", "indexOfChild"],
};

/** 类型可用的方法名集合（含继承链） */
const SUPERS_OF: Record<string, string[]> = {
  Button: ["TextView", "View"],
  EditText: ["TextView", "View"],
  CheckBox: ["CompoundButton", "Button", "TextView", "View"],
  RadioButton: ["CompoundButton", "Button", "TextView", "View"],
  Switch: ["CompoundButton", "Button", "TextView", "View"],
  SwitchCompat: ["CompoundButton", "Button", "TextView", "View"],
  CompoundButton: ["Button", "TextView", "View"],
  ImageButton: ["ImageView", "View"],
  SeekBar: ["ProgressBar", "View"],
  ProgressBar: ["View"],
  TextInputEditText: ["EditText", "TextView", "View"],
  MaterialButton: ["Button", "TextView", "View"],
  FloatingActionButton: ["ImageButton", "ImageView", "View"],
  LinearLayout: ["ViewGroup", "View"],
  FrameLayout: ["ViewGroup", "View"],
  RelativeLayout: ["ViewGroup", "View"],
  ConstraintLayout: ["ViewGroup", "View"],
  TableLayout: ["LinearLayout", "ViewGroup", "View"],
  TableRow: ["LinearLayout", "ViewGroup", "View"],
  ScrollView: ["FrameLayout", "ViewGroup", "View"],
  HorizontalScrollView: ["FrameLayout", "ViewGroup", "View"],
  NestedScrollView: ["FrameLayout", "ViewGroup", "View"],
  CardView: ["FrameLayout", "ViewGroup", "View"],
  TextInputLayout: ["LinearLayout", "ViewGroup", "View"],
  RecyclerView: ["ViewGroup", "View"],
  ListView: ["AbsListView", "ViewGroup", "View"],
  GridView: ["AbsListView", "ViewGroup", "View"],
  Spinner: ["AbsSpinner", "ViewGroup", "View"],
  ViewPager: ["ViewGroup", "View"],
  ViewPager2: ["ViewGroup", "View"],
  Toolbar: ["ViewGroup", "View"],
  ChipGroup: ["LinearLayout", "ViewGroup", "View"],
  ImageView: ["View"],
  TextView: ["View"],
  ViewGroup: ["View"],
  AbsListView: ["ViewGroup", "View"],
  AbsSpinner: ["ViewGroup", "View"],
  WebView: ["View"],
  VideoView: ["View"],
  SurfaceView: ["View"],
  Chip: ["View"],
};

function methodsOf(type: string): Set<string> {
  const out = new Set<string>(VIEW_METHODS);
  const seen = new Set<string>();
  let cur: string | undefined = type;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    for (const m of WIDGET_METHODS[cur] ?? []) out.add(m);
    cur = SUPERS_OF[cur]?.[0];
  }
  return out;
}

/** 编辑距离（只算 ≤2 就够，超出直接返回 3） */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 2) return 3;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] > 2 ? 3 : prev[b.length];
}

export interface ApiIssue {
  /** 1 起行号 */
  line: number;
  /** 调用处方法名 */
  method: string;
  /** 接收者变量名 */
  receiver: string;
  /** 接收者类型 */
  type: string;
  /** 猜测的正确方法名 */
  suggest: string;
}

/** 去掉注释和字符串（保留换行，行号不变） */
function maskCode(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let st: "code" | "line" | "block" | "str" | "char" = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (st === "code") {
      if (c === "/" && d === "/") { st = "line"; out.push(" ", " "); i += 2; continue; }
      if (c === "/" && d === "*") { st = "block"; out.push(" ", " "); i += 2; continue; }
      if (c === '"') { st = "str"; out.push(" "); i++; continue; }
      if (c === "'") { st = "char"; out.push(" "); i++; continue; }
      out.push(c); i++; continue;
    }
    if (st === "line") {
      if (c === "\n") { st = "code"; out.push("\n"); } else out.push(" ");
      i++; continue;
    }
    if (st === "block") {
      if (c === "*" && d === "/") { st = "code"; out.push(" ", " "); i += 2; continue; }
      out.push(c === "\n" ? "\n" : " "); i++; continue;
    }
    // str / char
    if (c === "\\") { out.push(" ", " "); i += 2; continue; }
    if ((st === "str" && c === '"') || (st === "char" && c === "'")) { st = "code"; out.push(" "); i++; continue; }
    out.push(c === "\n" ? "\n" : " "); i++; continue;
  }
  return out.join("");
}

function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], at: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * 检查「变量.方法名」里的方法名是否像控件 API 的拼写错误。
 * @param src Java/Kotlin 源码
 */
export function checkApiTypos(src: string): ApiIssue[] {
  if (!src) return [];
  const code = maskCode(src);
  const starts = lineStarts(src);
  const issues: ApiIssue[] = [];

  /** 文件里自定义的方法名 / 变量名，命中就不报 */
  const ownMethods = new Set<string>();
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{/g)) ownMethods.add(m[1]);

  /** 变量 → 类型（只认我们认识的控件类型） */
  const varType = new Map<string, string>();
  const KNOWN = new Set(Object.keys(TAG_TO_CLASS));
  const remember = (type: string, name: string) => {
    const simple = type.includes(".") ? type.slice(type.lastIndexOf(".") + 1) : type;
    if (KNOWN.has(simple) && name) varType.set(name, simple);
  };
  for (const m of code.matchAll(/\b([A-Z][\w.]*)\s+([a-z_]\w*)\s*=/g)) remember(m[1], m[2]);
  // findViewById 直接赋给已声明变量时也补一条（`tv = (TextView) findViewById(...)` 这种少，主要靠上面）

  for (const [name, type] of varType) {
    const allowed = methodsOf(type);
    const re = new RegExp(`\\b${name}\\s*\\.\\s*([a-z_]\\w*)\\s*\\(`, "g");
    for (const m of code.matchAll(re)) {
      const method = m[1];
      if (allowed.has(method)) continue;
      if (ownMethods.has(method)) continue;
      if (method.length < 5) continue;
      // 自定义/其他 SDK 的常见前缀，别瞎猜
      if (!/^(set|get|is|has|add|remove|clear|show|hide|load|append|toggle|scroll|smooth|perform|request|find|update|notify)/.test(method)) continue;
      let best = "";
      let bestD = 3;
      for (const cand of allowed) {
        const dist = editDistance(method, cand);
        if (dist < bestD) { bestD = dist; best = cand; }
        if (bestD === 1) break;
      }
      if (bestD !== 1) continue;
      issues.push({
        line: lineOf(starts, m.index || 0),
        method,
        receiver: name,
        type,
        suggest: best,
      });
    }
  }
  // 同一个 (行, 方法) 只留一条
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.line}:${i.method}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 给 UI 的提示文案 */
export function formatApiIssue(i: ApiIssue): string {
  return `${i.type} 没有 ${i.method}() 方法（${i.receiver} 是 ${i.type}），是不是想写 ${i.suggest}()？`;
}
