// M88p：path 平移/缩放时「相邻参数组之间漏空格」的回归测试
// 背景：Material 图标常用紧凑写法 "l-8,8 8,8 1.41,-1.41"（一个命令后面跟多组参数）。
// 旧实现每组参数直接 out += 拼接，没有分隔符 → "-8 8" + "8 8" 变成 "-8 88 8"，
// 路径被写坏（坐标暴涨）→ 一拖动图形就炸形；参数个数错位还会算出 NaN 包围盒（React 报
// "Received NaN for the y attribute"）。这里同时锁住「不写坏」和「不产生 NaN」。
import { describe, it, expect } from "vitest";
import {
  pathBox,
  pathPoints,
  shapeBox,
  translatePath,
  scalePath,
  translateShape,
  scaleShape,
  type DrawShape,
} from "@/lib/xml/canvas-shapes";

/** Material ic_arrow_back 的原始 pathData（紧凑相对写法） */
const ARROW = "M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z";
const BOX = { x: 4, y: 4, w: 16, h: 16 };

const pathShape = (d: string): DrawShape => ({
  id: "p1",
  type: "path",
  d,
  fill: "#000000",
  stroke: "none",
  strokeWidth: 0,
  alpha: 1,
});

describe("M88p translatePath 参数分隔", () => {
  it("紧凑相对段平移后仍是 6 个数字，不粘连", () => {
    const t = translatePath(ARROW, 2, 3);
    const nums = t.match(/-?\d*\.?\d+/g) ?? [];
    expect(nums.length).toBe((ARROW.match(/-?\d*\.?\d+/g) ?? []).length);
    expect(t).toContain("l-8 8 8 8 1.41 -1.41");
    expect(t).not.toContain("88");
  });

  it("平移后包围盒尺寸不变、位置精确偏移", () => {
    const b = pathBox(translatePath(ARROW, 2, 3));
    expect(b.w).toBeCloseTo(BOX.w, 5);
    expect(b.h).toBeCloseTo(BOX.h, 5);
    expect(b.x).toBeCloseTo(BOX.x + 2, 5);
    expect(b.y).toBeCloseTo(BOX.y + 3, 5);
  });

  it("多组参数的绝对命令也不会粘（C 两段）", () => {
    const d = "M0 0C1 1 2 2 3 3 4 4 5 5 6 6";
    const t = translatePath(d, 1, 1);
    expect(t.match(/-?\d*\.?\d+/g)!.length).toBe(14);
    expect(t).toBe("M1 1C2 2 3 3 4 4 5 5 6 6 7 7");
  });

  it("坏的 pathData 原样返回，不产生 NaN", () => {
    const bad = "M0 0L5"; // 少一个坐标
    const t = translatePath(bad, 3, 3);
    expect(t).toBe(bad);
    expect(pathPoints(t).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("坐标不完整时包围盒仍是有限数（selBox 不会 NaN）", () => {
    const s = pathShape("M0 0L5");
    const b = shapeBox(s);
    expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)).toBe(true);
  });
});

describe("M88p scalePath 参数分隔", () => {
  it("等比放大 2x：紧凑段不粘、宽高都翻倍", () => {
    const b0 = pathBox(ARROW);
    const d = scalePath(ARROW, 2, 2, b0.x, b0.y);
    expect(d).not.toContain("1616");
    const b1 = pathBox(d);
    expect(b1.w).toBeCloseTo(b0.w * 2, 1);
    expect(b1.h).toBeCloseTo(b0.h * 2, 1);
  });

  it("translateShape + scaleShape 后 box 依旧有限且等比", () => {
    const s = pathShape(ARROW);
    const b0 = shapeBox(s);
    const moved = translateShape(JSON.parse(JSON.stringify(s)) as DrawShape, 4, -2);
    const bm = shapeBox(moved);
    expect(bm.w).toBeCloseTo(b0.w, 5);
    expect(bm.h).toBeCloseTo(b0.h, 5);
    expect(bm.x).toBeCloseTo(b0.x + 4, 5);
    expect(bm.y).toBeCloseTo(b0.y - 2, 5);
    const scaled = scaleShape(JSON.parse(JSON.stringify(s)) as DrawShape, b0, {
      x: b0.x,
      y: b0.y,
      w: b0.w * 1.5,
      h: b0.h * 1.5,
    });
    const bs = shapeBox(scaled);
    expect(bs.w).toBeCloseTo(b0.w * 1.5, 1);
    expect(bs.h).toBeCloseTo(b0.h * 1.5, 1);
  });
});
