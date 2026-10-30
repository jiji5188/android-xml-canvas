// test/xml_m29_layer_filter.test.ts — 图层树搜索过滤（M29）
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "@/lib/xml/parser";
import { filterLayerTree, layerMatches, layerLabel } from "@/lib/xml/layer-filter";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:id="@+id/title" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Hello" />
  <FrameLayout android:id="@+id/box" android:layout_width="match_parent" android:layout_height="wrap_content">
    <ImageView android:id="@+id/img" android:layout_width="48dp" android:layout_height="48dp" />
  </FrameLayout>
</LinearLayout>`;
const root = parseLayoutXml(xml, true).root!;

describe("layerLabel", () => {
  it("文本优先（短文本带引号），其次 id，最后 tag", () => {
    expect(layerLabel(root)).toBe("LinearLayout");
    expect(layerLabel(root.children[0]!)).toBe('"Hello"');
    expect(layerLabel(root.children[1]!.children[0]!)).toBe("img");
  });
});

describe("layerMatches", () => {
  it("空关键字全部命中", () => {
    expect(layerMatches(root, "")).toBe(true);
  });
  it("按 tag / id / text 模糊命中", () => {
    const img = root.children[1]!.children[0]!;
    expect(layerMatches(img, "IMG")).toBe(true); // tag
    expect(layerMatches(img, "img")).toBe(true); // id
    expect(layerMatches(root.children[0]!, "hello")).toBe(true); // text
    expect(layerMatches(img, "nobody")).toBe(false);
  });
});

describe("filterLayerTree", () => {
  it("不过滤时全保留", () => {
    const r = filterLayerTree(root, "");
    expect(r.active).toBe(false);
    expect(r.keep.size).toBe(4);
  });

  it("命中叶子：保留它 + 全部祖先", () => {
    const r = filterLayerTree(root, "img");
    expect(r.active).toBe(true);
    expect([...r.hits]).toEqual(["#0/1/0"]);
    for (const p of ["#0", "#0/1", "#0/1/0"]) expect(r.keep.has(p)).toBe(true);
    expect(r.keep.has("#0/0")).toBe(false); // 未命中的兄弟隐藏
  });

  it("命中容器：保留整棵子树", () => {
    const r = filterLayerTree(root, "box");
    expect(r.hits.has("#0/1")).toBe(true);
    expect(r.keep.has("#0/1/0")).toBe(true);
  });

  it("搜不到 → keep 为空", () => {
    const r = filterLayerTree(root, "nobody-here");
    expect(r.keep.size).toBe(0);
  });
});
