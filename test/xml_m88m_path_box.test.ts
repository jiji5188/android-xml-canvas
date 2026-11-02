// M88m：path 包围盒（圆弧 / 曲线采样）+ 拖动位移不变形
// 背景：pathPoints 原先遇到 A 命令只取终点，导致纯圆弧图形（圆形/rounded）包围盒退化成一个点：
// 选中框变成小点、角手柄落在图形内部 → 拖一下就被判成「拉伸」→ 图形变形；面板改宽高按错误
// 基准缩放 → 直接炸形。这里锁住修复后的行为。
import { describe, it, expect } from "vitest";
import { pathBox, pathPoints, shapeBox, translateShape, scaleShape, type DrawShape } from "@/lib/xml/canvas-shapes";

const near = (a: number, b: number, tol = 0.35) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("M88m path 包围盒", () => {
  it("纯圆弧圆形的包围盒 ≈ 真实圆（不再退化成点）", () => {
    const b = pathBox("M12 2a10 10 0 1 0 0.01 0z");
    near(b.x, 2);
    near(b.y, 2);
    near(b.w, 20);
    near(b.h, 20);
  });

  it("相对圆弧 + 半圆（laf/sf 不同）包围盒合理", () => {
    const b = pathBox("M2 12a10 10 0 0 1 20 0");
    near(b.x, 2, 0.5);
    near(b.w, 20, 0.6);
    near(b.h, 10, 0.6);
  });

  it("三次贝塞尔按真实曲线取样（不再用控制点当边界）", () => {
    const b = pathBox("M2 10C2 2 22 2 22 10");
    near(b.x, 2, 0.2);
    near(b.w, 20, 0.2);
    // 真实曲线的极值在 y≈4，控制点在 y=2；采样后高度应明显小于控制点包络(8)
    expect(b.h).toBeGreaterThan(5);
    expect(b.h).toBeLessThan(7.5);
  });

  it("椭圆旋转 A 命令也能给出正确量级", () => {
    const b = pathBox("M0 0A8 4 30 1 0 0.01 0z");
    expect(b.w).toBeGreaterThan(6);
    expect(b.h).toBeGreaterThan(3);
  });

  it("pathPoints 采样点数量足够（曲线/圆弧不是单点）", () => {
    expect(pathPoints("M12 2a10 10 0 1 0 0.01 0z").length).toBeGreaterThan(20);
    expect(pathPoints("M2 10C2 2 22 2 22 10").length).toBeGreaterThan(10);
  });
});

describe("M88m 拖动/改位置不变形", () => {
  const pathShape = (d: string): DrawShape => ({
    id: "p1",
    type: "path",
    d,
    fill: "#000000",
    stroke: "none",
    strokeWidth: 0,
    alpha: 1,
  });

  const cases = [
    "M2 2L8 2L8 8Z",
    "M10 10h6v6h-6z",
    "M12 2a10 10 0 1 0 0.01 0z",
    "M2 10C2 2 22 2 22 10",
  ];

  it.each(cases)("平移后宽高完全不变：%s", (d) => {
    const s = pathShape(d);
    const b0 = shapeBox(s);
    const moved = translateShape(JSON.parse(JSON.stringify(s)) as DrawShape, 3.5, -1.25);
    const b1 = shapeBox(moved);
    expect(b1.w).toBeCloseTo(b0.w, 2);
    expect(b1.h).toBeCloseTo(b0.h, 2);
    expect(b1.x).toBeCloseTo(b0.x + 3.5, 2);
    expect(b1.y).toBeCloseTo(b0.y - 1.25, 2);
  });

  it.each(cases)("等比缩放后宽高比不变：%s", (d) => {
    const s = pathShape(d);
    const b0 = shapeBox(s);
    const to = { x: b0.x, y: b0.y, w: b0.w * 2, h: b0.h * 2 };
    const scaled = scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, b0, to);
    const b1 = shapeBox(scaled);
    expect(b1.w / b1.h).toBeCloseTo(b0.w / b0.h, 1);
    expect(b1.w).toBeCloseTo(b0.w * 2, 1);
  });
});
