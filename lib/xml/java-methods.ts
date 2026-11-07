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
];

const KNOWN = new Set(KNOWN_METHODS);

/** 编辑距离（只算替换/插入/删除，带上限提前退出） */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
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
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** 找最接近的已知方法（距离 ≤ maxDist 才算） */
export function suggestMethod(name: string, maxDist = 2): string | null {
  if (KNOWN.has(name)) return null;
  let best: string | null = null;
  let bestD = maxDist + 1;
  for (const cand of KNOWN_METHODS) {
    const d = editDistance(name, cand, maxDist);
    if (d < bestD) {
      bestD = d;
      best = cand;
      if (d === 1) break;
    }
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
  const check = (name: string, lineNo: number) => {
    if (KNOWN.has(name) || declared.has(name) || seen.has(name)) return;
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
    out.push({ line: lineNo, name, suggestion: sug });
  };
  // 无接收者的调用（findviewbyid(...)）只在这几个动词开头时才查，否则跟局部函数/关键字打架
  const BARE_VERB = /^(?:get|set|find|make|start|finish|show|add|remove|notify|post|run|is|has|on)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(/\.\s*([a-z_][A-Za-z0-9_]*)\s*\(/g)) check(m[1], i + 1);
    for (const m of line.matchAll(/(?:^|[^.\w$])([a-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (!BARE_VERB.test(m[1])) continue;
      check(m[1], i + 1);
    }
  }
  return out;
}
