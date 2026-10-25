// test/xml_writeback.test.ts — M1b 回写层单测：画布改属性 → 回写 XML 原文，round-trip 校验
import { describe, expect, it } from "vitest";
import { writebackAttrs, canvasToXmlAttrs, readNodeAttrs, validateXml } from "../lib/xml/writeback";

describe("M1b 回写引擎", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:padding="16dp">
  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/app_name"
      android:textSize="18sp"
      android:textColor="@color/text_primary"/>
  <View android:layout_width="match_parent" android:layout_height="1dp"/>
</LinearLayout>`;

  it("改 textSize：回写后 18sp→20sp，其余属性原样保留", () => {
    const r = writebackAttrs(xml, "#0/0", { textSize: "20sp" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:textSize="20sp"');
    expect(r.xml).toContain('android:id="@+id/tvTitle"'); // 兄弟属性没动
    expect(r.xml).toContain('android:layout_width="match_parent"');
    expect(validateXml(r.xml).ok).toBe(true);
  });

  it("改 text：文案 @string/app_name → 你好", () => {
    const r = writebackAttrs(xml, "#0/0", { text: "你好" });
    expect(r.xml).toContain('android:text="你好"');
  });

  it("无变化：传原值 → changed=false 且 xml 不变", () => {
    const r = writebackAttrs(xml, "#0/0", { textSize: "18sp" });
    expect(r.changed).toBe(false);
    expect(r.xml).toBe(xml);
  });

  it("删属性：移除 textColor", () => {
    const r = writebackAttrs(xml, "#0/0", {}, ["textColor"]);
    expect(r.changed).toBe(true);
    expect(r.xml).not.toContain("textColor");
    expect(r.xml).toContain('android:id="@+id/tvTitle"');
    expect(validateXml(r.xml).ok).toBe(true);
  });

  it("找不到 path：error issue + xml 原样", () => {
    const r = writebackAttrs(xml, "#0/5", { text: "x" });
    expect(r.changed).toBe(false);
    expect(r.issues.some((i) => i.level === "error")).toBe(true);
    expect(r.xml).toBe(xml);
  });

  it("画布值→XML 属性映射：fontSize 36px → textSize 18sp；marginRight 32px → layout_marginEnd 16dp", () => {
    const out = canvasToXmlAttrs(
      { fontSize: "36px", color: "#111111", marginRight: "32px", fontWeight: 600, text: "Hi" },
      "TextView",
      2,
    );
    expect(out["textSize"]).toBe("18sp");
    expect(out["textColor"]).toBe("#111111");
    expect(out["layout_marginEnd"]).toBe("16dp");
    expect(out["textStyle"]).toBe("bold");
    expect(out["text"]).toBe("Hi");
  });

  it("readNodeAttrs：读出节点当前属性", () => {
    const a = readNodeAttrs(xml, "#0/0");
    expect(a).not.toBeNull();
    const aa = a as Record<string, string>;
    expect(aa["textSize"]).toBe("18sp");
    expect(aa["id"]).toBe("@+id/tvTitle");
    expect(readNodeAttrs(xml, "#9/9")).toBeNull();
  });
});

