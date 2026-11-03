import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

/** 单个子控件放进父容器，返回父/子两级的 style */
function pair(parentTag: string, parentAttrs: string, childAttrs: string) {
  const xml = `<${parentTag} ${A} android:layout_width="match_parent" android:layout_height="match_parent" ${parentAttrs}>
      <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" ${childAttrs} />
    </${parentTag}>`;
  const root = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root;
  return { parent: root.style, child: root.children[0].style };
}

describe("M89f LinearLayout gravity / layout_gravity 按父容器取向映射", () => {
  it("竖排：子项 layout_gravity=center_horizontal → 交叉轴居中（align-self center）", () => {
    const r = pair("LinearLayout", `android:orientation="vertical"`, `android:layout_gravity="center_horizontal"`);
    expect(r.child.alignSelf).toBe("center");
  });

  it("竖排：子项 layout_gravity=center_vertical 不影响横向（Android 里主轴分量对子项无效）", () => {
    const r = pair("LinearLayout", `android:orientation="vertical"`, `android:layout_gravity="center_vertical"`);
    expect(r.child.alignSelf).not.toBe("center");
  });

  it("竖排：子项 layout_gravity=right / end → align-self flex-end", () => {
    expect(pair("LinearLayout", `android:orientation="vertical"`, `android:layout_gravity="right"`).child.alignSelf).toBe(
      "flex-end"
    );
    expect(pair("LinearLayout", `android:orientation="vertical"`, `android:layout_gravity="end"`).child.alignSelf).toBe(
      "flex-end"
    );
  });

  it("竖排：子项 layout_gravity=fill_horizontal → align-self stretch（子控件撑满宽度）", () => {
    const r = pair("LinearLayout", `android:orientation="vertical"`, `android:layout_gravity="fill_horizontal"`);
    expect(r.child.alignSelf).toBe("stretch");
  });

  it("横排：子项 layout_gravity=bottom → 交叉轴底部（align-self flex-end）", () => {
    const r = pair("LinearLayout", `android:orientation="horizontal"`, `android:layout_gravity="bottom"`);
    expect(r.child.alignSelf).toBe("flex-end");
  });

  it("横排：子项 layout_gravity=center_vertical → 纵向居中", () => {
    const r = pair("LinearLayout", `android:orientation="horizontal"`, `android:layout_gravity="center_vertical"`);
    expect(r.child.alignSelf).toBe("center");
  });

  it("横排：子项 layout_gravity=center_horizontal 不应把子控件竖直居中", () => {
    const r = pair("LinearLayout", `android:orientation="horizontal"`, `android:layout_gravity="center_horizontal"`);
    expect(r.child.alignSelf).not.toBe("center");
  });

  it("父容器 gravity=fill 两轴都撑满（align-items stretch）", () => {
    expect(pair("LinearLayout", `android:orientation="vertical" android:gravity="fill"`, "").parent.alignItems).toBe(
      "stretch"
    );
    expect(
      pair("LinearLayout", `android:orientation="horizontal" android:gravity="fill"`, "").parent.alignItems
    ).toBe("stretch");
  });

  it("gravity 里带空格/逗号也能解析（center_horizontal, bottom）", () => {
    const p = pair("LinearLayout", `android:orientation="vertical" android:gravity="center_horizontal, bottom"`, "").parent;
    expect(p.alignItems).toBe("center");
    expect(p.justifyContent).toBe("flex-end");
  });

  it("TableRow 子项按横排语义（bottom → align-self flex-end）", () => {
    const r = pair("TableRow", "", `android:layout_gravity="bottom"`);
    expect(r.child.alignSelf).toBe("flex-end");
  });

  it("ScrollView 的单个子项按竖排语义（layout_gravity=center_horizontal → center）", () => {
    const r = pair("ScrollView", "", `android:layout_gravity="center_horizontal"`);
    expect(r.child.alignSelf).toBe("center");
  });
});
