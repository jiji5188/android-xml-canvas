// lib/xml/compat.ts — M13 导出兼容模式（纯平台控件，AIDE / 老 aapt 直接可编译）
//
// 背景：本项目预览的是 androidx + Material 的现代写法，但很多老工具链（AIDE 内嵌的 aapt1）
// 既没有 androidx 依赖、也不认 res-auto 里的库属性，导出的布局在那边编译必报
// 「No resource identifier found for attribute 'layout_constraintStart_toStartOf' …」。
//
// 这里做的是「降级翻译」而不是「删东西」：
//   · ConstraintLayout → RelativeLayout，把约束关系翻成 layout_toEndOf / layout_below …
//   · Material / AndroidX 控件 → 平台同名控件（Button / TextView / FrameLayout …）
//   · 去掉所有 app: 属性（没有库就没有定义）、去掉 Guideline / Barrier 这类只存在于 CL 的角色
//   · layout_width/height="0dp" → match_parent 或 wrap_content
//
// 转换是有损的（没有链、没有百分比、没有 barrier），所以只作为「导出选项」提供，不替换默认行为。

import { parseLayoutXml, serialize } from "./parser";
import { attrPrefixFor } from "./attrs";
import type { XmlNode } from "./types";

/** 简单类名 → 平台控件（未列出的按「有子控件 → FrameLayout，无子控件 → TextView」兜底） */
const PLATFORM_TAG: Record<string, string> = {
  ConstraintLayout: "RelativeLayout",
  CoordinatorLayout: "FrameLayout",
  DrawerLayout: "FrameLayout",
  SwipeRefreshLayout: "FrameLayout",
  FragmentContainerView: "FrameLayout",
  ViewPager: "FrameLayout",
  ViewPager2: "FrameLayout",
  RecyclerView: "FrameLayout",
  NestedScrollView: "ScrollView",
  LinearLayoutCompat: "LinearLayout",
  CardView: "FrameLayout",
  MaterialCardView: "FrameLayout",
  AppBarLayout: "LinearLayout",
  CollapsingToolbarLayout: "LinearLayout",
  BottomAppBar: "LinearLayout",
  ChipGroup: "LinearLayout",
  BottomNavigationView: "LinearLayout",
  NavigationView: "LinearLayout",
  TextInputLayout: "LinearLayout",
  TabLayout: "HorizontalScrollView",
  Toolbar: "LinearLayout",
  MaterialToolbar: "LinearLayout",
  MaterialButton: "Button",
  AppCompatButton: "Button",
  MaterialButtonToggleGroup: "LinearLayout",
  MaterialTextView: "TextView",
  AppCompatTextView: "TextView",
  Chip: "TextView",
  TabItem: "TextView",
  MaterialAutoCompleteTextView: "AutoCompleteTextView",
  AppCompatEditText: "EditText",
  TextInputEditText: "EditText",
  FloatingActionButton: "ImageButton",
  ExtendedFloatingActionButton: "ImageButton",
  ShapeableImageView: "ImageView",
  MaterialShapeableImageView: "ImageView",
  LinearProgressIndicator: "ProgressBar",
  CircularProgressIndicator: "ProgressBar",
  Slider: "SeekBar",
  RangeSlider: "SeekBar",
  SwitchMaterial: "Switch",
  SwitchCompat: "Switch",
  MaterialCheckBox: "CheckBox",
  AppCompatCheckBox: "CheckBox",
  MaterialRadioButton: "RadioButton",
  AppCompatRadioButton: "RadioButton",
  MaterialDivider: "View",
};

/** ConstraintLayout 专属属性：RelativeLayout 上不存在，必须去掉 */
const CL_ATTR_RE =
  /^(layout_constraint|layout_guideline|layout_barrier|layout_wrapBehavior|layout_optimizationLevel|layout_behavior|layout_anchor|layout_keyline|layout_scrollFlags|layout_collapse|flow_|motion_|constraint_referenced|barrier|visibilityMode|layout_widthPercent|layout_heightPercent|layout_dimensionRatio|layout_aspectRatio|layout_editor_absolute)/;

/** 只存在于 CL 的定位角色（降级后整节点移除） */
const CL_ROLE_TAGS = new Set(["Guideline", "Barrier"]);

export interface CompatResult {
  /** 转换后的布局 XML（不含 XML 声明） */
  xml: string;
  /** 给人看的转换摘要 */
  notes: string[];
  /** 统计，测试用 */
  stats: { tags: number; rules: number; dropped: number; removed: number };
}

const shortName = (tag: string): string =>
  tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;

const isZero = (v: string | undefined): boolean => (v ?? "").trim() === "0dp";

export function toCompatXml(src: string): CompatResult {
  const { root } = parseLayoutXml(src);
  if (!root) return { xml: src, notes: ["解析失败，未做兼容转换"], stats: { tags: 0, rules: 0, dropped: 0, removed: 0 } };

  const stats = { tags: 0, rules: 0, dropped: 0, removed: 0 };
  const removedIds = new Set<string>();

  /** 去掉 app: 属性与 CL 专属属性；顺手清掉 xmlns:app 声明 */
  const stripAttrs = (n: XmlNode) => {
    for (const k of Object.keys(n.attrs)) {
      const p = n.attrNs?.[k] ?? attrPrefixFor(k);
      if (p === "app" || CL_ATTR_RE.test(k)) {
        delete n.attrs[k];
        if (n.attrNs) delete n.attrNs[k];
        stats.dropped++;
      }
    }
    if (n.nsDecls) delete n.nsDecls.app;
  };

  /** CL 子项 → RelativeLayout 规则（水平 / 垂直分开处理） */
  const CL_H: [string, string][] = [
    ["layout_constraintStart_toEndOf", "layout_toEndOf"],
    ["layout_constraintStart_toStartOf", "layout_alignStart"],
    ["layout_constraintEnd_toStartOf", "layout_toStartOf"],
    ["layout_constraintEnd_toEndOf", "layout_alignEnd"],
  ];
  const CL_V: [string, string][] = [
    ["layout_constraintTop_toBottomOf", "layout_below"],
    ["layout_constraintTop_toTopOf", "layout_alignTop"],
    ["layout_constraintBottom_toTopOf", "layout_above"],
    ["layout_constraintBottom_toBottomOf", "layout_alignBottom"],
  ];

  const clToRelative = (n: XmlNode) => {
    const a = n.attrs;
    const get = (k: string) => (a[k] ?? "").trim();
    const start = get("layout_constraintStart_toStartOf");
    const startEnd = get("layout_constraintStart_toEndOf");
    const end = get("layout_constraintEnd_toEndOf");
    const endStart = get("layout_constraintEnd_toStartOf");
    const top = get("layout_constraintTop_toTopOf");
    const topBottom = get("layout_constraintTop_toBottomOf");
    const bottom = get("layout_constraintBottom_toBottomOf");
    const bottomTop = get("layout_constraintBottom_toTopOf");
    const w0 = isZero(a["layout_width"]);
    const h0 = isZero(a["layout_height"]);
    const hSpan = start === "parent" && end === "parent";
    const vSpan = top === "parent" && bottom === "parent";

    // 水平
    if (hSpan) {
      if (w0) a["layout_width"] = "match_parent";
    } else if (end === "parent") {
      a["layout_alignParentEnd"] = "true";
      stats.rules++;
    } else if (start === "parent") {
      a["layout_alignParentStart"] = "true";
      stats.rules++;
    }
    for (const [from, to] of CL_H) {
      const v = get(from);
      if (!v || v === "parent") continue;
      // 同一侧「to 某控件」和「align 某控件」同时存在时，RelativeLayout 只能留一个：优先 to
      a[to] = v;
      stats.rules++;
    }
    if (startEnd && start && start !== "parent") delete a["layout_alignStart"];
    if (endStart && end && end !== "parent") delete a["layout_alignEnd"];

    // 垂直
    if (vSpan) {
      if (h0) a["layout_height"] = "match_parent";
      else {
        a["layout_centerVertical"] = "true";
        stats.rules++;
      }
    } else if (bottom === "parent") {
      a["layout_alignParentBottom"] = "true";
      stats.rules++;
    } else if (top === "parent") {
      a["layout_alignParentTop"] = "true";
      stats.rules++;
    }
    // 0dp 的「按约束撑满」语义在 RL 里没有等价物
    if (w0 && !hSpan) a["layout_width"] = "wrap_content";
    if (h0 && !vSpan) a["layout_height"] = "wrap_content";
    // 垂直规则
    for (const [from, to] of CL_V) {
      const v = get(from);
      if (!v || v === "parent") continue;
      a[to] = v;
      stats.rules++;
    }
    // 「to 某控件」优先于「align 某控件」（RL 同时给会打架）
    if (topBottom && top && top !== "parent") delete a["layout_alignTop"];
    if (bottomTop && bottom && bottom !== "parent") delete a["layout_alignBottom"];
    // 水平居中的另一种写法：左右都 align parent 且宽度 wrap → centerHorizontal
    if (!hSpan && start === "parent" && end === "parent") a["layout_centerHorizontal"] = "true";
  };

  const walk = (n: XmlNode, parentWasCL: boolean): boolean => {
    const sn = shortName(n.tag);
    if (CL_ROLE_TAGS.has(sn)) {
      const id = (n.attrs["id"] ?? "").replace(/^@\+?id\//, "");
      if (id) removedIds.add(id);
      stats.removed++;
      return false; // 整节点移除
    }
    if (parentWasCL) clToRelative(n);
    stripAttrs(n);
    const mapped = PLATFORM_TAG[sn];
    if (mapped) {
      n.tag = mapped;
      stats.tags++;
    } else if (sn.includes(".") || /^[A-Z]/.test(sn)) {
      // 未知的全限定类名（没有库就找不到）：按结构兜底
      if (n.tag.includes(".")) {
        n.tag = n.children.length ? "FrameLayout" : "TextView";
        stats.tags++;
      }
    }
    const isCL = sn === "ConstraintLayout";
    n.children = n.children.filter((c) => walk(c, isCL));
    return true;
  };

  walk(root, false);

  // 引用被移除节点（barrier / guideline）的地方必须一起清掉，否则 aapt 报 id 找不到
  if (removedIds.size) {
    const bad = new RegExp(`@\\+?id/(${[...removedIds].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
    const clean = (n: XmlNode) => {
      for (const [k, v] of Object.entries(n.attrs)) {
        if (bad.test(String(v).trim())) {
          delete n.attrs[k];
          if (n.attrNs) delete n.attrNs[k];
          stats.dropped++;
        }
      }
      n.children.forEach(clean);
    };
    clean(root);
  }

  const notes: string[] = [];
  if (stats.tags) notes.push(`${stats.tags} 个库控件换成平台控件（androidx / Material → Button/TextView/FrameLayout…）`);
  if (stats.rules) notes.push(`${stats.rules} 条约束翻成 RelativeLayout 规则（toEndOf / below / alignParent…）`);
  if (stats.dropped) notes.push(`去掉 ${stats.dropped} 个库专属属性（app: 前缀与 CL 约束参数）`);
  if (stats.removed) notes.push(`移除 ${stats.removed} 个 Guideline / Barrier（RelativeLayout 没有等价角色）`);
  if (!notes.length) notes.push("这份布局本来就是纯平台控件，内容基本原样");

  return { xml: serialize(root), notes, stats };
}
