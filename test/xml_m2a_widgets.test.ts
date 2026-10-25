import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const model = (xml: string) =>
  buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES);

const findByTag = (n: any, tag: string): any => {
  if (n.tag === tag || n.tag?.endsWith("." + tag)) return n;
  for (const c of n.children ?? []) {
    const r = findByTag(c, tag);
    if (r) return r;
  }
  return null;
};

describe("M2a 复合控件占位渲染", () => {
  it("CardView 渲染为卡片容器（白底 + 圆角 + 阴影）", () => {
    const root = model(`<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent">
      <androidx.cardview.widget.CardView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        app:cardCornerRadius="8dp">
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="card" />
      </androidx.cardview.widget.CardView>
    </LinearLayout>`).root;
    const card = findByTag(root, "CardView");
    expect(card).not.toBeNull();
    expect(card.className).toBe("axv-card");
    expect(card.style.display).toBe("flex");
    expect(card.style.backgroundColor).toBe("#FFFFFF");
    expect(card.style.borderRadius).toBe("16px"); // 8dp @2x
  });

  it("RecyclerView 渲染为列表占位（有最小高度）", () => {
    const root = model(`<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent">
      <androidx.recyclerview.widget.RecyclerView
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />
    </LinearLayout>`).root;
    const rv = findByTag(root, "RecyclerView");
    expect(rv.className).toBe("axv-list");
    expect(rv.style.minHeight).toBe("320px"); // 160dp @2x
    expect(rv.style.flexGrow).toBe(1);
  });

  it("Switch checked=true 加 axv-checked 并用主色", () => {
    const root = model(`<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content">
      <Switch android:layout_width="wrap_content" android:layout_height="wrap_content" android:checked="true" />
    </LinearLayout>`).root;
    const sw = findByTag(root, "Switch");
    expect(sw.className).toBe("axv-switch axv-checked");
    expect(sw.style.backgroundColor).toBe("#6750A4");
    expect(sw.text).toBe(""); // 文字不画进开关里
  });

  it("未勾选 CheckBox 用白底灰边，勾选后主色", () => {
    const xml = (checked: string) => `<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content">
      <CheckBox android:layout_width="wrap_content" android:layout_height="wrap_content" android:checked="${checked}" />
    </LinearLayout>`;
    const off = findByTag(model(xml("false")).root, "CheckBox");
    const on = findByTag(model(xml("true")).root, "CheckBox");
    expect(off.className).toBe("axv-check");
    expect(off.style.backgroundColor).toBe("#FFFFFF");
    expect(on.className).toBe("axv-check axv-checked");
    expect(on.style.backgroundColor).toBe("#6750A4");
  });

  it("RadioButton 是圆形", () => {
    const root = model(`<RadioButton android:layout_width="wrap_content" android:layout_height="wrap_content" />`).root;
    expect(root.className).toBe("axv-radio");
    expect(root.style.borderRadius).toBe("50%");
  });

  it("SeekBar 按 progress/max 换算百分比", () => {
    const root = model(`<SeekBar android:layout_width="match_parent" android:layout_height="wrap_content" android:progress="30" android:max="100" />`).root;
    expect(root.className).toBe("axv-seek");
    expect(root.style["--axv-progress"]).toBe("0.3");
  });

  it("include 显示被引用布局名", () => {
    const root = model(`<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content">
      <include layout="@layout/item_card" />
    </LinearLayout>`).root;
    const inc = findByTag(root, "include");
    expect(inc.className).toBe("axv-include");
    expect(inc.text).toContain("@layout/item_card");
  });

  it("app 前缀属性不会被当成未知属性丢掉解析（CardView 仍是容器）", () => {
    const root = model(`<androidx.cardview.widget.CardView
        android:layout_width="200dp"
        android:layout_height="100dp"
        app:cardElevation="4dp" />`).root;
    expect(root.style.width).toBe("400px");
    expect(root.children).toHaveLength(0);
  });
});
