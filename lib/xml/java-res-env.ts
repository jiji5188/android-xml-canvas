// lib/xml/java-res-env.ts — M177：给 Java 代码检查收集「项目里真实存在的资源」
//
// 之前 lintJava 支持 opts.ids，但 XmlEditor 从来没传过 → R.id.xxx 检查形同虚设。
// 这里把工程里的布局/values 汇总成一份资源清单，喂给代码检查：
//   ids      所有 @+id/xxx（附带出自哪个控件标签，用于 findViewById 类型校验）
//   layout / string / drawable / color / dimen / mipmap / style   各自的名字
//
// 纯函数，Node 环境可单测。

import { parseLayoutXml } from "./parser";
import type { XmlNode } from "./types";

export interface JavaResEnv {
  ids: string[];
  /** id → 控件标签（TextView / Button…）；同一 id 多处声明时取第一个 */
  idTag: Record<string, string>;
  layout: string[];
  string: string[];
  drawable: string[];
  color: string[];
  dimen: string[];
  mipmap: string[];
  style: string[];
}

export const EMPTY_RES_ENV: JavaResEnv = {
  ids: [],
  idTag: {},
  layout: [],
  string: [],
  drawable: [],
  color: [],
  dimen: [],
  mipmap: [],
  style: [],
};

function walk(node: XmlNode, fn: (n: XmlNode) => void): void {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

/** 从一份布局 xml 里抽 @+id/xxx 与其标签 */
export function collectIdsFromLayout(xml: string): { ids: string[]; idTag: Record<string, string> } {
  const ids: string[] = [];
  const idTag: Record<string, string> = {};
  let root: XmlNode | null = null;
  try {
    root = parseLayoutXml(xml).root;
  } catch {
    root = null;
  }
  if (!root) {
    // 解析失败（XML 还没写完）：退化成正则扫，宁可少报也不要漏
    for (const m of xml.matchAll(/<([A-Za-z][\w.]*)\b[^>]*?android:id\s*=\s*"@\+?id\/([A-Za-z_]\w*)"/g)) {
      const tag = m[1].includes(".") ? m[1].slice(m[1].lastIndexOf(".") + 1) : m[1];
      if (!idTag[m[2]]) idTag[m[2]] = tag;
      ids.push(m[2]);
    }
    return { ids, idTag };
  }
  walk(root, (n) => {
    const raw = n.attrs["android:id"] || n.attrs["id"] || "";
    const m = /^@\+?id\/([A-Za-z_]\w*)$/.exec(raw.trim());
    if (!m) return;
    const name = m[1];
    ids.push(name);
    const short = n.tag.includes(".") ? n.tag.slice(n.tag.lastIndexOf(".") + 1) : n.tag;
    if (!idTag[name]) idTag[name] = short;
  });
  return { ids, idTag };
}

/** 从 values/*.xml 抽各类资源名（不解析完整 XML，逐条匹配足够） */
export function collectValuesNames(xml: string, into: Partial<Record<"string" | "color" | "dimen" | "style", Set<string>>>, fileKind?: "strings" | "colors" | "dimens" | "styles" | "themes" | "attrs"): void {
  const want = (kind: "string" | "color" | "dimen" | "style") => {
    // 已知文件名时只认该类型，避免 <item name> 混进 style
    if (!fileKind) return true;
    if (fileKind === "strings") return kind === "string";
    if (fileKind === "colors") return kind === "color";
    if (fileKind === "dimens") return kind === "dimen";
    if (fileKind === "styles" || fileKind === "themes") return kind === "style";
    return false;
  };
  if (want("string")) {
    for (const m of xml.matchAll(/<string\s+name="([^"]+)"/g)) (into.string ??= new Set()).add(m[1]);
  }
  if (want("color")) {
    for (const m of xml.matchAll(/<color\s+name="([^"]+)"/g)) (into.color ??= new Set()).add(m[1]);
  }
  if (want("dimen")) {
    for (const m of xml.matchAll(/<dimen\s+name="([^"]+)"/g)) (into.dimen ??= new Set()).add(m[1]);
  }
  if (want("style")) {
    for (const m of xml.matchAll(/<style\s+name="([^"]+)"/g)) (into.style ??= new Set()).add(m[1]);
  }
}

export interface CollectEnvInput {
  /** res/layout 下的布局（名 → xml 全文），用于挖 @+id */
  layouts?: Record<string, string>;
  /** 当前编辑器里的布局 xml（可能还没保存，优先算进去） */
  currentLayoutXml?: string | null;
  /** values/*.xml 全文（键是文件名，如 strings.xml / colors.xml） */
  valuesFiles?: Record<string, string>;
  /** 项目里的 drawable 名（无扩展名） */
  drawables?: Iterable<string>;
  /** 项目里的 mipmap 名（无扩展名） */
  mipmaps?: Iterable<string>;
  /** 布局文件名（无扩展名），不给就从 layouts 的键推 */
  layoutNames?: Iterable<string>;
}

/** 汇总成一份资源清单 */
export function collectResEnv(input: CollectEnvInput): JavaResEnv {
  const ids = new Set<string>();
  const idTag: Record<string, string> = {};

  const mergeLayout = (xml: string) => {
    const got = collectIdsFromLayout(xml);
    for (const id of got.ids) ids.add(id);
    for (const [id, tag] of Object.entries(got.idTag)) if (!idTag[id]) idTag[id] = tag;
  };

  for (const xml of Object.values(input.layouts ?? {})) mergeLayout(xml);
  if (input.currentLayoutXml) mergeLayout(input.currentLayoutXml);

  const layoutNames = new Set<string>();
  if (input.layoutNames) for (const n of input.layoutNames) layoutNames.add(stripExt(n));
  for (const key of Object.keys(input.layouts ?? {})) layoutNames.add(stripExt(key));

  const vals = {
    string: new Set<string>(),
    color: new Set<string>(),
    dimen: new Set<string>(),
    style: new Set<string>(),
  };
  for (const [file, xml] of Object.entries(input.valuesFiles ?? {})) {
    const kind = /^(strings|colors|dimens|styles|themes|attrs)\.xml$/i.exec(file)?.[1]?.toLowerCase() as
      | "strings"
      | "colors"
      | "dimens"
      | "styles"
      | "themes"
      | "attrs"
      | undefined;
    collectValuesNames(xml, vals, kind);
  }

  return {
    ids: [...ids].sort(),
    idTag,
    layout: [...layoutNames].sort(),
    string: [...vals.string].sort(),
    drawable: [...new Set([...input.drawables ?? []].map(stripExt))].sort(),
    color: [...vals.color].sort(),
    dimen: [...vals.dimen].sort(),
    mipmap: [...new Set([...input.mipmaps ?? []].map(stripExt))].sort(),
    style: [...vals.style].sort(),
  };
}

function stripExt(n: string): string {
  const base = n.includes("/") ? n.slice(n.lastIndexOf("/") + 1) : n;
  return base.replace(/\.[^.]+$/, "");
}

/** 控件标签 → 期望的 Java 类型（findViewById 赋值类型校验用；只登记常见的） */
export const TAG_TO_CLASS: Record<string, string> = {
  TextView: "TextView",
  Button: "Button",
  EditText: "EditText",
  ImageView: "ImageView",
  ImageButton: "ImageButton",
  CheckBox: "CheckBox",
  RadioButton: "RadioButton",
  Switch: "Switch",
  SwitchCompat: "SwitchCompat",
  SeekBar: "SeekBar",
  ProgressBar: "ProgressBar",
  Spinner: "Spinner",
  ListView: "ListView",
  RecyclerView: "RecyclerView",
  GridView: "GridView",
  ScrollView: "ScrollView",
  HorizontalScrollView: "HorizontalScrollView",
  NestedScrollView: "NestedScrollView",
  LinearLayout: "LinearLayout",
  FrameLayout: "FrameLayout",
  RelativeLayout: "RelativeLayout",
  ConstraintLayout: "ConstraintLayout",
  TableLayout: "TableLayout",
  TableRow: "TableRow",
  Toolbar: "Toolbar",
  View: "View",
  ViewGroup: "ViewGroup",
  WebView: "WebView",
  VideoView: "VideoView",
  SurfaceView: "SurfaceView",
  CardView: "CardView",
  FloatingActionButton: "FloatingActionButton",
  TabLayout: "TabLayout",
  ViewPager: "ViewPager",
  ViewPager2: "ViewPager2",
  Chip: "Chip",
  ChipGroup: "ChipGroup",
  TextInputLayout: "TextInputLayout",
  TextInputEditText: "TextInputEditText",
  MaterialButton: "MaterialButton",
};

/** 类型兼容表：父类可以接收子类（只登记本工具会生成的层次） */
const SUPERS: Record<string, string[]> = {
  Button: ["TextView", "View"],
  EditText: ["TextView", "View"],
  CheckBox: ["CompoundButton", "Button", "TextView", "View"],
  RadioButton: ["CompoundButton", "Button", "TextView", "View"],
  Switch: ["CompoundButton", "Button", "TextView", "View"],
  SwitchCompat: ["CompoundButton", "Button", "TextView", "View"],
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
  View: [],
  ViewGroup: ["View"],
  WebView: ["View"],
  VideoView: ["View"],
  SurfaceView: ["View"],
  Chip: ["View"],
};

/** child 能否赋给 parent 类型（含完全相等） */
export function isAssignableTo(child: string, parent: string): boolean {
  if (child === parent) return true;
  const seen = new Set<string>([child]);
  let cur = child;
  for (;;) {
    const sups = SUPERS[cur] ?? null;
    if (!sups) break;
    for (const s of sups) {
      if (s === parent) return true;
      if (!seen.has(s)) seen.add(s);
    }
    const next = sups.find((s) => SUPERS[s]);
    if (!next || seen.has(next)) break;
    cur = next;
  }
  return false;
}
