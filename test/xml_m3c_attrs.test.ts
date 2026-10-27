// M3c：属性改写必须保留原文（注释/缩进/属性顺序）
import { describe, expect, it } from "vitest";
import { setNodeAttrs } from "../lib/xml/attrs";
import { writebackAttrs } from "../lib/xml/writeback";
import { parseLayoutXml, findNode } from "../lib/xml/parser";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <!-- 顶部标题：不要删这个注释 -->
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标题"
        android:textSize="16sp" />

    <!-- 底部按钮 -->
    <Button
        android:id="@+id/ok"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="确定" />
</LinearLayout>
`;

const attrsOf = (xml: string, path: string) => {
  const { root } = parseLayoutXml(xml);
  return root ? findNode(root, path)?.attrs : undefined;
};

describe("M3c setNodeAttrs 文本级改写", () => {
  it("改已有属性只动那个值", () => {
    const r = setNodeAttrs(XML, "#0/0", { textSize: "18sp" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:textSize="18sp"');
    expect(r.xml).not.toContain('android:textSize="16sp"');
  });

  it("注释原位置保留（不搬到文件末尾）", () => {
    const r = setNodeAttrs(XML, "#0/0", { textSize: "18sp" });
    expect(r.xml).toContain("<!-- 顶部标题：不要删这个注释 -->");
    expect(r.xml).toContain("<!-- 底部按钮 -->");
    // 注释仍在各自控件之前，而不是堆在 </LinearLayout> 之后
    const c1 = r.xml.indexOf("顶部标题");
    const t = r.xml.indexOf('android:id="@+id/title"');
    expect(c1).toBeLessThan(t);
    expect(r.xml.trimEnd().endsWith("</LinearLayout>")).toBe(true);
    expect((r.xml.match(/<!--/g) || []).length).toBe(2);
  });

  it("XML 声明与根标签原文不动", () => {
    const r = setNodeAttrs(XML, "#0/1", { textColor: "#FF0000" });
    expect(r.xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(r.xml).toContain(`<LinearLayout ${A}`);
    expect(r.xml).toContain('android:orientation="vertical"');
  });

  it("新增属性插在开标签内，缩进跟随已有属性", () => {
    const r = setNodeAttrs(XML, "#0/1", { textColor: "#FF0000" });
    expect(r.xml).toMatch(/\n {8}android:textColor="#FF0000"/);
    // 新增后仍在自闭合标签内部
    const seg = r.xml.slice(r.xml.indexOf('android:id="@+id/ok"'), r.xml.indexOf("/>", r.xml.indexOf('@+id/ok"')));
    expect(seg).toContain('android:textColor="#FF0000"');
  });

  it("app: 属性自动补前缀与 xmlns:app", () => {
    const r = setNodeAttrs(XML, "#0/0", { layout_constraintTop_toTopOf: "parent" });
    expect(r.xml).toContain('app:layout_constraintTop_toTopOf="parent"');
    expect(r.xml).toContain('xmlns:app="http://schemas.android.com/apk/res-auto"');
  });

  it("删除属性连带删掉整行", () => {
    const r = setNodeAttrs(XML, "#0/0", {}, ["textSize"]);
    expect(r.xml).not.toContain("textSize");
    // 不留下空行残骸：text 行下面直接是 "/>"
    expect(r.xml).toMatch(/android:text="标题"\s*\/>/);
  });

  it("值没变时报告 changed=false 且原文不动", () => {
    const r = setNodeAttrs(XML, "#0/0", { textSize: "16sp" });
    expect(r.changed).toBe(false);
    expect(r.xml).toBe(XML);
  });

  it("路径不存在时原样返回", () => {
    const r = setNodeAttrs(XML, "#0/9", { text: "x" });
    expect(r.xml).toBe(XML);
    expect(r.changed).toBe(false);
  });

  it("writebackAttrs 走新实现（改属性后注释仍在原处）", () => {
    const r = writebackAttrs(XML, "#0/0", { text: "新标题" });
    expect(r.changed).toBe(true);
    expect(r.xml).toContain('android:text="新标题"');
    expect(r.xml).toContain("<!-- 顶部标题：不要删这个注释 -->");
    expect((r.xml.match(/<!--/g) || []).length).toBe(2);
    expect(r.xml.trimEnd().endsWith("</LinearLayout>")).toBe(true);
  });

  it("改完仍可解析且属性值正确", () => {
    const r = setNodeAttrs(XML, "#0/0", { textSize: "20sp", text: "改过了" });
    const { root, issues } = parseLayoutXml(r.xml);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    const node = findNode(root!, "#0/0");
    expect(node!.attrs.textSize).toBe("20sp");
    expect(node!.attrs.text).toBe("改过了");
    expect(node!.attrs.id).toBe("@+id/title");
  });

  it("属性值里有尖括号/单引号也不会写坏", () => {
    const r = setNodeAttrs(XML, "#0/0", { text: 'a > b & "c"' });
    const { root } = parseLayoutXml(r.xml);
    const node = findNode(root!, "#0/0");
    expect(node!.attrs.text).toBe('a > b & "c"');
  });
});
