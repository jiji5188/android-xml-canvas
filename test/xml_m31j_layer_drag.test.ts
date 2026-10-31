// test/xml_m31j_layer_drag.test.ts — M31j：图层拖拽纯逻辑（pointer 版）
import { describe, expect, it } from "vitest";
import {
  DRAG_SLOP,
  TOUCH_HOLD_MS,
  autoScrollDelta,
  canDropOn,
  isSelfOrDescendant,
  shouldStartDrag,
  zoneAt,
} from "@/lib/xml/layer-drag";

describe("shouldStartDrag", () => {
  it("没超过阈值不动", () => {
    expect(shouldStartDrag({ pointerType: "mouse", dx: 2, dy: 3, elapsedMs: 999 })).toBe(false);
    expect(shouldStartDrag({ pointerType: "touch", dx: 0, dy: 0, elapsedMs: 999 })).toBe(false);
  });

  it("鼠标一动就拖", () => {
    expect(shouldStartDrag({ pointerType: "mouse", dx: DRAG_SLOP + 1, dy: 0, elapsedMs: 0 })).toBe(true);
  });

  it("手指要先按住够久，否则算滑动列表", () => {
    expect(shouldStartDrag({ pointerType: "touch", dx: 20, dy: 20, elapsedMs: TOUCH_HOLD_MS - 1 })).toBe(false);
    expect(shouldStartDrag({ pointerType: "touch", dx: 20, dy: 20, elapsedMs: TOUCH_HOLD_MS })).toBe(true);
  });
});

describe("zoneAt", () => {
  it("非容器只有 before/after，按中线分", () => {
    expect(zoneAt(10, 0, 32, false)).toBe("before");
    expect(zoneAt(17, 0, 32, false)).toBe("after");
  });

  it("容器上下 1/4 换兄弟，中间放子项", () => {
    expect(zoneAt(3, 0, 32, true)).toBe("before");
    expect(zoneAt(16, 0, 32, true)).toBe("inside");
    expect(zoneAt(30, 0, 32, true)).toBe("after");
  });

  it("高度为 0 不崩", () => {
    expect(zoneAt(5, 0, 0, true)).toBe("after");
  });
});

describe("isSelfOrDescendant / canDropOn", () => {
  it("父路径前缀相同即后代", () => {
    expect(isSelfOrDescendant("#0/1/2", "#0/1")).toBe(true);
    expect(isSelfOrDescendant("#0/1", "#0/1")).toBe(true);
    expect(isSelfOrDescendant("#0/11", "#0/1")).toBe(false); // 字符串前缀不算
  });

  it("不能拖到自己或自己的子树", () => {
    expect(canDropOn("#0/1", "#0/1")).toBe(false);
    expect(canDropOn("#0/1", "#0/1/0")).toBe(false);
    expect(canDropOn("#0/1", "#0/2")).toBe(true);
    expect(canDropOn("", "#0/2")).toBe(false);
  });
});

describe("autoScrollDelta", () => {
  it("靠近上边负、靠近下边正、中间 0", () => {
    expect(autoScrollDelta(105, 100, 400)).toBeLessThan(0);
    expect(autoScrollDelta(395, 100, 400)).toBeGreaterThan(0);
    expect(autoScrollDelta(250, 100, 400)).toBe(0);
  });
});
