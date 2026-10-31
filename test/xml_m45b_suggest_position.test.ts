// test/xml_m45b_suggest_position.test.ts — M45：弹窗定位（纯函数）
import { describe, it, expect } from "vitest";
import {
  estimateSuggestSize,
  placeSuggest,
  SUG_ITEM_H,
  SUG_MAX_H,
} from "@/lib/xml/suggest-position";

const container = { width: 400, height: 600 };
const caret = (left: number, top: number, w = 4, h = 21) => ({
  left,
  right: left + w,
  top,
  bottom: top + h,
});

describe("placeSuggest", () => {
  it("下方空间够 → 弹在光标行下方，x 左边缘跟光标", () => {
    const r = placeSuggest(caret(120, 100), { width: 240, height: 200 }, container);
    expect(r.placement).toBe("below");
    expect(r.align).toBe("follow");
    expect(r.top).toBe(125);
    expect(r.left).toBe(120);
    expect(r.maxHeight).toBe(200);
  });

  it("下方不够、上方够 → 翻到光标行上方", () => {
    const r = placeSuggest(caret(60, 500), { width: 240, height: 200 }, container);
    expect(r.placement).toBe("above");
    expect(r.top).toBe(500 - 4 - 200);
    expect(r.left).toBe(60);
  });

  it("上下都不够 → 贴空间大的一边并限高", () => {
    const r = placeSuggest(caret(10, 290), { width: 240, height: 400 }, container);
    // 下方 600-311-4-4=281，上方 290-4-4=282 → 上方略大
    expect(r.placement).toBe("above");
    expect(r.maxHeight).toBeCloseTo(282, 0);
    expect(r.top).toBeGreaterThanOrEqual(4);
  });

  it("光标 x 在视口右侧、弹窗放不下 → 右边缘对齐光标 x", () => {
    // 容器宽 400，光标左 380 右 384，弹窗宽 240
    // 380 + 240 = 620 > 400-4 → 走右对齐：left = 384 - 240 = 144
    const r = placeSuggest(caret(380, 100, 4), { width: 240, height: 100 }, container);
    expect(r.align).toBe("right");
    expect(r.left).toBe(384 - 240);
  });

  it("右对齐后不越容器左边界", () => {
    // 光标在 300（右边缘 304），弹窗 300 宽 → followOk: 300+300=600 > 400-4=396 → 右对齐：left = 304-300 = 4
    const r = placeSuggest(caret(300, 100, 4), { width: 300, height: 100 }, container);
    expect(r.align).toBe("right");
    expect(r.left).toBe(4);
  });

  it("x 小于 margin → 贴左边界", () => {
    const r = placeSuggest(caret(0, 100), { width: 240, height: 100 }, container);
    expect(r.left).toBe(4);
  });

  it("弹窗高度取不到时用最小值也能定位", () => {
    const r = placeSuggest(caret(20, 20), { width: 200, height: 0 }, container);
    expect(r.placement).toBe("below");
    expect(r.top).toBe(45);
  });

  it("maxHeight 不超过 320", () => {
    // 弹窗 40 条 = 40*26+8 = 1048 → 超出 320 → 限高 320
    const many = { width: 240, height: 40 * SUG_ITEM_H + 8 };
    const r = placeSuggest(caret(20, 20), many, container);
    expect(r.maxHeight).toBeLessThanOrEqual(SUG_MAX_H);
  });
});

describe("estimateSuggestSize", () => {
  it("按条数算高度，封顶 320", () => {
    const few = estimateSuggestSize(["a", "b", "c"]);
    expect(few.height).toBe(3 * SUG_ITEM_H + 8);
    const many = estimateSuggestSize(Array.from({ length: 60 }, (_, i) => `item${i}`));
    expect(many.height).toBe(SUG_MAX_H);
  });

  it("宽度随内容增长但有上限", () => {
    const narrow = estimateSuggestSize(["ab"]);
    const wide = estimateSuggestSize(["app:layout_constraintHorizontal_bias"]);
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(wide.width).toBeLessThanOrEqual(320);
  });

  it("空列表也有最小尺寸", () => {
    const s = estimateSuggestSize([]);
    expect(s.width).toBeGreaterThanOrEqual(180);
    expect(s.height).toBeGreaterThan(0);
  });
});
