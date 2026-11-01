// test/xml_m64e_ai_diff.test.ts — M64e（B3）：改动预览的行级 diff
import { describe, expect, it } from "vitest";
import { compactHunks, diffLines, diffSummary } from "@/lib/xml/ai-diff";

const A = `<LinearLayout>\n  <TextView />\n  <Button />\n</LinearLayout>`;
const B = `<LinearLayout>\n  <TextView android:text="Hi" />\n  <Button />\n</LinearLayout>`;

describe("M64e diffLines", () => {
  it("完全相同 → 全是上下文，统计为 0", () => {
    const d = diffLines(A, A);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.op === " ")).toBe(true);
    expect(diffSummary(d)).toBe("无变化");
  });

  it("改一行 → 一条 - 一条 +，其余上下文保留", () => {
    const d = diffLines(A, B);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines.filter((l) => l.op === "-")[0].text).toContain("<TextView />");
    expect(d.lines.filter((l) => l.op === "+")[0].text).toContain('android:text="Hi"');
    expect(diffSummary(d)).toBe("+1 -1");
  });

  it("新增多行", () => {
    const d = diffLines("<a>\n</a>", "<a>\n  <b/>\n  <c/>\n</a>");
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
  });

  it("CRLF 与 LF 视为同一份内容（换行归一）", () => {
    const d = diffLines("a\r\nb", "a\nb");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("空文件新建：整份都是 +", () => {
    const d = diffLines("", "x\ny");
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
  });

  it("超大文件降级为整段删+增并标 truncated（不 O(n²) 卡死）", () => {
    const big1 = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const big2 = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    const d = diffLines(big1, big2);
    expect(d.truncated).toBe(true);
    expect(d.added).toBe(3000);
    expect(d.removed).toBe(3000);
  });
});

describe("M64e compactHunks", () => {
  it("只保留改动附近上下文，中间省略行给出提示", () => {
    const lines = diffLines(
      Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n"),
      Array.from({ length: 20 }, (_, i) => (i === 10 ? "CHANGED" : `l${i}`)).join("\n"),
    ).lines;
    const c = compactHunks(lines, 1);
    expect(c.length).toBeLessThan(lines.length);
    expect(c.some((l) => l.text.includes("省略"))).toBe(true);
    expect(c.some((l) => l.text === "CHANGED")).toBe(true);
  });
});
