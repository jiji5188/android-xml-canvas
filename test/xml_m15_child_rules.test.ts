// test/xml_m15_child_rules.test.ts — M15：子控件规则表（用户 2026-10-29 的 5 类明细）
// 覆盖：规则表本身 / canAcceptChild 拒绝路径 / lint 标错 / 组件面板全部模板合规
import { describe, it, expect } from "vitest";
import {
  childRuleOf,
  acceptsChildren,
  maxChildCount,
  canAddChild,
  isLeafTag,
  isRootOnlyTag,
  childRuleSummary,
  shortTag,
} from "../lib/xml/child-rules";
import { canAcceptChild, insertChild, isContainerTag, isSingleChildTag } from "../lib/xml/insert";
import { lintXml } from "../lib/xml/lint";
import { WIDGETS } from "../components/widget-catalog";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

describe("M15 分类 1：仅允许 1 个直接子控件", () => {
  const SINGLE = ["ScrollView", "HorizontalScrollView", "NestedScrollView", "MediaController"];

  it("全部判为 single / max=1", () => {
    for (const t of SINGLE) {
      const r = childRuleOf(t);
      expect(r?.kind, t).toBe("single");
      expect(maxChildCount(t), t).toBe(1);
    }
  });

  it("空着能加，有 1 个就拒（全限定名同样）", () => {
    for (const t of SINGLE) {
      expect(canAddChild(t, 0).ok, t).toBe(true);
      const full = `androidx.core.widget.${t}`;
      const r = canAddChild(full, 1);
      expect(r.ok, full).toBe(false);
      expect(r.reason).toContain("只支持 1 个子控件");
    }
  });

  it("isSingleChildTag 与规则表一致", () => {
    expect(isSingleChildTag("ScrollView")).toBe(true);
    expect(isSingleChildTag("androidx.core.widget.NestedScrollView")).toBe(true);
    expect(isSingleChildTag("LinearLayout")).toBe(false);
  });
});

describe("M15 分类 2：禁止静态 XML 子控件（Adapter 动态加载）", () => {
  const ADAPTER = ["ListView", "GridView", "ExpandableListView", "Spinner", "Gallery", "RecyclerView", "ViewPager", "ViewPager2"];

  it("全部判为 adapter，且不接受拖放", () => {
    for (const t of ADAPTER) {
      expect(childRuleOf(t)?.kind, t).toBe("adapter");
      expect(isContainerTag(t), t).toBe(false);
      expect(canAddChild(t, 0).ok, t).toBe(false);
    }
  });

  it("拒绝原因提到 Adapter", () => {
    expect(canAddChild("RecyclerView", 0).reason).toContain("Adapter");
    expect(canAcceptChild("androidx.recyclerview.widget.RecyclerView", 0).reason).toContain("Adapter");
  });

  it("往 ListView 里 insertChild 被拒且 XML 不变", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ListView ${A} android:layout_width="match_parent" android:layout_height="match_parent" />`;
    const r = insertChild(xml, "#0", `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>`, "文本");
    expect(r.ok).toBe(false);
    expect(r.xml).toBe(xml);
  });
});

describe("M15 分类 3：多子容器 + DrawerLayout 上限 2", () => {
  const MULTI = ["LinearLayout", "ConstraintLayout", "FrameLayout", "RelativeLayout", "GridLayout", "TableLayout", "TableRow", "RadioGroup", "SwipeRefreshLayout", "TabWidget"];

  it("全部判为 multi 且无上限", () => {
    for (const t of MULTI) {
      expect(childRuleOf(t)?.kind, t).toBe("multi");
      expect(maxChildCount(t), t).toBeUndefined();
      expect(canAddChild(t, 40).ok, t).toBe(true);
    }
  });

  it("DrawerLayout 最多 2 个", () => {
    expect(maxChildCount("DrawerLayout")).toBe(2);
    expect(canAddChild("DrawerLayout", 1).ok).toBe(true);
    expect(canAddChild("DrawerLayout", 2).ok).toBe(false);
    expect(canAddChild("androidx.drawerlayout.widget.DrawerLayout", 2).reason).toContain("最多支持 2 个");
  });
});

describe("M15 分类 4：纯 View 叶子控件", () => {
  const LEAF = ["View", "TextView", "Button", "EditText", "CheckBox", "ImageView", "ImageButton", "ProgressBar", "SeekBar", "RatingBar", "Space", "SurfaceView", "TextureView", "VideoView", "Chronometer", "AnalogClock", "Switch", "AutoCompleteTextView"];

  it("全部判为 none / 不接受子控件", () => {
    for (const t of LEAF) {
      expect(childRuleOf(t)?.kind, t).toBe("none");
      expect(isLeafTag(t), t).toBe(true);
      expect(acceptsChildren(t), t).toBe(false);
      expect(canAddChild(t, 0).ok, t).toBe(false);
    }
  });

  it("ViewStub 按事实归叶子（它 extends View，不是 ViewGroup）", () => {
    expect(isLeafTag("ViewStub")).toBe(true);
    expect(canAddChild("ViewStub", 0).reason).toContain("不是 ViewGroup");
  });
});

describe("M15 分类 5：特殊标签 fragment / include / merge", () => {
  it("fragment / include 不能有子控件", () => {
    expect(acceptsChildren("fragment")).toBe(false);
    expect(acceptsChildren("include")).toBe(false);
    expect(canAddChild("fragment", 0).ok).toBe(false);
  });

  it("merge 只能当根节点", () => {
    expect(isRootOnlyTag("merge")).toBe(true);
    expect(isRootOnlyTag("LinearLayout")).toBe(false);
  });
});

describe("M15 lint：结构错误在代码视图里能看见", () => {
  it("ScrollView 放 2 个子控件 → 报只允许 1 个", () => {
    const xml = `<ScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
</ScrollView>`;
    const issues = lintXml(xml);
    const hit = issues.find((i) => i.message.includes("只允许 1 个直接子控件"));
    expect(hit).toBeTruthy();
    expect(hit!.line).toBe(1);
    // 同一父级只报一次
    expect(issues.filter((i) => i.message.includes("只允许 1 个直接子控件")).length).toBe(1);
  });

  it("ListView 里写静态子控件 → 报 Adapter 警告", () => {
    const xml = `<ListView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
</ListView>`;
    const issues = lintXml(xml);
    const hit = issues.find((i) => i.message.includes("Adapter"));
    expect(hit).toBeTruthy();
    expect(hit!.level).toBe("warn");
  });

  it("DrawerLayout 放 3 个 → 报最多 2 个", () => {
    const child = `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>`;
    const xml = `<DrawerLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  ${child}
  ${child}
  ${child}
</DrawerLayout>`;
    const issues = lintXml(xml);
    expect(issues.some((i) => i.message.includes("最多只允许 2 个"))).toBe(true);
  });

  it("merge 当子节点 → 报错", () => {
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <merge ${A} android:layout_width="match_parent" android:layout_height="wrap_content"/>
</LinearLayout>`;
    const issues = lintXml(xml);
    const hit = issues.find((i) => i.message.includes("只能作为 XML 根节点"));
    expect(hit).toBeTruthy();
    expect(hit!.level).toBe("error");
  });

  it("include / fragment 里写字控件 → 警告", () => {
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <include ${A} layout="@layout/header">
    <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  </include>
</LinearLayout>`;
    const issues = lintXml(xml);
    expect(issues.some((i) => i.message.includes("include") && i.message.includes("不能写子控件"))).toBe(true);
  });

  it("合法 XML 不误报结构问题", () => {
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <ScrollView ${A} android:layout_width="match_parent" android:layout_height="wrap_content">
    <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  </ScrollView>
  <ListView ${A} android:layout_width="match_parent" android:layout_height="wrap_content" />
</LinearLayout>`;
    const issues = lintXml(xml);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });
});

describe("M15 组件面板全部模板都符合规则表", () => {
  it("模板根标签放得下自己的子控件（叶子/Adapter 不得带子）", () => {
    for (const w of WIDGETS) {
      const src = w.xml.trim();
      const tag = /^<\s*([A-Za-z0-9_.]+)/.exec(src)?.[1] ?? "";
      const selfClosed = /\/>\s*$/.test(src);
      const hasChild = !selfClosed && /<\s*[A-Za-z0-9_.]+/.test(src.slice(src.indexOf(">") + 1));
      if (hasChild) {
        expect(acceptsChildren(tag), `${w.label} (${tag}) 带子控件但规则表说不能`).toBe(true);
        const max = maxChildCount(tag);
        if (max !== undefined) {
          const kids = (src.match(/<(?!\/)[A-Za-z0-9_.]+/g) || []).length - 1;
          expect(kids, `${w.label} (${tag}) 子控件 ${kids} 个，上限 ${max}`).toBeLessThanOrEqual(max);
        }
      } else {
        // 自闭合/空标签：叶子或容器都合法，但叶子不能出现「带闭合标签又有内容」
        expect(shortTag(tag).length).toBeGreaterThan(0);
      }
    }
  });

  it("面板里每个控件都能拿到规则（不认识的标签 = 0 个）", () => {
    const unknown = WIDGETS.filter((w) => {
      const tag = /^<\s*([A-Za-z0-9_.]+)/.exec(w.xml.trim())?.[1] ?? "";
      return childRuleOf(tag) === null;
    }).map((w) => w.label);
    expect(unknown).toEqual([]);
  });

  it("规则摘要能完整导出 5 类", () => {
    const s = childRuleSummary();
    expect(s.map((x) => x.cat)).toEqual([1, 2, 3, 4, 5]);
    for (const g of s) expect(g.tags.length).toBeGreaterThan(0);
  });
});
