// M3a：控件属性文档面板数据层
import { describe, expect, it } from "vitest";
import { getWidgetDoc, docAttrs, docForAttr, attrHint, shortDocTag, COMMON_ATTRS } from "../lib/xml/widget-docs";

describe("M3a 控件文档数据", () => {
  it("已知控件能取到文档（标题/说明/分类齐全）", () => {
    const d = getWidgetDoc("TextView");
    expect(d.title).toBe("文本");
    expect(d.summary.length).toBeGreaterThan(5);
    expect(d.category).toBe("文本");
  });

  it("全限定类名归一化（androidx.cardview.widget.CardView）", () => {
    expect(shortDocTag("androidx.cardview.widget.CardView")).toBe("CardView");
    expect(getWidgetDoc("androidx.cardview.widget.CardView").title).toBe("卡片");
  });

  it("别名归一（AppCompat* → 对应控件）", () => {
    expect(getWidgetDoc("AppCompatEditText").title).toBe("输入框");
    expect(getWidgetDoc("AppCompatButton").title).toBe("按钮");
  });

  it("未知控件返回兜底文档（不报错，带通用属性）", () => {
    const d = getWidgetDoc("SomeUnknownWidget");
    expect(d.title).toBe("SomeUnknownWidget");
    expect(docAttrs("SomeUnknownWidget")).toHaveLength(COMMON_ATTRS.length);
  });

  it("docAttrs = 专属 + 通用，不重名", () => {
    const all = docAttrs("TextView");
    const names = all.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("text");
    expect(names).toContain("layout_width");
    expect(names).toContain("id");
  });

  it("ConstraintLayout 专属约束属性齐全（8 个 *_to*Of）", () => {
    const d = getWidgetDoc("ConstraintLayout");
    const has = (n: string) => d.attrs.some((a) => a.name === n);
    expect(has("layout_constraintTop_toTopOf")).toBe(true);
    expect(has("layout_constraintTop_toBottomOf")).toBe(true);
    expect(has("layout_constraintBottom_toTopOf")).toBe(true);
    expect(has("layout_constraintBottom_toBottomOf")).toBe(true);
    expect(has("layout_constraintStart_toStartOf")).toBe(true);
    expect(has("layout_constraintStart_toEndOf")).toBe(true);
    expect(has("layout_constraintEnd_toStartOf")).toBe(true);
    expect(has("layout_constraintEnd_toEndOf")).toBe(true);
  });

  it("docForAttr：专属命中优先，通用兜底", () => {
    expect(docForAttr("LinearLayout", "orientation")?.desc).toContain("排列方向");
    expect(docForAttr("LinearLayout", "layout_weight")?.desc).toContain("权重");
    expect(docForAttr("LinearLayout", "visibility")?.desc).toContain("可见性");
  });

  it("attrHint：有值示例时带上，没有就只给说明", () => {
    expect(attrHint("TextView", "visibility")).toContain("visible / invisible / gone");
    expect(attrHint("TextView", "text")).toContain("显示文字");
  });

  it("docForAttr 查不到的属性返回 null", () => {
    expect(docForAttr("TextView", "no_such_attr")).toBeNull();
  });

  it("每条文档属性的 name/desc 非空（数据完整性）", () => {
    for (const w of ["LinearLayout", "ConstraintLayout", "TextView", "RecyclerView", "CardView"]) {
      for (const a of docAttrs(w)) {
        expect(a.name.length).toBeGreaterThan(0);
        expect(a.desc.length).toBeGreaterThan(3);
      }
    }
    for (const a of COMMON_ATTRS) expect(a.name.length).toBeGreaterThan(0);
  });
});
