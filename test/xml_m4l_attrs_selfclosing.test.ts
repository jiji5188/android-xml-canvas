// test/xml_m4l_attrs_selfclosing.test.ts — 自闭合标签改属性不能破坏文档结构
// 事故：setNodeAttrs 在插入新属性后，多推了一条「删掉 contentEnd..openEnd-1」的编辑，
// 实际效果是把 `/>` 的斜杠删掉 → 控件变成没闭合的 <EditText ... >，整篇 XML 非法。
// 之后图层树/拖拽在错位的节点区间上切片，出现节点重复、拖拽失灵（用户报的就是这个）。
// 另一个同类问题：一次加两个 app: 属性时，xmlns:app 会被写两遍。
import { describe, it, expect } from "vitest";
import { setNodeAttrs } from "../lib/xml/attrs";
import { moveNodeRaw, scanElements } from "../lib/xml/reorder";

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <EditText
      android:id="@+id/view_1"
      android:layout_width="match_parent"
      android:layout_height="wrap_content" />

  <Button
      android:id="@+id/btn"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />

</LinearLayout>`;

/** 结构自检：根节点必须覆盖到文末，且标签开闭数量配平 */
function structureErrors(xml: string): string[] {
  const out: string[] = [];
  const root = scanElements(xml);
  if (!root) return ["无根节点"];
  if (xml.slice(root.end).trim()) out.push("根节点之后还有内容");
  const opens = (xml.match(/<EditText\b/g) || []).length;
  const closes = (xml.match(/<\/EditText>/g) || []).length;
  const selfClosed = (xml.match(/<EditText\b[^>]*\/>/g) || []).length;
  if (opens !== closes + selfClosed) out.push(`EditText 标签不配平 open=${opens} close=${closes} self=${selfClosed}`);
  return out;
}

describe("M4l 自闭合标签写属性", () => {
  it("加 android: 属性后仍是自闭合，文档结构不变", () => {
    const r = setNodeAttrs(LAYOUT, "#0/0", { "android:hint": "请输入" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:hint="请输入"');
    expect(r.xml).toContain('android:layout_height="wrap_content" />');
    expect(structureErrors(r.xml)).toEqual([]);
    // 原有属性不能被吃掉
    expect(r.xml).toContain('android:id="@+id/view_1"');
    expect(r.xml).toContain('android:layout_width="match_parent"');
  });

  it("一次加两个 app: 属性，xmlns:app 只能声明一次", () => {
    const r = setNodeAttrs(LAYOUT, "#0/0", {
      "app:layout_constraintTop_toTopOf": "parent",
      "app:layout_constraintStart_toStartOf": "parent",
    });
    const nsCount = (r.xml.match(/xmlns:app=/g) || []).length;
    expect(nsCount).toBe(1);
    expect(r.xml).toContain('app:layout_constraintTop_toTopOf="parent"');
    expect(r.xml).toContain('app:layout_constraintStart_toStartOf="parent"');
    expect(structureErrors(r.xml)).toEqual([]);
  });

  it("已有 xmlns:app 时不重复声明", () => {
    const xml = LAYOUT.replace(
      'xmlns:android="http://schemas.android.com/apk/res/android"',
      'xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:app="http://schemas.android.com/apk/res-auto"',
    );
    const r = setNodeAttrs(xml, "#0/1", { "app:layout_constraintEnd_toEndOf": "parent" });
    expect((r.xml.match(/xmlns:app=/g) || []).length).toBe(1);
    expect(structureErrors(r.xml)).toEqual([]);
  });

  it("删属性后仍是自闭合", () => {
    const withAttr = setNodeAttrs(LAYOUT, "#0/0", { "android:hint": "请输入" }).xml;
    const r = setNodeAttrs(withAttr, "#0/0", {}, ["hint"]);
    expect(r.xml).not.toContain("android:hint");
    expect(structureErrors(r.xml)).toEqual([]);
  });

  it("改完属性后还能正常拖拽换层级（不会重复/丢节点）", () => {
    // 真实事故链路：先给自闭合控件加属性（这一步把 XML 写坏），再拖拽 → 节点重复
    let xml = setNodeAttrs(LAYOUT, "#0/0", { "android:hint": "请输入" }).xml;
    xml = setNodeAttrs(xml, "#0/1", { "app:layout_constraintTop_toTopOf": "parent" }).xml;
    expect(structureErrors(xml)).toEqual([]);

    const moved = moveNodeRaw(xml, "#0/1", { parentPath: "#0", index: 0 });
    expect(moved.ok).toBe(true);
    expect(structureErrors(moved.xml)).toEqual([]);
    expect((moved.xml.match(/android:id="@\+id\/btn"/g) || []).length).toBe(1);
    expect((moved.xml.match(/android:id="@\+id\/view_1"/g) || []).length).toBe(1);
    // Button 现在排在 EditText 前面
    expect(moved.xml.indexOf('@+id/btn')).toBeLessThan(moved.xml.indexOf('@+id/view_1'));
  });
});
