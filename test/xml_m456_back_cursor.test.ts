import { describe, it, expect, vi } from "vitest";
import { installBackBridge, resetBackStack, handleBack, registerBack, backStackLabels } from "@/lib/ui/back-stack";

function withStack(fn: () => void) {
  installBackBridge();
  fn();
  resetBackStack();
  vi.restoreAllMocks();
}

describe("M456 返回键最底层（exit-editor guard）行为矩阵", () => {
  it("旧行为回归：栈空 → handleBack 返回 false（原生 finish）", () => {
    withStack(() => {
      expect(handleBack()).toBe(false);
    });
  });

  it("入口页：exit-editor guard 消费返回键并交给 leaveGuard.gate（弹未保存提示）", () => {
    const gate = vi.fn();
    withStack(() => {
      const c1 = registerBack(() => gate(), "exit-editor");
      expect(backStackLabels()).toEqual(["exit-editor"]);
      expect(handleBack()).toBe(true);
      expect(gate).toHaveBeenCalledTimes(1);
      // 提示弹着时栈已空 → 再按返回 = false（原生 finish，用户取消后可选）
      expect(handleBack()).toBe(false);
      c1();
    });
  });

  it("浮层优先级：exit-editor 先注册，左栅面板后注册 → 返回键先关面板", () => {
    let leftClosed = 0;
    const gate = vi.fn();
    withStack(() => {
      // 与 XmlEditor 真实注册顺序一致：exit-editor 在最底
      const c1 = registerBack(() => gate(), "exit-editor");
      const c2 = registerBack(() => leftClosed++, "left-panel");
      expect(handleBack()).toBe(true);
      expect(leftClosed).toBe(1); // 先关面板
      expect(gate).not.toHaveBeenCalled();
      expect(handleBack()).toBe(true);
      expect(gate).toHaveBeenCalledTimes(1); // 再按才到最底层
      c1();
      c2();
    });
  });
});

/** 与 CodeEditor M456 完全同构的光标夹取：行号夹到新文档行数，列号夹到该行长度 */
function clampCursor(oldDoc: string, oldHead: number, value: string): number {
  const oldLines = oldDoc.split("\n");
  let before = 0;
  let lnNum = 1;
  for (let i = 0; i < oldLines.length; i++) {
    const end = before + oldLines[i].length;
    if (oldHead <= end || i === oldLines.length - 1) {
      lnNum = i + 1;
      break;
    }
    before = end + 1;
  }
  const col = oldHead - before;
  const newLines = value.split("\n");
  const clampedLine = Math.min(lnNum, newLines.length);
  return (
    newLines.slice(0, Math.max(0, clampedLine - 1)).reduce((n, l) => n + l.length + 1, 0) +
    Math.min(col, newLines[clampedLine - 1]?.length ?? 0)
  );
}

describe("M456 光标保留（CodeEditor value 回灌）", () => {
  it("行数减少：光标夹到新文档末尾（不是位置 0）", () => {
    const old = "a\nbb\nccc\nddd\neeee\nffff";
    const next = "a\nbb\nccc\nddd";
    expect(clampCursor(old, old.length, next)).toBe(next.length);
    expect(clampCursor(old, old.length, next)).not.toBe(0);
  });

  it("行数不变：列号原样保留", () => {
    const old2 = "hello world line\nsecond";
    const next2 = "hello world\nsecond";
    const head2 = "hello world line\ns".length; // L2 C1
    expect(clampCursor(old2, head2, next2)).toBe("hello world\n".length + 1);
  });

  it("行数增多：原位置不动", () => {
    const old3 = "x\ny";
    const next3 = "x\ny\nz\nw";
    expect(clampCursor(old3, 1, next3)).toBe(1); // L1 C1
  });

  it("列号超长（行被缩短）：夹到该行行尾", () => {
    const old4 = "short\nlonglonglong";
    const next4 = "short\nlong";
    const head4 = "short\nlonglong".length; // L2 C8
    expect(clampCursor(old4, head4, next4)).toBe("short\nlong".length);
  });
});
