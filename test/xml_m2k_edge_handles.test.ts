// test/xml_m2k_edge_handles.test.ts — M2k：四边手柄（左右改宽 / 上下改高）落点几何计算
// 手柄逻辑在 XmlCanvas 内部，这里用纯函数复刻同一套公式，锁定语义不被改坏。
import { describe, it, expect } from "vitest";

type Mode = "move" | "left" | "right" | "top" | "bottom";

interface Geom {
  px: number;
  py: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parentLeft: number;
  parentTop: number;
}

/** 与 XmlCanvas.beginGeom 的 up() 完全一致的几何推导 */
function solve(g: Geom, mode: Mode, dx: number, dy: number, scale: number) {
  let nx = g.x;
  let ny = g.y;
  let nw = g.w;
  let nh = g.h;
  if (mode === "move") {
    nx += dx;
    ny += dy;
  } else if (mode === "left") {
    nx += dx;
    nw -= dx;
  } else if (mode === "right") {
    nw += dx;
  } else if (mode === "top") {
    ny += dy;
    nh -= dy;
  } else if (mode === "bottom") {
    nh += dy;
  }
  nw = Math.max(8, nw);
  nh = Math.max(8, nh);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const relX = (nx - g.parentLeft) / scale;
  const relY = (ny - g.parentTop) / scale;
  return {
    patch:
      mode === "move"
        ? { x: r1(relX), y: r1(relY) }
        : mode === "left"
          ? { x: r1(relX), w: r1(nw / scale) }
          : mode === "right"
            ? { w: r1(nw / scale) }
            : mode === "top"
              ? { y: r1(relY), h: r1(nh / scale) }
              : { h: r1(nh / scale) },
  };
}

const base: Geom = { px: 0, py: 0, x: 100, y: 200, w: 300, h: 150, parentLeft: 0, parentTop: 0 };
const S = 2;

describe("M2k 四边手柄几何语义", () => {
  it("左边手柄：右缘固定，宽反向变化，x 同步（只动宽不动高）", () => {
    const { patch } = solve(base, "left", 40, 999, S);
    // x: (100+40)/2 = 70dp；w: (300-40)/2 = 130dp
    expect(patch).toEqual({ x: 70, w: 130 });
    expect("h" in patch).toBe(false); // 绝不动高
  });

  it("右边手柄：只改宽，x/y/h 都不动", () => {
    const { patch } = solve(base, "right", 40, 999, S);
    expect(patch).toEqual({ w: 170 });
    expect("x" in patch).toBe(false);
    expect("h" in patch).toBe(false);
  });

  it("上边手柄：下缘固定，高反向变化，y 同步（只动高不动宽）", () => {
    const { patch } = solve(base, "top", 999, 30, S);
    // y: (200+30)/2 = 115dp；h: (150-30)/2 = 60dp
    expect(patch).toEqual({ y: 115, h: 60 });
    expect("w" in patch).toBe(false);
  });

  it("下边手柄：只改高，x/y/w 都不动", () => {
    const { patch } = solve(base, "bottom", 999, 30, S);
    expect(patch).toEqual({ h: 90 });
    expect("w" in patch).toBe(false);
  });

  it("move 手柄：只改 x/y，宽高不变", () => {
    const { patch } = solve(base, "move", 20, 10, S);
    expect(patch).toEqual({ x: 60, y: 105 });
    expect("w" in patch).toBe(false);
    expect("h" in patch).toBe(false);
  });

  it("宽度有下限 8px：左边猛拖超出也不会变负宽", () => {
    const { patch } = solve(base, "left", 500, 0, S);
    // w = max(8, 300-500) = 8 → 4dp
    expect(patch.w).toBe(4);
  });

  it("高度有下限 8px", () => {
    const { patch } = solve(base, "top", 0, 400, S);
    expect(patch.h).toBe(4);
  });
});
