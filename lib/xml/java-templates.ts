// lib/xml/java-templates.ts — M397：接受候选时自动补代码块
//
// 用户需求（2026-11-19）：为了便捷输入，事件类方法（onClick/onCreate…）自动带出整个方法体；
// if / for / switch / while / try 这些语句块自动补 (){} 结构并把光标放到该填的位置。
//
// 设计：
//  - 只对「非 receiver 上下文」（前面不是点号）生效——`obj.if` 这种不可能，但 `x.onClick()` 调用不该展开方法体
//  - 第一行不重复缩进（替换起点在行首缩进之后），后续行用 %base% 前缀
//  - `|` 标记光标落点，插入后去掉
//  - 缩进单位跟随当前行：用 tab 的行就给 tab，否则 4 空格

import type { SuggestKind } from "./suggest-kind";

const SPACES = "    ";

/** 语句块模板（`|` = 光标落点，%base% = 当前行缩进，%in% = 缩进+一级） */
export const JAVA_BLOCK_TEMPLATES: Record<string, string> = {
  if: "if (|) {\n%in%\n%base%}",
  for: "for (int i = 0; i < |; i++) {\n%in%\n%base%}",
  while: "while (|) {\n%in%\n%base%}",
  do: "do {\n%in%|\n%base%} while ();",
  switch:
    "switch (|) {\n%in%case :\n%in%    break;\n%in%default:\n%in%    break;\n%base%}",
  try: "try {\n%in%|\n%base%} catch (Exception e) {\n%in%\n%base%}",
};

/** 常见事件/生命周期回调：方法名 → 参数表 + 返回类型（缺省 void） */
export const EVENT_OVERRIDES: Record<string, { params: string; ret?: string }> = {
  // Activity / Fragment 生命周期
  onCreate: { params: "Bundle savedInstanceState" },
  onStart: { params: "" },
  onResume: { params: "" },
  onPause: { params: "" },
  onStop: { params: "" },
  onDestroy: { params: "" },
  onRestart: { params: "" },
  onBackPressed: { params: "" },
  onSaveInstanceState: { params: "Bundle outState" },
  onActivityResult: { params: "int requestCode, int resultCode, Intent data" },
  onRequestPermissionsResult: { params: "int requestCode, String[] permissions, int[] grantResults" },
  onCreateOptionsMenu: { params: "Menu menu", ret: "boolean" },
  onOptionsItemSelected: { params: "MenuItem item", ret: "boolean" },
  // 点击 / 触摸
  onClick: { params: "View v" },
  onLongClick: { params: "View v", ret: "boolean" },
  onTouch: { params: "View v, MotionEvent event", ret: "boolean" },
  // 列表
  onItemClick: { params: "AdapterView<?> parent, View view, int position, long id" },
  onItemLongClick: { params: "AdapterView<?> parent, View view, int position, long id", ret: "boolean" },
  onItemSelected: { params: "AdapterView<?> parent, View view, int position, long id" },
  onNothingSelected: { params: "AdapterView<?> parent" },
  // 文本变化
  onTextChanged: { params: "CharSequence s, int start, int before, int count" },
  beforeTextChanged: { params: "CharSequence s, int start, int count, int after" },
  afterTextChanged: { params: "Editable s" },
  // 勾选 / 拖动
  onCheckedChanged: { params: "CompoundButton buttonView, boolean isChecked" },
  onProgressChanged: { params: "SeekBar seekBar, int progress, boolean fromUser" },
  onStartTrackingTouch: { params: "SeekBar seekBar" },
  onStopTrackingTouch: { params: "SeekBar seekBar" },
  // 搜索 / 下拉刷新
  onQueryTextSubmit: { params: "String query", ret: "boolean" },
  onQueryTextChange: { params: "String newText", ret: "boolean" },
  onRefresh: { params: "" },
};

/** 插入文本 + 光标相对偏移（相对于替换起点） */
export interface AcceptTemplate {
  text: string;
  cursor: number;
  /** M455：模板自带调用括号 —— 用户已打了 "(" 就一起吃掉，避免 "((" 重复 */
  consumeTrailingParen?: boolean;
}

/** M455：监听器 setter → 整个匿名实现类（`btn.setOnClickListener` 接受候选后直接展开） */
export interface ListenerSpec {
  /** `new XXX()` 的接口名（带外部类前缀，如 View.OnClickListener） */
  iface: string;
  /** 接口必须实现的方法（多方法接口按顺序全部带出） */
  methods: { name: string; params: string; ret?: string }[];
}

export const LISTENER_SETTERS: Record<string, ListenerSpec> = {
  // View 家族
  setOnClickListener: { iface: "View.OnClickListener", methods: [{ name: "onClick", params: "View v" }] },
  setOnLongClickListener: { iface: "View.OnLongClickListener", methods: [{ name: "onLongClick", params: "View v", ret: "boolean" }] },
  setOnTouchListener: { iface: "View.OnTouchListener", methods: [{ name: "onTouch", params: "View v, MotionEvent event", ret: "boolean" }] },
  setOnFocusChangeListener: { iface: "View.OnFocusChangeListener", methods: [{ name: "onFocusChange", params: "View v, boolean hasFocus" }] },
  setOnKeyListener: { iface: "View.OnKeyListener", methods: [{ name: "onKey", params: "View v, int keyCode, KeyEvent event", ret: "boolean" }] },
  setOnHoverListener: { iface: "View.OnHoverListener", methods: [{ name: "onHover", params: "View v, MotionEvent event", ret: "boolean" }] },
  setOnDragListener: { iface: "View.OnDragListener", methods: [{ name: "onDrag", params: "View v, DragEvent event", ret: "boolean" }] },
  setOnScrollChangeListener: { iface: "View.OnScrollChangeListener", methods: [{ name: "onScrollChange", params: "View v, int scrollX, int scrollY, int oldScrollX, int oldScrollY" }] },
  setOnGenericMotionListener: { iface: "View.OnGenericMotionListener", methods: [{ name: "onGenericMotion", params: "View v, MotionEvent event", ret: "boolean" }] },
  // 列表 / 适配器
  setOnItemClickListener: { iface: "AdapterView.OnItemClickListener", methods: [{ name: "onItemClick", params: "AdapterView<?> parent, View view, int position, long id" }] },
  setOnItemLongClickListener: { iface: "AdapterView.OnItemLongClickListener", methods: [{ name: "onItemLongClick", params: "AdapterView<?> parent, View view, int position, long id", ret: "boolean" }] },
  setOnItemSelectedListener: {
    iface: "AdapterView.OnItemSelectedListener",
    methods: [
      { name: "onItemSelected", params: "AdapterView<?> parent, View view, int position, long id" },
      { name: "onNothingSelected", params: "AdapterView<?> parent" },
    ],
  },
  setOnScrollListener: {
    iface: "AbsListView.OnScrollListener",
    methods: [
      { name: "onScrollStateChanged", params: "AbsListView view, int scrollState" },
      { name: "onScroll", params: "AbsListView view, int firstVisibleItem, int visibleItemCount, int totalItemCount" },
    ],
  },
  // 控件专属
  setOnCheckedChangeListener: { iface: "CompoundButton.OnCheckedChangeListener", methods: [{ name: "onCheckedChanged", params: "CompoundButton buttonView, boolean isChecked" }] },
  setOnSeekBarChangeListener: {
    iface: "SeekBar.OnSeekBarChangeListener",
    methods: [
      { name: "onProgressChanged", params: "SeekBar seekBar, int progress, boolean fromUser" },
      { name: "onStartTrackingTouch", params: "SeekBar seekBar" },
      { name: "onStopTrackingTouch", params: "SeekBar seekBar" },
    ],
  },
  setOnRatingBarChangeListener: { iface: "RatingBar.OnRatingBarChangeListener", methods: [{ name: "onRatingChanged", params: "RatingBar ratingBar, float rating, boolean fromUser" }] },
  setOnEditorActionListener: { iface: "TextView.OnEditorActionListener", methods: [{ name: "onEditorAction", params: "TextView v, int actionId, KeyEvent event", ret: "boolean" }] },
  addTextChangedListener: {
    iface: "TextWatcher",
    methods: [
      { name: "beforeTextChanged", params: "CharSequence s, int start, int count, int after" },
      { name: "onTextChanged", params: "CharSequence s, int start, int before, int count" },
      { name: "afterTextChanged", params: "Editable s" },
    ],
  },
  // 菜单 / 搜索 / 多媒体
  setOnMenuItemClickListener: { iface: "MenuItem.OnMenuItemClickListener", methods: [{ name: "onMenuItemClick", params: "MenuItem item", ret: "boolean" }] },
  setOnQueryTextListener: {
    iface: "SearchView.OnQueryTextListener",
    methods: [
      { name: "onQueryTextSubmit", params: "String query", ret: "boolean" },
      { name: "onQueryTextChange", params: "String newText", ret: "boolean" },
    ],
  },
  setOnPreparedListener: { iface: "MediaPlayer.OnPreparedListener", methods: [{ name: "onPrepared", params: "MediaPlayer mp" }] },
  setOnCompletionListener: { iface: "MediaPlayer.OnCompletionListener", methods: [{ name: "onCompletion", params: "MediaPlayer mp" }] },
  setOnErrorListener: { iface: "MediaPlayer.OnErrorListener", methods: [{ name: "onError", params: "MediaPlayer mp, int what, int extra", ret: "boolean" }] },
};

/** 拼监听器匿名类模板：第一行不重复缩进（替换起点在行首缩进之后），%in%/%base%/| 语义同语句块 */
function buildListenerTemplate(name: string, spec: ListenerSpec): string {
  const lines: string[] = [`${name}(new ${spec.iface}() {`];
  spec.methods.forEach((m, i) => {
    if (i > 0) lines.push("");
    lines.push("%in%@Override");
    lines.push(`%in%public ${m.ret ?? "void"} ${m.name}(${m.params}) {`);
    lines.push(i === 0 ? "%in2%|" : "%in2%");
    lines.push("%in%}");
  });
  lines.push("%base%});");
  return lines.join("\n");
}

/**
 * 生成接受候选时要插入的文本。
 * @param item   候选词（方法名 / 关键字）
 * @param kind   候选类型
 * @param indent 当前行前导缩进（tab 或空格）
 * @returns null = 不需要模板，按普通词插入
 */
export function buildJavaAcceptTemplate(
  item: string,
  kind: SuggestKind,
  indent: string,
): AcceptTemplate | null {
  const unit = indent.includes("\t") ? "\t" : SPACES;
  const expand = (tmpl: string): AcceptTemplate => {
    // %in2% = 当前缩进 + 两级（监听器匿名类的 onClick 体）；先于 %in% 替换
    const body = tmpl
      .replace(/%in2%/g, indent + unit + unit)
      .replace(/%in%/g, indent + unit)
      .replace(/%base%/g, indent);
    const i = body.indexOf("|");
    return { text: body.replace("|", ""), cursor: i >= 0 ? i : body.length };
  };

  // 1) 语句块关键字
  if (kind === "decl" && JAVA_BLOCK_TEMPLATES[item]) {
    return expand(JAVA_BLOCK_TEMPLATES[item]);
  }
  // 2) 事件/回调方法 → 整个 @Override 方法体
  if (kind === "method" && EVENT_OVERRIDES[item]) {
    const o = EVENT_OVERRIDES[item];
    const ret = o.ret ?? "void";
    return expand(`@Override\n%base%public ${ret} ${item}(${o.params}) {\n%in%|\n%base%}`);
  }
  // 3) M455：监听器 setter → 整个匿名实现类（接受时吃掉已打的 "("，并自动补接口外部类 import）
  if (kind === "method" && LISTENER_SETTERS[item]) {
    const r = expand(buildListenerTemplate(item, LISTENER_SETTERS[item]));
    return { ...r, consumeTrailingParen: true };
  }
  return null;
}
