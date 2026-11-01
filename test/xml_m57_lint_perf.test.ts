// M57：lintXml 行号仍然准确 + 不再是 O(n²)（性能护栏）
import { describe, expect, it } from "vitest";
import { lintXml } from "@/lib/xml/lint";

function makeXml(n: number): string {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    rows.push(`  <TextView android:id="@+id/tv_${i}" android:layout_width="wrap_content" />`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout>\n${rows.join("\n")}\n</LinearLayout>`;
}

describe("M57 lintXml 行号 + 性能", () => {
  it("多余结束标签的行号准确（不是 1）", () => {
    const xml = `<LinearLayout>\n</LinearLayout>\n</FrameLayout>\n`;
    const issues = lintXml(xml);
    const e = issues.find((i) => i.message.includes("多余"));
    expect(e).toBeTruthy();
    expect(e!.line).toBe(3);
  });

  it("标签不匹配报出「第 N 行」的 N 正确", () => {
    const xml = `<LinearLayout>\n  <FrameLayout>\n  </LinearLayout>\n`;
    const issues = lintXml(xml);
    const e = issues.find((i) => i.message.includes("不匹配"));
    expect(e).toBeTruthy();
    // 开始标签 <FrameLayout> 在第 2 行
    expect(e!.message).toContain("第 2 行");
    expect(e!.line).toBe(3);
  });

  it("注释未闭合行号正确", () => {
    const xml = `<LinearLayout>\n  <!-- 没闭合\n</LinearLayout>\n`;
    const issues = lintXml(xml);
    const e = issues.find((i) => i.message.includes("注释未闭合"));
    expect(e).toBeTruthy();
    expect(e!.line).toBe(2);
  });

  it("行号跨 \r\n 也正确", () => {
    const xml = `<LinearLayout>\r\n</LinearLayout>\r\n</FrameLayout>\r\n`;
    const issues = lintXml(xml);
    const e = issues.find((i) => i.message.includes("多余"));
    expect(e).toBeTruthy();
    expect(e!.line).toBe(3);
  });

  it("大文件（800 控件）不再 O(n²)：单次 < 60ms", () => {
    const xml = makeXml(800);
    lintXml(xml); // warmup
    const t0 = performance.now();
    lintXml(xml);
    const ms = performance.now() - t0;
    // 旧实现约 170ms；新实现约 4ms。60ms 是很宽松的上限（CI 慢机器也不会误报）
    expect(ms).toBeLessThan(60);
  });

  it("合法文档返回 0 条 error", () => {
    const issues = lintXml(makeXml(5));
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });
});
