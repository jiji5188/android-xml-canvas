// M2y：行号 → 节点（代码 → 画布反跳的基础）
import { describe, expect, it } from "vitest";
import { parseLayoutXml, nodeAtLine } from "../lib/xml/parser";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

describe("M2y 行号定位节点", () => {
  const xml = [
    `<LinearLayout ${A}`,
    `  android:layout_width="match_parent" android:layout_height="match_parent">`,
    `  <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"`,
    `      android:text="a" />`,
    `  <Button android:layout_width="wrap_content" android:layout_height="wrap_content"`,
    `      android:text="b" />`,
    `</LinearLayout>`,
  ].join("\n");
  const root = parseLayoutXml(xml).root!;

  it("解析后每个节点都带 line（1 基）", () => {
    expect(root.line).toBe(1);
    expect(root.children[0].line).toBe(3);
    expect(root.children[1].line).toBe(5);
  });

  it("落在某行上 → 最深匹配的开标签节点", () => {
    expect(nodeAtLine(root, 3).path).toBe("#0/0");
    expect(nodeAtLine(root, 4).path).toBe("#0/0"); // 属性续行仍属于 TextView
    expect(nodeAtLine(root, 5).path).toBe("#0/1");
    expect(nodeAtLine(root, 6).path).toBe("#0/1");
  });

  it("落在根开标签行 → 根；超过最后一行 → 最后一个子项（光标在其闭合区内）", () => {
    expect(nodeAtLine(root, 1).path).toBe("#0");
    expect(nodeAtLine(root, 99).path).toBe("#0/1"); // 越尾落在 Button 的闭合标签区域
  });

  it("没有 line 信息（include 展开来的节点）不影响兄弟定位", () => {
    const r2 = parseLayoutXml(`<LinearLayout ${A}><TextView android:layout_width="10dp" android:layout_height="10dp" /></LinearLayout>`).root!;
    r2.children[0].line = undefined; // 模拟
    expect(nodeAtLine(r2, 1).path).toBe("#0"); // 子项没行号，命中根
  });
});
