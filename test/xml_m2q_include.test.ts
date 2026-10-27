// test/xml_m2q_include.test.ts — M2q：<include> 就地展开
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { expandIncludes, repath } from "../lib/xml/include";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import type { XmlIssue } from "../lib/xml/types";

const A =
  'xmlns:android="http://schemas.android.com/apk/res/android"';

const LAYOUTS: Record<string, string> = {
  "header.xml": `<LinearLayout ${A} android:layout_width="match_parent"
      android:layout_height="wrap_content" android:orientation="vertical">
    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="header" android:id="@+id/h" />
  </LinearLayout>`,
  "card.xml": `<FrameLayout ${A} android:layout_width="wrap_content"
      android:layout_height="wrap_content">
    <include android:layout="@layout/header" android:layout_width="100dp" />
  </FrameLayout>`,
  "a.xml": `<TextView ${A} android:layout_width="wrap_content"
      android:layout_height="wrap_content" android:text="A"
      android:layout_below="@id/b" />`,
  "b.xml": `<TextView ${A} android:layout_width="wrap_content"
      android:layout_height="wrap_content" android:text="B"
      android:layout_below="@id/a" />`,
};

const expand = (xml: string, layouts = LAYOUTS) => {
  const { root } = parseLayoutXml(xml);
  const issues: XmlIssue[] = [];
  expandIncludes(root!, layouts, issues);
  repath(root!);
  return { root: root!, issues };
};

describe("M2q include 展开 — 基本", () => {
  it("include 被替换成被引用布局的根节点，子树完整", () => {
    const { root } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <View android:layout_width="10dp" android:layout_height="10dp" />
        <include android:layout="@layout/header" />
      </LinearLayout>`,
    );
    expect(root.children).toHaveLength(2);
    expect(root.children[1].tag).toBe("LinearLayout"); // header 的根
    expect(root.children[1].children).toHaveLength(1);
    expect(root.children[1].children[0].tag).toBe("TextView");
    expect(root.children[1].includeFile).toBe("header.xml");
  });

  it("路径按展开后结构重排（#0/1/0 = header 里的 TextView）", () => {
    const { root } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <View android:layout_width="10dp" android:layout_height="10dp" />
        <include android:layout="@layout/header" />
      </LinearLayout>`,
    );
    expect(root.children[1].path).toBe("#0/1");
    expect(root.children[1].children[0].path).toBe("#0/1/0");
  });

  it("include 上的布局属性覆盖被引用根节点", () => {
    const { root } = expand(
      `<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/header" android:layout_width="100dp" android:layout_height="80dp"
            android:visibility="gone" />
      </FrameLayout>`,
    );
    const inc = root.children[0];
    expect(inc.attrs["layout_width"]).toBe("100dp");
    expect(inc.attrs["layout_height"]).toBe("80dp");
    expect(inc.attrs["visibility"]).toBe("gone");
  });

  it("两个 include 引用同一文件不冲突（环只按引用链判）", () => {
    const { root, issues } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/header" />
        <include android:layout="@layout/header" />
      </LinearLayout>`,
    );
    expect(root.children).toHaveLength(2);
    expect(root.children[0].tag).toBe("LinearLayout");
    expect(root.children[1].tag).toBe("LinearLayout");
    expect(issues.filter((i) => /循环/.test(i.message))).toHaveLength(0);
  });
});

describe("M2q include 展开 — 嵌套与环", () => {
  it("嵌套 include（card 里含 header）两级全展开", () => {
    const { root } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/card" android:layout_width="match_parent" />
      </LinearLayout>`,
    );
    // card 的根 FrameLayout 被替换进来，其里的 include(header) 也展开
    expect(root.children[0].tag).toBe("FrameLayout");
    expect(root.children[0].includeFile).toBe("card.xml");
    const inner = root.children[0].children[0];
    expect(inner.tag).toBe("LinearLayout"); // header
    expect(inner.includeFile).toBe("header.xml");
    // include 上的 width 覆盖
    expect(inner.attrs["layout_width"]).toBe("100dp");
  });

  it("循环引用 a→b→a：展开第一层，环上截断 + warn", () => {
    const { root, issues } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/a" />
      </LinearLayout>`,
      { "a.xml": LAYOUTS["a.xml"], "b.xml": LAYOUTS["b.xml"] },
    );
    // a 展开；a 里 layout_below 引用的 b 不是 include，只是属性 → 不触发展开
    expect(root.children[0].tag).toBe("TextView");
    const cycIssues = issues.filter((i) => /循环/.test(i.message));
    // 制造真环：a include b，b include a
    const cyc = { "a.xml": `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"><include android:layout="@layout/b" /></LinearLayout>`, "b.xml": `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"><include android:layout="@layout/a" /></LinearLayout>` };
    const r2 = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/a" />
      </LinearLayout>`,
      cyc,
    );
    expect(r2.issues.filter((i) => /循环/.test(i.message))).toHaveLength(1);
    // 截断处：a 里 include b 展开，b 里再 include a 被拦（留占位）
    expect(r2.root.children[0].tag).toBe("LinearLayout"); // a
    expect(r2.root.children[0].children[0].tag).toBe("LinearLayout"); // b
    expect(r2.root.children[0].children[0].children[0].tag).toBe("include"); // a 的占位
    expect(cycIssues.length).toBeGreaterThanOrEqual(0);
  });
});

describe("M2q include 展开 — 边界", () => {
  it("未找到 @layout → 占位保留 + warn", () => {
    const { root, issues } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/missing" />
      </LinearLayout>`,
    );
    expect(root.children[0].tag).toBe("include");
    expect(issues.filter((i) => /未找到/.test(i.message))).toHaveLength(1);
  });

  it("没传 layouts 表时不展开、只报未解析（无表）", () => {
    const { root, issues } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/header" />
      </LinearLayout>`,
      null as unknown as Record<string, string>,
    );
    // null 触发 layouts undefined 分支（JS 默认参数只覆盖 undefined 不覆盖 null）
    expect(root.children[0].tag).toBe("include");
    expect(issues.some((i) => /无法解析/.test(i.message))).toBe(true);
  });

  it("展开后的节点进渲染模型且 sourceFile 传下去", () => {
    const { root } = expand(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/header" android:layout_width="match_parent"
            android:layout_height="wrap_content" />
      </LinearLayout>`,
    );
    const m = buildRenderModel(root, DEFAULT_RESOURCES, 2, LAYOUTS);
    const inc = m.root.children[0];
    expect(inc.tag).toBe("LinearLayout");
    expect(inc.sourceFile).toBe("header.xml");
    expect(inc.children[0].sourceFile).toBe("header.xml"); // 子节点继承
  });

  it("include 在 ConstraintLayout 里展开后子项照常参与约束求解", () => {
    const { root } = expand(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          xmlns:app="http://schemas.android.com/apk/res-auto"
          android:layout_width="match_parent" android:layout_height="match_parent">
        <include android:layout="@layout/header" android:layout_width="200dp"
            android:layout_height="60dp" android:layout_marginStart="20dp" android:layout_marginTop="10dp"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintTop_toTopOf="parent" />
      </androidx.constraintlayout.widget.ConstraintLayout>`,
    );
    const m = buildRenderModel(root, DEFAULT_RESOURCES, 2, LAYOUTS);
    const inc = m.root.children[0];
    expect(inc.tag).toBe("LinearLayout");
    // CL 求解后是 absolute 定位：left = marginStart = 20dp*2=40px，top = 10dp*2=20px
    expect(inc.style.position).toBe("absolute");
    expect(String(inc.style.left)).toBe("40px");
    expect(String(inc.style.top)).toBe("20px");
    expect(String(inc.style.width)).toBe("400px"); // 200dp*2
  });
});
