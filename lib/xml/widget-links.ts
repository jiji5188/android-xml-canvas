// lib/xml/widget-links.ts — 控件 → 官方文档链接（developer.android.com）
// 定位：文档面板里给「想看完整 API」的人一个出口。纯函数，无副作用。
// 规则：全限定名直接拼路径；短名先查包名映射，查不到兜底 android.widget（多数平台控件都在这里）。

const REF = "https://developer.android.com/reference/";

/** 短名 → 所在包（只列「不是 android.widget」的，其余兜底） */
const PKG_BY_SHORT: Record<string, string> = (() => {
  const groups: Record<string, string[]> = {
    "androidx.constraintlayout.widget": [
      "ConstraintLayout", "ConstraintHelper", "Guideline", "Barrier", "Group", "Flow", "Placeholder",
    ],
    "androidx.coordinatorlayout.widget": ["CoordinatorLayout"],
    "androidx.drawerlayout.widget": ["DrawerLayout"],
    "androidx.core.widget": ["NestedScrollView"],
    "androidx.viewpager2.widget": ["ViewPager2"],
    "androidx.viewpager.widget": ["ViewPager", "PagerTabStrip", "PagerTitleStrip"],
    "androidx.recyclerview.widget": ["RecyclerView"],
    "androidx.fragment.app": ["FragmentContainerView"],
    "androidx.swiperefreshlayout.widget": ["SwipeRefreshLayout"],
    "androidx.appcompat.widget": ["Toolbar", "SearchView", "SwitchCompat", "LinearLayoutCompat"],
    "androidx.cardview.widget": ["CardView"],
    "com.google.android.material.button": ["MaterialButton", "MaterialButtonToggleGroup"],
    "com.google.android.material.floatingactionbutton": [
      "FloatingActionButton", "ExtendedFloatingActionButton",
    ],
    "com.google.android.material.appbar": ["AppBarLayout", "CollapsingToolbarLayout", "MaterialToolbar"],
    "com.google.android.material.bottomnavigation": ["BottomNavigationView"],
    "com.google.android.material.navigation": ["NavigationView"],
    "com.google.android.material.tabs": ["TabLayout", "TabItem"],
    "com.google.android.material.chip": ["Chip", "ChipGroup"],
    "com.google.android.material.slider": ["Slider"],
    "com.google.android.material.card": ["MaterialCardView"],
    "com.google.android.material.textfield": ["TextInputLayout", "TextInputEditText"],
    "com.google.android.material.progressindicator": [
      "CircularProgressIndicator", "LinearProgressIndicator",
    ],
    "com.google.android.material.switchmaterial": ["SwitchMaterial"],
    "com.google.android.material.checkbox": ["MaterialCheckBox"],
    "com.google.android.material.radiobutton": ["MaterialRadioButton"],
    "com.google.android.material.textview": ["MaterialTextView"],
  };
  const flat: Record<string, string> = {};
  for (const [pkg, names] of Object.entries(groups)) {
    for (const n of names) if (!flat[n]) flat[n] = pkg;
  }
  return flat;
})();

/** 没有官方参考页的标签（纯容器语法糖） */
const NO_DOC = new Set(["merge", "requestFocus", "tag", "include"]);

/**
 * 控件标签 → 官方文档 URL。
 * - `android.widget.TextView` → …/reference/android/widget/TextView
 * - `RecyclerView` / `androidx.recyclerview.widget.RecyclerView` → …/reference/androidx/recyclerview/widget/RecyclerView
 * - `MaterialButton` → …/reference/com/google/android/material/button/MaterialButton
 * - `merge` 这类无参考页的返回 null
 */
export function officialDocUrl(tag: string): string | null {
  const t = (tag || "").trim();
  if (!t) return null;
  const short = t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
  if (NO_DOC.has(short.toLowerCase()) || NO_DOC.has(short)) return null;

  if (t.includes(".")) {
    // 全限定名：只接受 Android / AndroidX / Material 三个域，其它（项目自定义控件）不给链接
    if (!/^(android|androidx|com\.google\.android)\./.test(t)) return null;
    // 类型带内部类（android.widget.TextView$OnEditorActionListener）→ 取外部类
    const outer = t.split("$")[0];
    return REF + outer.replace(/\./g, "/");
  }

  const pkg = PKG_BY_SHORT[short] ?? "android.widget";
  return REF + pkg.replace(/\./g, "/") + "/" + short;
}
