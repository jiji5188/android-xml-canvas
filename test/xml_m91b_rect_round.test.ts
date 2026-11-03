import { describe, expect, it } from "vitest";
import { defaultRoundFor, rectPath, shapeD, type DrawShape } from "@/lib/xml/canvas-shapes";

/**
 * M91b：画出「直角矩形」却渲染成圆角矩形
 *
 * 根因：IconCanvasEditor.makeShape 里 `case "rect": case "roundRect":` 共用一个 return，
 * 直角矩形也被塞了 `round = max(0.5, vw*0.1)`（24 视口 → 2.4 圆角），
 * 于是 10% 圆角，肉眼就是圆角矩形。
 */
describe("M91b 直角矩形不该带圆角", () => {
  it("defaultRoundFor：rect 恒为 0，roundRect 才有默认圆角", () => {
    expect(defaultRoundFor("rect", 24)).toBe(0);
    expect(defaultRoundFor("rect", 300)).toBe(0);
    expect(defaultRoundFor("roundRect", 24)).toBeCloseTo(2.4, 6);
    expect(defaultRoundFor("roundRect", 300)).toBeCloseTo(30, 6);
  });

  it("rectPath 圆角为 0 时输出纯 h/v 直角路径（不含圆弧命令 a）", () => {
    const d = rectPath(2, 3, 10, 8, 0);
    expect(d).toBe("M2,3h10v8h-10Z");
    expect(d.includes("a")).toBe(false);
  });

  it("rectPath 带圆角时才出现 4 段圆弧", () => {
    const d = rectPath(0, 0, 10, 10, 2);
    expect((d.match(/a/g) || []).length).toBe(4);
  });

  it("shapeD：type=rect + round=0 → 直角；roundRect + round → 圆角", () => {
    const sharp = shapeD({
      id: "s1",
      type: "rect",
      x: 0,
      y: 0,
      w: 12,
      h: 12,
      round: 0,
      fill: "#000000",
      stroke: "none",
      strokeWidth: 0,
      alpha: 1,
    } as DrawShape);
    expect(sharp.includes("a")).toBe(false);

    const rounded = shapeD({
      id: "s2",
      type: "roundRect",
      x: 0,
      y: 0,
      w: 12,
      h: 12,
      round: 3,
      fill: "#000000",
      stroke: "none",
      strokeWidth: 0,
      alpha: 1,
    } as DrawShape);
    expect(rounded.includes("a")).toBe(true);
  });

  it("圆角被夹到短边一半，不会溢出", () => {
    const d = rectPath(0, 0, 10, 6, 99);
    expect(d.includes("a3,3")).toBe(true);
  });
});
