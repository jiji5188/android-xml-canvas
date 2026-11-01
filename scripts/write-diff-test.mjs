import fs from "node:fs";
const p = "test/xml_m59_diff_history.test.ts";
fs.writeFileSync(
  p,
  `import { describe, it, expect } from "vitest";
import {
  diffHistoryInit,
  diffHistoryCommit,
  diffHistoryUndo,
  diffHistoryRedo,
  diffHistoryCurrent,
  diffHistoryBytes,
  diffTo,
  applyDiff,
  DIFF_STEP_CAP,
} from "@/lib/xml/history";

const DOC = "root layout with 300 controls ".repeat(30); // 大文档

describe("diff history", () => {
  it("diff 只存公共前后缀", () => {
    const d = diffTo("abcdef", "abcXYZef");
    expect(d.common).toBe(3);
    expect(d.oldTailLen).toBe(2); // ef
    expect(d.newTail).toBe("XYZ");
    expect(applyDiff("abcdef", d, true)).toBe("abcXYZef");
    expect(applyDiff("abcXYZef", d, false)).toBe("abcdef");
  });

  it("纯插入 / 纯删除", () => {
    expect(applyDiff("ab", diffTo("ab", "abc"), true)).toBe("abc");
    expect(applyDiff("abc", diffTo("ab", "abc"), false)).toBe("ab");
    expect(applyDiff("abc", diffTo("abc", "ab"), true)).toBe("ab");
  });

  it("20 次小改动后占用远小于全量快照", () => {
    let h = diffHistoryInit(DOC);
    for (let i = 0; i < 20; i++) {
      const next = DOC.slice(0, 10) + i + DOC.slice(11);
      h = diffHistoryCommit(h, next);
    }
    const full = DOC.length * 20;
    expect(diffHistoryBytes(h)).toBeLessThan(full / 10);
  });

  it("undo/redo 来回还原", () => {
    let h = diffHistoryInit("v0");
    h = diffHistoryCommit(h, "v1");
    h = diffHistoryCommit(h, "v2");
    expect(diffHistoryCurrent(h)).toBe("v2");
    let r = diffHistoryUndo(h);
    expect(r.doc).toBe("v1");
    r = diffHistoryUndo(r.next);
    expect(r.doc).toBe("v0");
    r = diffHistoryRedo(r.next);
    expect(r.doc).toBe("v1");
    r = diffHistoryRedo(r.next);
    expect(r.doc).toBe("v2");
  });

  it("超步数时截断最旧段但当前值不变", () => {
    let h = diffHistoryInit("0");
    for (let i = 1; i <= 60; i++) h = diffHistoryCommit(h, i + "x".repeat(i % 7));
    expect(h.undo.length).toBeLessThanOrEqual(DIFF_STEP_CAP);
    // 当前文档仍是最后一次的
    expect(diffHistoryCurrent(h)).toBe("60" + "x".repeat(60 % 7));
  });
});
`,
  "utf8",
);
console.log("test written");
