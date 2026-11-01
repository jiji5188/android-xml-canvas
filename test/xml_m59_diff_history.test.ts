import { describe, it, expect } from "vitest";
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

describe("diff 撤销栈", () => {
  it("前后缀剥离 + 双向应用", () => {
    const d = diffTo("abcdef", "abcXYZef");
    expect(d.common).toBe(3);
    expect(d.tailLen).toBe(2);
    expect(d.del).toBe("d");
    expect(d.ins).toBe("XYZ");
    expect(applyDiff("abcdef", d, true)).toBe("abcXYZef");
    expect(applyDiff("abcXYZef", d, false)).toBe("abcdef");
  });

  it("纯插入 / 纯删除 / 替换", () => {
    const ins = diffTo("ab", "abc");
    expect(applyDiff("ab", ins, true)).toBe("abc");
    expect(applyDiff("abc", ins, false)).toBe("ab");

    const del = diffTo("abc", "ab");
    expect(applyDiff("abc", del, true)).toBe("ab");
    expect(applyDiff("ab", del, false)).toBe("abc");

    const rep = diffTo("hello world", "hello there");
    expect(applyDiff("hello world", rep, true)).toBe("hello there");
    expect(applyDiff("hello there", rep, false)).toBe("hello world");
  });

  it("整段替换（前后缀全空）也正确", () => {
    const d = diffTo("aaa", "bbb");
    expect(d.common).toBe(0);
    expect(d.tailLen).toBe(0);
    expect(applyDiff("aaa", d, true)).toBe("bbb");
    expect(applyDiff("bbb", d, false)).toBe("aaa");
  });

  it("20 次小改动后占用远小于全量快照", () => {
    let h = diffHistoryInit(DOC);
    let cur = DOC;
    for (let i = 0; i < 20; i++) {
      const idx = 10 + i * 5;
      cur = cur.slice(0, idx) + "X" + cur.slice(idx + 1);
      h = diffHistoryCommit(h, cur);
    }
    expect(diffHistoryCurrent(h)).toBe(cur);
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

  it("撤销后再提交会清空重做链", () => {
    let h = diffHistoryInit("a");
    h = diffHistoryCommit(h, "ab");
    h = diffHistoryCommit(h, "abc");
    const u = diffHistoryUndo(h);
    expect(u.doc).toBe("ab");
    const h2 = diffHistoryCommit(u.next, "abZ");
    expect(h2.redo.length).toBe(0);
    expect(diffHistoryCurrent(h2)).toBe("abZ");
  });

  it("超步数时截断最旧段但当前值不变", () => {
    let h = diffHistoryInit("0");
    let cur = "0";
    for (let i = 1; i <= 60; i++) {
      cur = i + "x".repeat(i % 7);
      h = diffHistoryCommit(h, cur);
    }
    expect(h.undo.length).toBeLessThanOrEqual(DIFF_STEP_CAP);
    expect(diffHistoryCurrent(h)).toBe(cur);
    // 还能撤销，且撤销后是上一个真实状态
    const u = diffHistoryUndo(h);
    expect(u.doc).toBe(59 + "x".repeat(59 % 7));
  });
});
