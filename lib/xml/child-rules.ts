// lib/xml/child-rules.ts — 子控件规则表（单一事实源，M15）
//
// 用户 2026-10-29 给的规则明细（5 类）落到这里，insert.ts（添加/拖放）、
// XmlEditor（拖动落位 maxChildren）、lint.ts（代码视图标错）全部从这里取，
// 不再各写一份 Set —— 以前 CONTAINER_TAGS / SINGLE_CHILD_TAGS / KNOWN_LEAF_TAGS
// 三张表各说各话，控件一多就漂。
//
// 五个分类：
//   1. single  仅允许 1 个直接子控件（ScrollView 家族…）
//   2. adapter 禁止静态 XML 子控件（Adapter 动态生成）
//   3. multi   支持多个直接子控件（普通布局容器）
//   4. none    纯 View 叶子控件（只能自闭合）
//   5. special 非 View/ViewGroup 的特殊标签（fragment / include / merge）

export type ChildRuleKind = "single" | "adapter" | "multi" | "none";

export interface ChildRule {
  kind: ChildRuleKind;
  /** 最大直接子控件数；undefined = 不限制 */
  max?: number;
  /** 规则来源分类（1..5），便于文档/提示引用 */
  cat: 1 | 2 | 3 | 4 | 5;
  /** 中文说明（UI 提示 / lint 文案用） */
  desc: string;
  /** 只能当根节点（merge） */
  rootOnly?: boolean;
}

/** 类别 1：仅允许 1 个直接子控件
 *  注：用户表里带了 ViewStub，但 ViewStub 实际继承自 View（不是 ViewGroup），
 *  真机上给它写子控件会崩，故这里按事实归到 none（见 KNOWN_LEAF_EXTRA 说明）。 */
const C1_SINGLE = [
  "ScrollView",
  "HorizontalScrollView",
  "NestedScrollView",
  "MediaController",
  "SlidingDrawer",
];

/** 类别 2：ViewGroup 但不接受静态 XML 子控件（子项由 Adapter / Menu 生成） */
const C2_ADAPTER = [
  "ListView",
  "GridView",
  "ExpandableListView",
  "Spinner",
  "Gallery",
  "AbsListView",
  "AdapterViewAnimator",
  "RecyclerView",
  "ViewPager",
  "ViewPager2",
];

/** 类别 3：支持多个直接子控件 */
export const C3_MULTI = [
  "LinearLayout",
  "LinearLayoutCompat",
  "ConstraintLayout",
  "MotionLayout",
  "FrameLayout",
  "RelativeLayout",
  "GridLayout",
  "TableLayout",
  "TableRow",
  "CoordinatorLayout",
  "SlidingPaneLayout",
  "AbsoluteLayout",
  "PagerTitleStrip",
  "FragmentBreadCrumbs",
  "RadioGroup",
  "TabHost",
  "TabWidget",
  "ViewAnimator",
  "ViewFlipper",
  "ViewSwitcher",
  "ImageSwitcher",
  "TextSwitcher",
  "SwipeRefreshLayout",
  "DrawerLayout",
  // —— 项目扩展（用户表未列，但确实是多子容器的 ViewGroup）——
  "AppBarLayout",
  "CollapsingToolbarLayout",
  "BottomAppBar",
  "CardView",
  "MaterialCardView",
  "TextInputLayout",
  "ChipGroup",
  "MaterialButtonToggleGroup",
  "SquareButtonToggleGroup",
  "TabLayout",
  "Toolbar",
  "MaterialToolbar",
  "NavigationView",
  "BottomNavigationView", // 子项来自 menu，见 OVERRIDES 改成 adapter
  "NavigationRailView",
];

/** 类别 4：纯 View 叶子控件（完全不接受子控件） */
export const C4_LEAF = [
  "View",
  "TextView",
  "Button",
  "EditText",
  "CheckBox",
  "RadioButton",
  "ToggleButton",
  "Switch",
  "AutoCompleteTextView",
  "MultiAutoCompleteTextView",
  "Chronometer",
  "DigitalClock",
  "AnalogClock",
  "ImageView",
  "ImageButton",
  "SurfaceView",
  "TextureView",
  "VideoView",
  "ProgressBar",
  "SeekBar",
  "RatingBar",
  "Space",
  "KeyboardView",
  // —— 项目扩展 ——
  "MaterialButton",
  "SwitchCompat",
  "SwitchMaterial",
  "TextClock",
  "TextInputEditText",
  "Chip",
  "FloatingActionButton",
  "ExtendedFloatingActionButton",
  "LinearProgressIndicator",
  "CircularProgressIndicator",
  "Slider",
  "ViewStub", // 事实修正：ViewStub extends View，不是 ViewGroup
  // 系统控件：真身虽是 ViewGroup 子类，但内部 UI 由系统接管（本项目用占位框渲染）
  "NumberPicker",
  "DatePicker",
  "TimePicker",
  // M16：面板新增
  "Guideline", // 约束辅助节点，不是真控件
  "Barrier",
  "SearchView", // LinearLayout 子类，内部 UI 系统接管，不给塞子控件
  "TabItem", // TabLayout 的子项
  "CheckedTextView",
];

/** 类别 5：特殊标签（不是 View / ViewGroup） */
export interface SpecialRule {
  desc: string;
  max?: number;
  rootOnly?: boolean;
}

export const C5_SPECIAL: Record<string, SpecialRule> = {
  fragment: { desc: "内部不能写子控件，只能通过 class/android:name 引用外部 Fragment", max: 0 },
  include: { desc: "内部不能写子控件，只能通过 layout 属性引入外部布局", max: 0 },
  merge: { desc: "只能作为 XML 根节点，不能放在其他控件内部", rootOnly: true },
};

/** 个别标签覆盖（分类表冲突 / 项目既有硬约束） */
const OVERRIDES: Record<string, ChildRule> = {
  // 用户 2026-10-28 明确：CardView 技术上能放多个，UI 只给放 1 个
  CardView: { kind: "single", max: 1, cat: 1, desc: "只允许 1 个直接子控件（项目约定）" },
  MaterialCardView: { kind: "single", max: 1, cat: 1, desc: "只允许 1 个直接子控件（项目约定）" },
  // DrawerLayout：最多 2 个（content + drawer）
  DrawerLayout: { kind: "multi", max: 2, cat: 3, desc: "最多只能 2 个直接子控件，超出报错" },
  // SlidingDrawer：必须正好 2 个（handle + content）
  SlidingDrawer: { kind: "multi", max: 2, cat: 1, desc: "必须正好 2 个直接子控件（handle + content）" },
  // BottomNavigationView / NavigationView 的子项由 menu/header 生成
  BottomNavigationView: { kind: "adapter", max: 0, cat: 2, desc: "子项由 menu 动态生成，禁止静态 XML 子控件" },
  NavigationView: { kind: "adapter", max: 0, cat: 2, desc: "子项由 menu/header 动态生成，禁止静态 XML 子控件" },
  NavigationRailView: { kind: "adapter", max: 0, cat: 2, desc: "子项由 menu 动态生成，禁止静态 XML 子控件" },
  // TabWidget 是 LinearLayout 子类，可静态放子控件，但里面只该有 tab
  Toolbar: { kind: "multi", cat: 3, desc: "支持多个直接子控件" },
  // FragmentContainerView 只应装 1 个 Fragment
  FragmentContainerView: { kind: "single", max: 1, cat: 1, desc: "只允许 1 个直接子控件（内部应只放 1 个 Fragment）" },
};

const S = new Set<string>(C1_SINGLE);
const A = new Set<string>(C2_ADAPTER);
const M = new Set<string>(C3_MULTI);
const L = new Set<string>(C4_LEAF);

/** 全限定名取尾段：androidx.core.widget.NestedScrollView → NestedScrollView */
export function shortTag(raw: string): string {
  const t = (raw || "").trim();
  return t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
}

/** 取某个标签的子控件规则；不认识的标签返回 null（调用方自行降级） */
export function childRuleOf(rawTag: string): ChildRule | null {
  const tag = shortTag(rawTag);
  if (!tag) return null;
  const ov = OVERRIDES[tag];
  if (ov) return ov;
  const sp = C5_SPECIAL[tag];
  if (sp) {
    return {
      kind: sp.rootOnly ? "multi" : "none",
      max: sp.rootOnly ? undefined : (sp.max ?? 0),
      cat: 5,
      desc: sp.desc,
      rootOnly: sp.rootOnly,
    };
  }
  if (A.has(tag)) return { kind: "adapter", max: 0, cat: 2, desc: "子项由 Adapter 动态生成，禁止静态 XML 子控件" };
  if (S.has(tag)) return { kind: "single", max: 1, cat: 1, desc: "只允许 1 个直接子控件" };
  if (M.has(tag)) return { kind: "multi", cat: 3, desc: "支持多个直接子控件" };
  if (L.has(tag)) return { kind: "none", max: 0, cat: 4, desc: "纯 View 叶子控件，不能包含任何子控件" };
  return null;
}

/** 是否 ViewGroup 且能接静态子控件（single / multi 都算） */
export function acceptsChildren(rawTag: string): boolean {
  const r = childRuleOf(rawTag);
  if (!r) return false;
  return r.kind === "single" || r.kind === "multi";
}

/** 最大直接子控件数（undefined = 不限） */
export function maxChildCount(rawTag: string): number | undefined {
  return childRuleOf(rawTag)?.max;
}

/** 是否已知叶子控件（lint 用来报「不符合」而不是「不认识」） */
export function isLeafTag(rawTag: string): boolean {
  return childRuleOf(rawTag)?.kind === "none";
}

/** 只能当根节点吗（merge） */
export function isRootOnlyTag(rawTag: string): boolean {
  return childRuleOf(rawTag)?.rootOnly === true;
}

export interface ChildCheck {
  ok: boolean;
  reason?: string;
}

/** 往该容器里再塞 1 个子控件，允许吗？childCount = 现有直接子控件数 */
export function canAddChild(rawTag: string, childCount: number): ChildCheck {
  const tag = shortTag(rawTag);
  const rule = childRuleOf(tag);
  if (!rule) {
    return { ok: false, reason: `${tag} 不认识的控件，无法确定是否 ViewGroup` };
  }
  if (rule.kind === "none") {
    return { ok: false, reason: `${tag} 不是 ViewGroup，不支持子控件` };
  }
  if (rule.kind === "adapter") {
    return { ok: false, reason: `${tag} 的子项由 Adapter 动态生成，不能添加静态子控件` };
  }
  if (rule.max !== undefined && childCount >= rule.max) {
    return {
      ok: false,
      reason:
        rule.max === 1
          ? `${tag} 只支持 1 个子控件，已存在 ${childCount} 个`
          : `${tag} 最多支持 ${rule.max} 个直接子控件，已存在 ${childCount} 个`,
    };
  }
  return { ok: true };
}

/** 给 UI/文档用的规则摘要（导出检查报告里可以列） */
export function childRuleSummary(): { cat: number; desc: string; tags: string[] }[] {
  return [
    { cat: 1, desc: "仅允许 1 个直接子控件", tags: [...S].filter((t) => !OVERRIDES[t]) },
    { cat: 2, desc: "禁止静态 XML 子控件（Adapter 动态生成）", tags: [...A] },
    { cat: 3, desc: "支持多个直接子控件", tags: [...M] },
    { cat: 4, desc: "纯 View 叶子控件，不能有子控件", tags: [...L] },
    { cat: 5, desc: "特殊标签（fragment / include / merge）", tags: Object.keys(C5_SPECIAL) },
  ];
}
