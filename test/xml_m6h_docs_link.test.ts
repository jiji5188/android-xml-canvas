import { describe, expect, it } from "vitest";
import { officialDocUrl } from "../lib/xml/widget-links";
import { getWidgetDoc, docAttrs } from "../lib/xml/widget-docs";

const BASE = "https://developer.android.com/reference/";

describe("M6h：控件官方文档链接", () => {
  it("平台控件短名 → android.widget", () => {
    expect(officialDocUrl("TextView")).toBe(`${BASE}android/widget/TextView`);
    expect(officialDocUrl("LinearLayout")).toBe(`${BASE}android/widget/LinearLayout`);
    expect(officialDocUrl("Button")).toBe(`${BASE}android/widget/Button`);
  });

  it("AndroidX 控件走对应包", () => {
    expect(officialDocUrl("RecyclerView")).toBe(`${BASE}androidx/recyclerview/widget/RecyclerView`);
    expect(officialDocUrl("ConstraintLayout")).toBe(
      `${BASE}androidx/constraintlayout/widget/ConstraintLayout`,
    );
    expect(officialDocUrl("ViewPager2")).toBe(`${BASE}androidx/viewpager2/widget/ViewPager2`);
    expect(officialDocUrl("NestedScrollView")).toBe(`${BASE}androidx/core/widget/NestedScrollView`);
  });

  it("Material 组件走 com.google.android.material", () => {
    expect(officialDocUrl("MaterialButton")).toBe(
      `${BASE}com/google/android/material/button/MaterialButton`,
    );
    expect(officialDocUrl("TextInputLayout")).toBe(
      `${BASE}com/google/android/material/textfield/TextInputLayout`,
    );
    expect(officialDocUrl("CircularProgressIndicator")).toBe(
      `${BASE}com/google/android/material/progressindicator/CircularProgressIndicator`,
    );
  });

  it("全限定名直接转路径，带前缀的短名等价", () => {
    expect(officialDocUrl("android.widget.TextView")).toBe(`${BASE}android/widget/TextView`);
    expect(officialDocUrl("androidx.recyclerview.widget.RecyclerView")).toBe(
      `${BASE}androidx/recyclerview/widget/RecyclerView`,
    );
    expect(officialDocUrl("com.google.android.material.chip.Chip")).toBe(
      `${BASE}com/google/android/material/chip/Chip`,
    );
  });

  it("项目自定义控件（非 android/androidx/material）不给外链", () => {
    expect(officialDocUrl("com.example.app.ui.MyCard")).toBeNull();
  });

  it("merge / include 这类语法糖没有参考页", () => {
    expect(officialDocUrl("merge")).toBeNull();
    expect(officialDocUrl("include")).toBeNull();
    expect(officialDocUrl("")).toBeNull();
  });

  it("内部类只取外部类", () => {
    expect(officialDocUrl("android.widget.TextView$OnEditorActionListener")).toBe(
      `${BASE}android/widget/TextView`,
    );
  });

  it("文档里已知控件都能拿到链接（除语法糖）", () => {
    const tags = [
      "TextView", "EditText", "ImageView", "ScrollView", "ConstraintLayout", "RecyclerView",
      "ViewPager2", "MaterialButton", "FloatingActionButton", "Chip", "TabLayout",
      "BottomNavigationView", "SwipeRefreshLayout", "CoordinatorLayout", "Toolbar", "CardView",
    ];
    for (const t of tags) {
      const url = officialDocUrl(t);
      expect(url, t).toMatch(/^https:\/\/developer\.android\.com\/reference\/(android|androidx|com\/google)/);
      expect(url!.endsWith(`/${t}`), `${t} 路径末段应是控件名`).toBe(true);
    }
  });

  it("文档面板数据与链接模块配合：每个已收录控件要么有 officialDoc，要么能推导出 URL", () => {
    const samples = [
      "TextView", "LinearLayout", "FrameLayout", "ConstraintLayout", "RecyclerView",
      "MaterialButton", "Chip", "TabLayout", "ScrollView", "ImageView",
    ];
    for (const tag of samples) {
      const doc = getWidgetDoc(tag);
      expect(doc.attrs.length + docAttrs(tag).length).toBeGreaterThan(0);
      const url = doc.officialDoc ?? officialDocUrl(tag);
      expect(url, tag).toBeTruthy();
    }
  });
});
