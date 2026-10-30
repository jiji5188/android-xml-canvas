// test/xml_m26_line_sync.test.ts — 选中节点 ↔ 代码行号联动
// // @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "@/lib/xml/parser";
import { lineOfPath, pathAtLine, spanOfPath, shouldResync } from "@/lib/xml/line-sync";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="wrap_content"
    android:orientation="vertical">
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello" />
    <Button android:id="@+id/btn" android:layout_width="wrap_content" android:layout_height="wrap_content" />
</LinearLayout>`;

const root = parseLayoutXml(xml, true).root!;

describe("lineOfPath", () => {
  it("根节点 → 第 2 行（标签名所在行）", () => {
    expect(lineOfPath(root, "#0")).toBe(2);
  });
  it("TextView 的开标签行", () => {
    expect(lineOfPath(root, "#0/0")).toBe(5);
  });
  it("找不到的路径返回 null", () => {
    expect(lineOfPath(root, "#0/9")).toBeNull();
    expect(lineOfPath(null, "#0")).toBeNull();
  });
});

describe("pathAtLine", () => {
  it("点击某行 → 该行所属最深的节点", () => {
    // 第 6~9 行是 TextView 的属性行 → 仍属于 #0/0
    expect(pathAtLine(root, 8)).toBe("#0/0");
    // 第 10 行是 Button → #0/1
    expect(pathAtLine(root, 10)).toBe("#0/1");
  });
  it("非法输入返回 null", () => {
    expect(pathAtLine(root, 0)).toBeNull();
    expect(pathAtLine(null, 5)).toBeNull();
  });
});

describe("spanOfPath", () => {
  it("覆盖子树所有行", () => {
    const span = spanOfPath(root, "#0/0");
    expect(span?.from).toBe(5);
    // 自闭合控件没有子节点 → 范围就是自身那一行
    expect(span?.to).toBe(5);
  });
});

describe("shouldResync", () => {
  it("同一节点+行不重复滚动，选中变化才滚动", () => {
    expect(shouldResync("", "#0/1", 10)).toBe(true);
    expect(shouldResync("#0/1@10", "#0/1", 10)).toBe(false);
    expect(shouldResync("#0/1@10", "#0/0", 5)).toBe(true);
  });
});
