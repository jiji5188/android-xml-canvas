// test/xml_m4m_geometry_no_reorder.test.ts — 画布拖动只改几何，不能动层级
// 用户要求：「预览框内拖动不要影响层级，因为预览框拖动已经有调整 xy 位置事件了」
// 画布拖动走 onGeometryChange → 只写 layout_marginStart/marginTop/layout_width/height，
// 兄弟顺序（= 渲染层级）必须原封不动。
import { describe, it, expect } from "vitest";
import { writebackAttrs } from "../lib/xml/writeback";
import { parseLayoutXml } from "../lib/xml/parser";

const XML = `<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <TextView
      android:id="@+id/a"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />

  <Button
      android:id="@+id/b"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />

  <ImageView
      android:id="@+id/c"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />

</FrameLayout>`;

function ids(xml: string): string[] {
  const { root } = parseLayoutXml(xml);
  if (!root) return [];
  return root.children.map((c) => c.attrs["id"] ?? c.tag);
}

describe("M4m 画布拖动不改层级", () => {
  it("拖中间那个控件：兄弟顺序不变", () => {
    const r = writebackAttrs(XML, "#0/1", { layout_marginStart: "24dp", layout_marginTop: "48dp" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:layout_marginStart="24dp"');
    expect(r.xml).toContain('android:layout_marginTop="48dp"');
    expect(ids(r.xml)).toEqual(["@+id/a", "@+id/b", "@+id/c"]);
    // 文本层面也不该发生位移：除了插入的两行属性，其它行原样
    const before = XML.split("\n");
    const after = r.xml.split("\n");
    expect(after.length).toBe(before.length + 2);
  });

  it("拉伸改宽高：顺序不变、别的控件属性不变", () => {
    const r = writebackAttrs(XML, "#0/0", { layout_width: "160dp", layout_height: "80dp" });
    expect(ids(r.xml)).toEqual(["@+id/a", "@+id/b", "@+id/c"]);
    expect(r.xml).toContain('android:layout_width="160dp"');
    // 未被选中的控件保持原样
    expect((r.xml.match(/android:layout_width="wrap_content"/g) || []).length).toBe(2);
  });

  it("连续拖动多次（模拟 pointermove 写回）顺序始终不变", () => {
    let xml = XML;
    for (let i = 1; i <= 8; i++) {
      const r = writebackAttrs(xml, "#0/2", { layout_marginStart: `${i * 4}dp` });
      xml = r.xml;
      expect(ids(xml)).toEqual(["@+id/a", "@+id/b", "@+id/c"]);
    }
    expect(xml).toContain('android:layout_marginStart="32dp"');
  });
});
