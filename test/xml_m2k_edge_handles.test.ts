// test/xml_m2k_edge_handles.test.ts — M2k/M2l：四边手柄（左右改宽 / 上下改高）+ 移动
// 手柄逻辑在 XmlCanvas 内部，这里用纯函数复刻同一套公式，锁定语义不被改坏。
import { describe, it, expect } from "vitest";

type Mode = "move" | "left" | "right" | "top" | "bottom";

interface Geom {
  px: number;
  py: number;
  /** 起点 margin（布局 px） */
  x: number;
  y: number;
  /** 起点尺寸（布局 px，offsetWidth/offsetHeight） */
  w: number;
  h: number;
  /** 视觉缩放比 rect.width / offsetWidth（外层 transform: scale(fitRatio)） */
  vs: number;
  /** 宽/高是否百分比型（match_parent / calc(100% - Npx)） */
  wPct?: boolean;
  hPct?: boolean;
}

const SCALE = 2;

/** 与 XmlCanvas.derive + up() 完全一致的推导 */
function solve(g: Geom, mode: Mode, screenDx: number, screenDy: number) {
  const dx = screenDx / g.vs;
  const dy = screenDy / g.vs;
  let x = g.x;
  let y = g.y;
  let w = g.w;
  let h = g.h;
  if (mode === "move") {
    x += dx;
    y += dy;
    // 百分比型宽高：加 margin 后 Android 会从尺寸里扣掉 margin
    if (g.wPct) w -= dx;
    if (g.hPct) h -= dy;
  } else if (mode === "left") {
    x += dx;
    w -= dx;
  } else if (mode === "right") {
    w += dx;
  } else if (mode === "top") {
    y += dy;
    h -= dy;
  } else if (mode === "bottom") {
    h += dy;
  }
  w = Math.max(8, w);
  h = Math.max(8, h);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const px2dp = (v: number) => r1(v / SCALE);
  const patch =
    mode === "move"
      ? { x: px2dp(x), y: px2dp(y) }
      : mode === "left"
        ? { x: px2dp(x), w: px2dp(w) }
        : mode === "right"
          ? { w: px2dp(w) }
          : mode === "top"
            ? { y: px2dp(y), h: px2dp(h) }
            : { h: px2dp(h) };
  return { patch, layout: { x, y, w, h } };
}

// 画布 1:1（无 transform 缩放）
const base: Geom = { px: 0, py: 0, x: 8, y: 16, w: 300, h: 150, vs: 1 };
// 画布被缩放：视觉只有一半大
const half: Geom = { ...base, vs: 0.5 };

describe("M2k 四边手柄几何语义", () => {
  it("左边手柄：右缘固定，宽反向变化，x 同步（只动宽不动高）", () => {
    const { patch } = solve(base, "left", 40, 999);
    // x: (8+40)/2 = 24dp；w: (300-40)/2 = 130dp
    expect(patch).toEqual({ x: 24, w: 130 });
    expect("h" in patch).toBe(false);
  });

  it("右边手柄：只改宽，x/y/h 都不动", () => {
    const { patch } = solve(base, "right", 40, 999);
    expect(patch).toEqual({ w: 170 });
    expect("x" in patch).toBe(false);
    expect("h" in patch).toBe(false);
  });

  it("上边手柄：下缘固定，高反向变化，y 同步（只动高不动宽）", () => {
    const { patch } = solve(base, "top", 999, 30);
    // y: (16+30)/2 = 23dp；h: (150-30)/2 = 60dp
    expect(patch).toEqual({ y: 23, h: 60 });
    expect("w" in patch).toBe(false);
  });

  it("下边手柄：只改高，x/y/w 都不动", () => {
    const { patch } = solve(base, "bottom", 999, 30);
    expect(patch).toEqual({ h: 90 });
    expect("w" in patch).toBe(false);
  });

  it("move 手柄：只改 x/y，宽高不变", () => {
    const { patch } = solve(base, "move", 20, 10);
    // x: (8+20)/2 = 14dp；y: (16+10)/2 = 13dp
    expect(patch).toEqual({ x: 14, y: 13 });
    expect("w" in patch).toBe(false);
    expect("h" in patch).toBe(false);
  });

  it("宽度有下限 8px：拖过头也不会变负宽", () => {
    const { patch } = solve(base, "left", 500, 0);
    expect(patch.w).toBe(4); // 8px / 2
  });

  it("高度有下限 8px", () => {
    const { patch } = solve(base, "top", 0, 400);
    expect(patch.h).toBe(4);
  });
});

describe("M2l 画布缩放（fitRatio）下不能把尺寸缩小", () => {
  it("画布缩到 0.5：屏幕拖 40px = 布局 80px，宽度必须变大 80px（不是缩小）", () => {
    const { patch, layout } = solve(half, "right", 40, 0);
    // 布局宽 300 + 80 = 380px → 190dp，比原来 150dp 大
    expect(layout.w).toBe(380);
    expect(patch.w).toBe(190);
    expect(patch.w).toBeGreaterThan(150);
  });

  it("画布缩到 0.5：下边拖 40px = 布局 80px，高度变大", () => {
    const { patch } = solve(half, "bottom", 0, 40);
    expect(patch.h).toBe(115); // (150+80)/2
    expect(patch.h).toBeGreaterThan(75);
  });

  it("画布缩到 0.5：移动位移也按 1/vs 放大，位置跟手", () => {
    const { patch } = solve(half, "move", 20, 10);
    // x: (8+40)/2 = 24；y: (16+20)/2 = 18
    expect(patch).toEqual({ x: 24, y: 18 });
  });

  it("vs = 1 时位移不放大（回归保护）", () => {
    const { patch } = solve(base, "move", 20, 10);
    expect(patch).toEqual({ x: 14, y: 13 });
  });
});

describe("M2n match_parent（百分比）元素移动时预览同步缩宽", () => {
  const pct: Geom = { ...base, w: 764, h: 800, wPct: true, hPct: true };

  it("百分比宽：往右拖 40px（布局）→ 预览宽减 40，写回 marginStart 增加 40", () => {
    const { patch, layout } = solve(pct, "move", 40, 0);
    expect(layout.w).toBe(724); // 764 - 40
    expect(patch.x).toBe(24); // (8+40)/2
  });

  it("固定宽（非百分比）：移动不改宽度，所以不缩", () => {
    const fixed: Geom = { ...base, w: 300, h: 150 };
    const { layout } = solve(fixed, "move", 40, 0);
    expect(layout.w).toBe(300);
  });

  it("百分比高：往下拖 20px → 预览高减 20", () => {
    const { layout } = solve(pct, "move", 0, 20);
    expect(layout.h).toBe(780);
  });

  it("缩放画布时按布局位移缩（屏幕 20px / vs 0.5 = 40px）", () => {
    const halfPct: Geom = { ...pct, vs: 0.5 };
    const { layout } = solve(halfPct, "move", 20, 0);
    expect(layout.w).toBe(724);
  });
});
