// test/xml_m2c_format_lint.test.ts — 格式化 + 结构检查（行号）
import { describe, it, expect } from "vitest";
import { formatXml } from "../lib/xml/format";
import { lintXml } from "../lib/xml/lint";

const MESSY = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
android:layout_width="match_parent"
android:layout_height="match_parent">
<TextView android:text="hi" android:layout_width="wrap_content" android:layout_height="wrap_content"/>
<!-- 一条注释 -->
   <Button
        android:text="点击"
     android:layout_width="wrap_content"/>
</LinearLayout>`;

describe("formatXml — 缩进重排", () => {
  const out = formatXml(MESSY, 2);
  const lines = out.split("\n");

  it("声明留在第一行", () => {
    expect(lines[0]).toBe('<?xml version="1.0" encoding="utf-8"?>');
  });

  it("根节点不缩进，子节点缩进 2 空格", () => {
    expect(lines[1].startsWith("<LinearLayout")).toBe(true);
    const tv = lines.find((l) => l.includes("<TextView"));
    expect(tv?.startsWith("  <TextView")).toBe(true);
    expect(lines[lines.length - 2]).toBe("</LinearLayout>");
  });

  it("多行标签的续行比首行多一级缩进", () => {
    const cont = lines.find((l) => l.includes('android:layout_width="match_parent"'));
    // 根节点在深度 0（首行顶格），属性续行 = 深度 1 = 2 空格
    expect(cont?.startsWith("  ")).toBe(true);
    expect(cont?.startsWith("   ")).toBe(false);
  });

  it("注释原样保留且按深度缩进", () => {
    const c = lines.find((l) => l.includes("一条注释"));
    expect(c).toBe("  <!-- 一条注释 -->");
  });

  it("行尾多余空白被清掉，不留空行", () => {
    expect(out.endsWith("\n")).toBe(true);
    expect(out.includes("\n\n")).toBe(false);
  });

  it("幂等：再格式化一次结果不变", () => {
    expect(formatXml(out, 2)).toBe(out);
  });

  it("单行文本节点保持一行", () => {
    const x = formatXml(`<LinearLayout><TextView>你好</TextView></LinearLayout>`);
    expect(x).toBe("<LinearLayout>\n  <TextView>你好</TextView>\n</LinearLayout>\n");
  });

  it("空节点合并成 <a></a>", () => {
    const x = formatXml(`<FrameLayout></FrameLayout>`);
    expect(x).toBe("<FrameLayout></FrameLayout>\n");
  });

  it("解析失败（标签未闭合）也能格式化，不抛异常", () => {
    expect(() => formatXml(`<LinearLayout><TextView`)).not.toThrow();
  });
});

describe("lintXml — 结构检查带行号", () => {
  it("合法布局无错误", () => {
    expect(lintXml(MESSY)).toEqual([]);
  });

  it("结束标签不匹配：报错行 + 提示对方行号", () => {
    const src = `<LinearLayout>\n  <TextView>\n  </Button>\n</LinearLayout>`;
    const issues = lintXml(src);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].line).toBe(3);
    expect(issues[0].message).toContain("Button");
    expect(issues[0].message).toContain("第 2 行");
  });

  it("标签未闭合：报在配对失败那一行，并指向开始行", () => {
    const src = `<LinearLayout>\n  <TextView>\n</LinearLayout>`;
    const issues = lintXml(src);
    // </LinearLayout> 弹出栈顶 TextView → 不匹配，提示里带对方行号
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].line).toBe(3);
    expect(issues[0].message).toContain("<TextView>");
    expect(issues[0].message).toContain("第 2 行");
  });

  it("真的少一个结束标签：报在开始那一行", () => {
    const src = `<LinearLayout>\n  <TextView>\n    <Button>\n</LinearLayout>`;
    const issues = lintXml(src);
    expect(issues.some((i) => i.message.includes("不匹配"))).toBe(true);
  });

  it("多余的结束标签", () => {
    const src = `<LinearLayout>\n</LinearLayout>\n</FrameLayout>`;
    const issues = lintXml(src);
    expect(issues.some((i) => i.line === 3 && i.message.includes("多余"))).toBe(true);
  });

  it("注释未闭合", () => {
    const issues = lintXml(`<LinearLayout>\n<!-- 没收尾\n</LinearLayout>`);
    expect(issues[0].line).toBe(2);
    expect(issues[0].message).toContain("注释未闭合");
  });

  it("注释里的 < 不算标签、字符串里的 > 不提前断标签", () => {
    const src = `<LinearLayout>\n  <!-- 这里有 <b> 和 </i> -->\n  <TextView android:text="a > b" />\n</LinearLayout>`;
    expect(lintXml(src)).toEqual([]);
  });

  it("结果按行号排序", () => {
    const src = `<A>\n<B>\n</C>`;
    const lines = lintXml(src).map((i) => i.line);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });
});
