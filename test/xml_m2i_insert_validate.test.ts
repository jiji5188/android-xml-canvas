// test/xml_m2i_insert_validate.test.ts — M2i：插入组件前校验父容器能否接收子控件
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { insertChild, insertAt, insertSiblingAfter, canAcceptChild } from "../lib/xml/insert";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const W = `<View ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>`;

function rootOf(xml: string) {
  const { root } = parseLayoutXml(xml);
  if (!root) throw new Error("parse fail");
  return root;
}

describe("canAcceptChild 判定", () => {
  it("非容器标签（TextView/Button）→ 拒绝", () => {
    expect(canAcceptChild("TextView", 0).ok).toBe(false);
    expect(canAcceptChild("Button", 0).ok).toBe(false);
    expect(canAcceptChild("EditText", 0).ok).toBe(false);
  });

  it("多 child 容器（LinearLayout/FrameLayout/CL）→ 总是允许", () => {
    expect(canAcceptChild("LinearLayout", 0).ok).toBe(true);
    expect(canAcceptChild("LinearLayout", 5).ok).toBe(true);
    expect(canAcceptChild("FrameLayout", 3).ok).toBe(true);
    expect(canAcceptChild("ConstraintLayout", 10).ok).toBe(true);
  });

  it("单 child 容器（ScrollView）→ 0 个子允许，≥1 拒绝", () => {
    expect(canAcceptChild("ScrollView", 0).ok).toBe(true);
    expect(canAcceptChild("ScrollView", 1).ok).toBe(false);
    expect(canAcceptChild("HorizontalScrollView", 1).ok).toBe(false);
    expect(canAcceptChild("NestedScrollView", 1).ok).toBe(false);
  });

  it("全限定名归一化（androidx.* / 包名.标签）", () => {
    expect(canAcceptChild("androidx.core.widget.NestedScrollView", 0).ok).toBe(true);
    expect(canAcceptChild("androidx.core.widget.NestedScrollView", 1).ok).toBe(false);
  });
});

describe("insertChild 校验", () => {
  it("往 ScrollView（已有 1 子）里 insertChild → 拒绝 + 报错信息", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
</ScrollView>`;
    const root = rootOf(xml);
    const scrollPath = "#0"; // 根就是 ScrollView
    const r = insertChild(xml, scrollPath, W, "View");
    expect(r.ok).toBe(false);
    expect(r.issues[0].level).toBe("error");
    expect(r.issues[0].message).toContain("只支持 1 个子控件");
  });

  it("往 TextView（叶子）下 insertChild → 拒绝", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="hi"/>`;
    const root = rootOf(xml);
    const r = insertChild(xml, "#0", W, "View");
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("TextView 不支持子控件");
  });

  it("往空 ScrollView insertChild → 允许", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
</ScrollView>`;
    const r = insertChild(xml, "#0", W, "View");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/0");
  });

  it("往 LinearLayout 已有 3 子 insertChild → 允许（多 child 容器）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <View ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <View ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <View ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
</LinearLayout>`;
    const r = insertChild(xml, "#0", W, "View");
    expect(r.ok).toBe(true);
  });
});

describe("insertAt（拖放）校验", () => {
  it("拖放到已满 ScrollView → 拒绝 + 报错", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <ScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
    <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  </ScrollView>
</FrameLayout>`;
    const root = rootOf(xml);
    const scrollPath = "#0/0";
    const r = insertAt(xml, scrollPath, 1, W, "View");
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("只支持 1 个子控件");
  });

  it("拖放到空 FrameLayout → 允许", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"/>
</FrameLayout>`;
    const r = insertAt(xml, "#0/0", 0, W, "View");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/0/0");
  });
});

describe("insertSiblingAfter 不受父容器限制影响（兄弟位置永远可插）", () => {
  it("往 ScrollView 的兄弟位置插（parent 是 FrameLayout）→ 允许", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <ScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
    <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  </ScrollView>
</FrameLayout>`;
    const r = insertSiblingAfter(xml, "#0/0", W, "View");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/1");
  });
});
