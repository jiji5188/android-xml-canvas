// @vitest-environment node
// M442：代码编辑框双指捏合缩放的数学（纯函数）
import { describe, expect, it } from "vitest";
import { zoomFromPinch, pointerDist, CODE_ZOOM_MIN, CODE_ZOOM_MAX } from "@/lib/xml/code-zoom";

describe("M442 code-zoom", () => {
  it("两指张开 → 字号变大", () => {
    // 起点 100px 距离、13px 字号；拉到 200px → 26px → 夹到 24
    expect(zoomFromPinch(13, 100, 200)).toBe(CODE_ZOOM_MAX);
  });
  it("两指合拢 → 字号变小", () => {
    // 13px 起，距离从 100 收到 50 → 6.5 → 夹到 10
    expect(zoomFromPinch(13, 100, 50)).toBe(CODE_ZOOM_MIN);
  });
  it("中间比例（不越界）", () => {
    // 13 * (150/100) = 19.5
    expect(zoomFromPinch(13, 100, 150)).toBe(19.5);
  });
  it("startDist=0 时不变", () => {
    expect(zoomFromPinch(13, 0, 80)).toBe(13);
  });
  it("pointerDist 欧氏距离", () => {
    expect(pointerDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
