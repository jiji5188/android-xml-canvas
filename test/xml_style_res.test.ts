// test/xml_style_res.test.ts — @style 生效 / @android:color / 比例与百分比约束
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { resolveNodeAttrs, resolveColor } from "../lib/xml/resolve";
import { buildRenderModel } from "../lib/xml/css";
import { FRAMEWORK_COLORS, FRAMEWORK_STYLES, mergeResourceFragment } from "../lib/xml/resources";
import type { ResourceTable } from "../lib/xml/types";

function firstChild(xml: string) {
  const { root } = parseLayoutXml(xml);
  return root!.children[0];
}

function baseRes(extra?: Partial<ResourceTable>): ResourceTable {
  return {
    strings: {},
    dimens: {},
    colors: {},
    drawables: {},
    vectorNames: [],
    styles: {},
    ...extra,
  };
}

describe("@style 展开", () => {
  it("style 里的属性会被节点继承（显式属性优先）", () => {
    const node = firstChild(`<LinearLayout>
      <TextView style="@style/Big" android:textSize="30sp" />
    </LinearLayout>`);
    const res = baseRes({
      styles: {
        Big: {
          name: "Big",
          attrs: { "android:textSize": "20sp", "android:textColor": "#FF0000", "android:textStyle": "bold" },
        },
      },
    });
    const { attrs, issues } = resolveNodeAttrs(node!, res);
    expect(attrs["textSize"]).toBe(30); // 显式覆盖 style 的 20sp
    expect(attrs["textColor"]).toBe("#FF0000"); // 从 style 继承
    expect(attrs["textStyle"]).toBe("bold");
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("style 未定义时给 warn，不崩", () => {
    const node = firstChild(`<LinearLayout><TextView style="@style/Nope" /></LinearLayout>`);
    const { issues } = resolveNodeAttrs(node!, baseRes());
    expect(issues.some((i) => i.message.includes("@style/Nope"))).toBe(true);
  });

  it("textAppearance 也能展开", () => {
    const node = firstChild(`<LinearLayout>
      <TextView textAppearance="@style/TextAppearance.Material.Caption" />
    </LinearLayout>`);
    const { attrs } = resolveNodeAttrs(node!, baseRes());
    expect(attrs["textSize"]).toBe(12); // Caption = 12sp
  });

  it("@android:style 框架样式（TextAppearance Material）命中内置表", () => {
    const node = firstChild(`<LinearLayout>
      <TextView textAppearance="@android:style/TextAppearance.Material.Title" />
    </LinearLayout>`);
    const { attrs } = resolveNodeAttrs(node!, baseRes());
    expect(attrs["textSize"]).toBe(16);
    expect(attrs["textStyle"]).toBe("bold");
  });

  it("@android:style 未收录时静默忽略（不刷 warn 噪声）", () => {
    const node = firstChild(`<LinearLayout>
      <TextView textAppearance="@android:style/TextAppearance.Material.Unknown" />
    </LinearLayout>`);
    const { issues } = resolveNodeAttrs(node!, baseRes());
    expect(issues.some((i) => i.message.includes("TextAppearance"))).toBe(false);
  });
});

describe("@android:color 框架色", () => {
  it("常见框架色能解析", () => {
    const issues: import("../lib/xml/types").XmlIssue[] = [];
    expect(resolveColor("@android:color/white", baseRes(), issues, "#0", "background")).toBe("#FFFFFF");
    expect(resolveColor("@android:color/transparent", baseRes(), issues, "#0", "background")).toBe("transparent");
    expect(resolveColor("@android:color/darker_gray", baseRes(), issues, "#0", "background")).toBe(
      FRAMEWORK_COLORS["darker_gray"] ?? "#888888",
    );
    expect(issues).toHaveLength(0);
  });

  it("未收录的框架色给 warn + 兜底色", () => {
    const issues: import("../lib/xml/types").XmlIssue[] = [];
    const c = resolveColor("@android:color/not_a_real_color", baseRes(), issues, "#0", "background");
    expect(c).toBe("#888888");
    expect(issues).toHaveLength(1);
  });

  it("?attr/colorPrimary 有默认 Material3 色", () => {
    const issues: import("../lib/xml/types").XmlIssue[] = [];
    expect(resolveColor("?attr/colorPrimary", baseRes(), issues, "#0", "background")).toBe("#6750A4");
  });
});

describe("比例与百分比约束", () => {
  const cl = (childAttrs: string) => `<androidx.constraintlayout.widget.ConstraintLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent"
      android:layout_height="match_parent">
      <View android:id="@+id/v" ${childAttrs} />
    </androidx.constraintlayout.widget.ConstraintLayout>`;

  it("layout_constraintDimensionRatio 1:1（宽 0dp + 左右约束）→ 正方形", () => {
    const { root } = parseLayoutXml(
      cl(`android:layout_width="0dp" android:layout_height="0dp"
          app:layout_constraintDimensionRatio="1:1"
          app:layout_constraintStart_toStartOf="parent"
          app:layout_constraintEnd_toEndOf="parent"
          app:layout_constraintTop_toTopOf="parent"`),
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const v = model.root.children[0];
    expect(v.style.width).toBe("824px"); // 撑满父宽（412dp * scale 2）
    expect(v.style.height).toBe("824px"); // 1:1
  });

  it("DimensionRatio 16:9 → 高度 = 宽 / (16/9)", () => {
    const { root } = parseLayoutXml(
      cl(`android:layout_width="0dp" android:layout_height="0dp"
          app:layout_constraintDimensionRatio="16:9"
          app:layout_constraintStart_toStartOf="parent"
          app:layout_constraintEnd_toEndOf="parent"
          app:layout_constraintTop_toTopOf="parent"`),
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const v = model.root.children[0];
    expect(v.style.width).toBe("824px");
    expect(v.style.height).toBe("464px"); // 824 / (16/9) ≈ 463.5 → round 464
  });

  it("DimensionRatio 带 H 前缀：以高度反推宽度", () => {
    const { root } = parseLayoutXml(
      cl(`android:layout_width="0dp" android:layout_height="0dp"
          app:layout_constraintDimensionRatio="H,1:2"
          app:layout_constraintTop_toTopOf="parent"
          app:layout_constraintBottom_toBottomOf="parent"`),
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const v = model.root.children[0];
    // 高度撑满父（892dp*2=1784px），宽度 = 高 / 2
    expect(v.style.height).toBe("1784px");
    expect(v.style.width).toBe("892px");
  });

  it("layout_constraintWidth_percent 0.5 → 父宽一半", () => {
    const { root } = parseLayoutXml(
      cl(`android:layout_width="0dp" android:layout_height="48dp"
          app:layout_constraintWidth_percent="0.5"
          app:layout_constraintStart_toStartOf="parent"
          app:layout_constraintTop_toTopOf="parent"`),
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const v = model.root.children[0];
    expect(v.style.width).toBe("412px"); // 412dp*2*0.5
    expect(v.style.height).toBe("96px"); // 48dp*2
  });

  it("layout_constraintHeight_percent 0.25 → 父高四分之一", () => {
    const { root } = parseLayoutXml(
      cl(`android:layout_width="48dp" android:layout_height="0dp"
          app:layout_constraintHeight_percent="0.25"
          app:layout_constraintTop_toTopOf="parent"
          app:layout_constraintStart_toStartOf="parent"`),
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const v = model.root.children[0];
    expect(v.style.height).toBe("446px"); // 892*2*0.25 = 446
  });
});

describe("文字排版细节", () => {
  it("maxLines + ellipsize=end 生成 line-clamp", () => {
    const { root } = parseLayoutXml(
      `<LinearLayout><TextView android:layout_width="100dp" android:layout_height="wrap_content"
         android:text="a" android:maxLines="2" android:ellipsize="end" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const t = model.root.children[0];
    expect(t.style.WebkitLineClamp).toBe("2");
    expect(t.style.overflow).toBe("hidden");
    expect(t.style.textOverflow).toBe("ellipsis");
  });

  it("letterSpacing 生成 px 值", () => {
    const { root } = parseLayoutXml(
      `<LinearLayout><TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:text="a" android:textSize="20sp" android:letterSpacing="0.05" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, baseRes(), 2);
    const t = model.root.children[0];
    // 20sp*2 = 40px 字号，0.05 * 40 = 2px
    expect(t.style.letterSpacing).toBe("2.00px");
  });
});

describe("mergeResourceFragment 带上框架样式兜底", () => {
  it("合并后 styles 里有 TextAppearance.Material.Title", () => {
    const merged = mergeResourceFragment("");
    expect(merged.styles?.["TextAppearance.Material.Title"]).toBeDefined();
    expect(Object.keys(FRAMEWORK_STYLES).length).toBeGreaterThan(5);
  });
});
