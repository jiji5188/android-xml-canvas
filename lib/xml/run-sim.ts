// lib/xml/run-sim.ts — M18：运行调试的「可交互」模拟逻辑（纯函数，方便单测）
//
// 这一层只回答两个问题：
//   1. 这个标签在运行时该怎么表现？（可输入 / 可勾选 / 可拖 / 可下拉 / 列表行 / 只能点）
//   2. 没有真实数据时，列表和下拉该拿什么假数据演示？
// 真正的 DOM 操作留在 RunPreview.tsx 里，避免测试环境没有 DOM。

import { hapticNative } from "./native-save";

/** 运行时角色 */
export type RunRole =
  | "input"
  | "check"
  | "switch"
  | "radio"
  | "seek"
  | "spinner"
  | "list"
  | "grid"
  | "button"
  | "none";

const INPUT_TAGS = new Set([
  "EditText",
  "TextInputEditText",
  "AutoCompleteTextView",
  "MultiAutoCompleteTextView",
  "SearchView",
  "AppCompatEditText",
  "MaterialEditText",
  "PlainTextEditText",
]);

const BUTTON_TAGS = new Set([
  "Button",
  "ImageButton",
  "MaterialButton",
  "FloatingActionButton",
  "ExtendedFloatingActionButton",
  "AppCompatButton",
  "Chip",
  "ChipGroup",
  "ToggleButton",
  "ImageButtonCompat",
  "TextView",
  "CardView",
  "MaterialCardView",
]);

/** 短类名 */
export function shortName(tag: string): string {
  const t = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
  return t;
}

export function runRoleOf(tag: string): RunRole {
  const t = shortName(tag);
  if (INPUT_TAGS.has(t)) return "input";
  if (t === "CheckBox" || t === "AppCompatCheckBox" || t === "MaterialCheckBox" || t === "CheckedTextView") return "check";
  if (t === "Switch" || t === "SwitchCompat" || t === "SwitchMaterial" || t === "MaterialSwitch") return "switch";
  if (t === "RadioButton" || t === "AppCompatRadioButton" || t === "MaterialRadioButton") return "radio";
  if (t === "SeekBar" || t === "Slider" || t === "RangeSlider") return "seek";
  if (t === "Spinner" || t === "MaterialSpinner" || t === "AppCompatSpinner" || t === "AutoCompleteSpinner") return "spinner";
  if (t === "ListView" || t === "RecyclerView" || t === "ExpandableListView") return "list";
  if (t === "GridView") return "grid";
  if (BUTTON_TAGS.has(t)) return "button";
  return "none";
}

/** 这个角色在按下时该给涟漪反馈吗 */
export function wantsRipple(role: RunRole): boolean {
  return role === "button" || role === "list" || role === "grid" || role === "spinner" || role === "check" || role === "switch" || role === "radio";
}

/* ===================== 列表假数据 ===================== */

export interface SampleRow {
  title: string;
  sub?: string;
}

/** 列表默认演示行；给定 count 便于测试 */
export function sampleRows(count = 8): SampleRow[] {
  const titles = ["张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十"];
  const subs = ["今天 09:41 · 已读", "昨天 21:03 · 未读", "周三 14:20 · 已回复", "周一 08:15 · 已读"];
  const n = Math.max(1, Math.min(30, count));
  return Array.from({ length: n }, (_, i) => ({
    title: titles[i % titles.length] + (i >= titles.length ? ` (${i + 1})` : ""),
    sub: subs[i % subs.length],
  }));
}

/** 下拉候选：优先 android:entries="A,B,C"，否则给默认三项 */
export function spinnerOptions(entries: unknown): string[] {
  const raw = typeof entries === "string" ? entries.trim() : "";
  if (raw && !raw.startsWith("@")) {
    const list = raw
      .split(/[,，|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  if (raw.startsWith("@array/")) {
    // 资源数组没解析出来时给个提示性的默认值，别让下拉是空的
    return ["（未解析 @array）选项一", "选项二", "选项三"];
  }
  return ["选项一", "选项二", "选项三"];
}

/** 带资源表的版本：@array/xxx 能解析出来就当真数据，解析不出再落到提示词。
 *  返回 null 表示「没有任何可用候选」，调用方决定怎么展示。 */
export function resolveSpinner(
  entries: unknown,
  table?: { stringArrays?: Record<string, string[]> } | null,
): string[] | null {
  const raw = typeof entries === "string" ? entries.trim() : "";
  if (raw && !raw.startsWith("@")) {
    const list = raw
      .split(/[,，|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  if (raw.startsWith("@array/")) {
    const m = raw.match(/^@(?:\w+:)?array\/([\w.]+)$/);
    const name = m?.[1];
    if (name && table?.stringArrays?.[name]?.length) return table.stringArrays[name];
    return null; // 资源表里没有 → 让调用方提示
  }
  return null;
}

/* ===================== 数值类控件 ===================== */

/** 指针位置 → SeekBar 比例（0..1） */
export function seekRatio(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  const r = (clientX - left) / width;
  return Math.min(1, Math.max(0, Math.round(r * 1000) / 1000));
}

/** 比例 → 进度值（按 android:max 取整） */
export function seekValue(ratio: number, max = 100, min = 0): number {
  const hi = Number.isFinite(max) && max > min ? max : 100;
  const lo = Number.isFinite(min) ? min : 0;
  return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, ratio)));
}

/* ===================== 事件文案 ===================== */

export type RunEventKind = "click" | "long" | "input" | "focus" | "blur" | "check" | "select" | "seek" | "nav";

const KIND_LABEL: Record<RunEventKind, string> = {
  click: "点击",
  long: "长按",
  input: "输入",
  focus: "聚焦",
  blur: "失焦",
  check: "勾选",
  select: "选择",
  seek: "拖动",
  nav: "导航",
};

export function kindLabel(k: RunEventKind): string {
  return KIND_LABEL[k];
}

/** 统一的事件文案：`点击 Button#btn_login · onClick="login"` */
export function eventText(kind: RunEventKind, target: string, detail?: string): string {
  const head = `${KIND_LABEL[kind]} ${target}`;
  return detail ? `${head} · ${detail}` : head;
}

/** 控件在日志里的称呼：Button#btn_login / TextView（无 id 时只写类名） */
export function targetLabel(tag: string, id?: unknown): string {
  const t = shortName(tag);
  const raw = typeof id === "string" ? id.trim() : "";
  const clean = raw.replace(/^@\+?id\//, "");
  return clean ? `${t}#${clean}` : t;
}

/** 输入内容在日志里的展示（转义换行、超长截断） */
export function previewInput(value: string, limit = 40): string {
  const v = value.replace(/\r/g, "").replace(/\n+/g, "⏎");
  return v.length > limit ? v.slice(0, limit) + "…" : v;
}

/** 该角色在状态变化时该不该震、震多久（ms）。
 *  对齐 Android：按钮单击不震、长按一次 30ms；开关/勾选切换 15ms。
 *  没有震动硬件的浏览器里 vibrate 直接返回 false，调用方静默降级即可。 */
export function vibeMs(role: RunRole, kind: "press" | "toggle" | "long" | "select"): number {
  if (kind === "long") return 30;
  if (kind === "toggle") {
    if (role === "switch" || role === "check" || role === "radio") return 15;
    return 0;
  }
  if (kind === "select") return role === "list" || role === "grid" ? 15 : 0;
  return 0; // 普通按下/选择：安卓也不震
}

/** 安全震动：原生壳（Vibrator 精确时长）优先，桌面浏览器回退 navigator.vibrate */
export function vibrate(ms: number, type?: "long" | "toggle" | "none"): void {
  if (ms <= 0) return;
  try {
    if (type && hapticNative(type)) return; // 原生壳：精确时长
    navigator.vibrate?.(ms);
  } catch {
    /* Safari 等会直接抛，忽略 */
  }
}
