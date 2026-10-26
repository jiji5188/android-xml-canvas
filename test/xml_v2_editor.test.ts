// test/xml_v2_editor.test.ts — M1c v2 编辑器单元验证
// 验证：parser 的 xmlns 跳过、attr-catalog 的 editorFor/defaultFor、
// 以及 writeback 添加/删除属性不破坏 xmlns 声明。

import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { writebackAttrs } from "../lib/xml/writeback";
import { editorFor, defaultFor, ATTR_CATALOG } from "../components/attr-catalog";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:id="@+id/tv1"
      android:text="hi"
      android:textSize="14sp"/>
</LinearLayout>`;

describe("parser：xmlns 声明不进 attrs", () => {
  it("xmlns:android / xmlns:app 不出现在 attrs 里", () => {
    const { root } = parseLayoutXml(XML);
    expect(root).not.toBeNull();
    const a = root!.attrs;
    expect(Object.keys(a)).not.toContain("android");
    expect(Object.keys(a)).not.toContain("app");
    // 正常属性还在
    expect(a["layout_width"]).toBe("match_parent");
    expect(a["layout_height"]).toBe("match_parent");
    // 子节点的 id 也正常（android: 前缀被归一化丢掉了）
    expect(root!.children[0].attrs["id"]).toBe("@+id/tv1");
    // nsDecls 存住了原本的声明
    expect(root!.nsDecls?.android).toContain("schemas.android.com/apk/res/android");
    expect(root!.nsDecls?.app).toContain("res-auto");
  });
});

describe("writeback：属性增删不破坏 xmlns 声明", () => {
  it("添加 gravity 后 xmlns 声明保持原样、不产生 android:android", () => {
    const r = writebackAttrs(XML, "#0/0", { gravity: "center" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:gravity="center"');
    expect(r.xml).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
    expect(r.xml).not.toContain("android:android");
  });

  it("删除 textSize 后其他属性保留", () => {
    const r = writebackAttrs(XML, "#0/0", {}, ["textSize"]);
    expect(r.changed).toBe(true);
    expect(r.xml).not.toContain("textSize");
    expect(r.xml).toContain('android:text="hi"');
    expect(r.xml).toContain('xmlns:android');
  });
});

describe("attr-catalog", () => {
  it("目录项都有组名与 editor", () => {
    for (const s of ATTR_CATALOG) {
      expect(s.group).toBeTruthy();
      expect(s.editor).toBeTruthy();
    }
  });

  it("editorFor：已知属性走目录，未知属性启发式", () => {
    expect(editorFor("orientation").editor).toBe("enum");
    expect(editorFor("orientation").options).toEqual(["horizontal", "vertical"]);
    expect(editorFor("layout_width", "match_parent").editor).toBe("size_input");
    // 未知属性 + 颜色值 → color
    expect(editorFor("androidX", "#FF0000").editor).toBe("color");
    // 未知属性默认 → string
    expect(editorFor("mysteryAttr", "foo").editor).toBe("string");
  });

  it("当前值不在预设里时补一个选项", () => {
    const { options } = editorFor("orientation", "diagonal");
    expect(options).toContain("diagonal");
  });

  it("defaultFor：已知给默认值，未知给空串", () => {
    expect(defaultFor("layout_width")).toBe("wrap_content");
    expect(defaultFor("id")).toBe("@+id/");
    expect(defaultFor("notInCatalog")).toBe("");
  });
});
