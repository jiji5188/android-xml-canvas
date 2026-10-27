// M3f：控件文档扩充（Material 组件 + 平台常用控件）
import { describe, expect, it } from "vitest";
import { getWidgetDoc, docAttrs, docForAttr, shortDocTag } from "../lib/xml/widget-docs";
import { WIDGETS, WIDGET_GROUPS, GROUP_ICON } from "../components/widget-catalog";
import { parseLayoutXml } from "../lib/xml/parser";

describe("M3f 新增控件文档", () => {
  it("组件面板里每个控件都有专属文档（不留兜底）", () => {
    const missing: string[] = [];
    for (const w of WIDGETS) {
      const short = shortDocTag(w.tag);
      const d = getWidgetDoc(short);
      if (d.title === short) missing.push(short);
    }
    expect(missing).toEqual([]);
  });

  it("Material 组件齐全", () => {
    const cases: [string, string][] = [
      ["Slider", "滑块"],
      ["FloatingActionButton", "浮动按钮"],
      ["ExtendedFloatingActionButton", "带文字的浮动按钮"],
      ["Toolbar", "工具栏"],
      ["MaterialToolbar", "Material 工具栏"],
      ["AppBarLayout", "应用栏容器"],
      ["CollapsingToolbarLayout", "可折叠标题栏"],
      ["BottomNavigationView", "底部导航"],
      ["NavigationView", "侧边抽屉菜单"],
      ["TabLayout", "标签页"],
      ["Chip", "芯片"],
      ["ChipGroup", "芯片组"],
      ["SwipeRefreshLayout", "下拉刷新"],
      ["ViewPager2", "滑动翻页容器"],
      ["MaterialButtonToggleGroup", "按钮切换组"],
    ];
    for (const [tag, title] of cases) expect(getWidgetDoc(tag).title).toBe(title);
  });

  it("平台常用控件齐全", () => {
    for (const tag of [
      "AutoCompleteTextView",
      "CheckedTextView",
      "ToggleButton",
      "RatingBar",
      "NumberPicker",
      "SearchView",
      "WebView",
      "VideoView",
      "ViewFlipper",
      "MotionLayout",
      "Flow",
      "FragmentContainerView",
      "DatePicker",
      "TimePicker",
      "CalendarView",
      "ExpandableListView",
      "CircularProgressIndicator",
      "LinearProgressIndicator",
    ]) {
      const d = getWidgetDoc(tag);
      expect(d.title).not.toBe(tag);
      expect(d.attrs.length).toBeGreaterThan(1);
    }
  });

  it("Material 变体别名归一（MaterialTextView / MaterialAutoCompleteTextView）", () => {
    expect(getWidgetDoc("MaterialTextView").title).toBe(getWidgetDoc("TextView").title);
    expect(getWidgetDoc("MaterialAutoCompleteTextView").title).toBe("自动补全输入框");
    expect(getWidgetDoc("LinearLayoutCompat").title).toBe(getWidgetDoc("LinearLayout").title);
  });

  it("全限定类名也能取到（androidx.appcompat.widget.Toolbar）", () => {
    expect(getWidgetDoc("androidx.appcompat.widget.Toolbar").title).toBe("工具栏");
    expect(getWidgetDoc("com.google.android.material.chip.Chip").title).toBe("芯片");
    expect(getWidgetDoc("androidx.viewpager2.widget.ViewPager2").title).toBe("滑动翻页容器");
  });

  it("FAB 属性继承完整（ExtendedFAB 含 FAB 的全部属性）", () => {
    const fab = getWidgetDoc("FloatingActionButton").attrs.map((a) => a.name);
    const ext = getWidgetDoc("ExtendedFloatingActionButton").attrs.map((a) => a.name);
    for (const n of fab) expect(ext).toContain(n);
  });

  it("关键属性说明可查到", () => {
    expect(docForAttr("Slider", "android:value")).not.toBeNull();
    expect(docForAttr("BottomNavigationView", "app:menu")?.desc).toContain("菜单");
    expect(docForAttr("TabLayout", "app:tabMode")?.values).toContain("scrollable");
    expect(docForAttr("Chip", "app:checkable")?.desc).toContain("勾选");
    expect(docForAttr("MotionLayout", "app:layoutDescription")?.desc).toContain("场景");
  });

  it("新增文档的 name/desc/values 都不空（数据完整性）", () => {
    const tags = [
      "Slider",
      "FloatingActionButton",
      "Toolbar",
      "AppBarLayout",
      "BottomNavigationView",
      "Chip",
      "ChipGroup",
      "ViewPager2",
      "MotionLayout",
      "Flow",
      "RatingBar",
      "WebView",
    ];
    for (const t of tags) {
      for (const a of docAttrs(t)) {
        expect(a.name.trim().length).toBeGreaterThan(0);
        expect(a.desc.length).toBeGreaterThanOrEqual(3);
        for (const v of a.values ?? []) expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("M3f2 分类拆分（Material 组与平台组分开）", () => {
  it("Material 组件归入 Material 组（不再散在 选择/容器/其他）", () => {
    for (const tag of [
      "MaterialButton",
      "MaterialCardView",
      "SwitchMaterial",
      "TextInputLayout",
      "Slider",
      "FloatingActionButton",
      "ExtendedFloatingActionButton",
      "Toolbar",
      "MaterialToolbar",
      "AppBarLayout",
      "CollapsingToolbarLayout",
      "BottomNavigationView",
      "NavigationView",
      "TabLayout",
      "Chip",
      "ChipGroup",
      "SwipeRefreshLayout",
      "ViewPager2",
      "MaterialButtonToggleGroup",
      "CircularProgressIndicator",
      "LinearProgressIndicator",
    ]) {
      expect(getWidgetDoc(tag).category).toBe("Material");
    }
  });

  it("平台常用控件保留原有分组（选择/输入/列表/其他/容器/布局）", () => {
    expect(getWidgetDoc("RatingBar").category).toBe("选择");
    expect(getWidgetDoc("AutoCompleteTextView").category).toBe("输入");
    expect(getWidgetDoc("GridView").category).toBe("列表");
    expect(getWidgetDoc("Chronometer").category).toBe("其他");
    expect(getWidgetDoc("ViewPager").category).toBe("容器");
    expect(getWidgetDoc("MotionLayout").category).toBe("布局");
  });

  it("新增 M3f2 平台控件都有专属文档（非兑底）", () => {
    for (const tag of [
      "Chronometer",
      "TextClock",
      "AnalogClock",
      "DigitalClock",
      "MultiAutoCompleteTextView",
      "TextureView",
      "GridView",
      "ViewPager",
      "PagerTabStrip",
      "PagerTitleStrip",
      "Group",
      "ViewAnimator",
      "TabHost",
      "TabWidget",
    ]) {
      expect(getWidgetDoc(tag).title).not.toBe(tag);
    }
  });

  it("新增 M3f2 平台控件的 name/desc 不空", () => {
    for (const t of ["Chronometer", "GridView", "ViewPager", "Group", "ViewAnimator", "TabHost"]) {
      for (const a of docAttrs(t)) {
        expect(a.name.trim().length).toBeGreaterThan(0);
        expect(a.desc.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("M3f3 组件面板：Material 组与平台组分开", () => {
  it("面板里存在独立的 Material 分组，且在最后", () => {
    expect(WIDGET_GROUPS).toContain("Material");
    expect(WIDGET_GROUPS[WIDGET_GROUPS.length - 1]).toBe("Material");
    expect(GROUP_ICON.Material).toBeTruthy();
  });

  it("Material 组的组件数量合理（≥12）", () => {
    expect(WIDGETS.filter((w) => w.group === "Material").length).toBeGreaterThanOrEqual(12);
  });

  it("Material 组的每个组件都有 Material 分类的文档", () => {
    for (const w of WIDGETS.filter((x) => x.group === "Material")) {
      const d = getWidgetDoc(w.tag);
      expect({ tag: w.tag, cat: d.category }).toEqual({ tag: w.tag, cat: "Material" });
    }
  });

  it("平台组里不再混 Material 控件（滑块已归入 Material）", () => {
    const platform = WIDGETS.filter((w) => w.group !== "Material");
    for (const w of platform) {
      expect(getWidgetDoc(w.tag).category).not.toBe("Material");
    }
    expect(WIDGETS.find((w) => w.key === "slider")?.group).toBe("Material");
  });

  it("新增 Material 模板都能被解析（无 error 级问题）", () => {
    for (const w of WIDGETS.filter((x) => x.group === "Material")) {
      const { root, issues } = parseLayoutXml(w.xml);
      expect({ key: w.key, ok: !!root }).toEqual({ key: w.key, ok: true });
      const errs = issues.filter((i) => i.level === "error");
      expect({ key: w.key, errs: errs.length }).toEqual({ key: w.key, errs: 0 });
    }
  });

  it("Material 模板带 app: 属性时都声明了 xmlns:app", () => {
    for (const w of WIDGETS.filter((x) => x.group === "Material")) {
      const usesApp = /\sapp:[\w_]+=/.test(w.xml);
      if (usesApp) expect({ key: w.key, ns: w.xml.includes("xmlns:app") }).toEqual({ key: w.key, ns: true });
    }
  });
});
