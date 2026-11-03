import { describe, it, expect } from "vitest";
import { traceAlphaField, contoursToPathData, signedArea, simplifyLoop, orientLoops } from "../lib/xml/text-trace";

/** 造一个 w×h 的 alpha 场：inside(x,y) 返回 255/0 */
function field(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = inside(x, y) ? 255 : 0;
  return out;
}

const bbox = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

describe("M89l 文字轮廓追踪（marching squares）", () => {
  it("实心方块 → 一个闭合环，边界贴合", () => {
    const w = 40;
    const h = 30;
    const f = field(w, h, (x, y) => x >= 10 && x <= 28 && y >= 8 && y <= 20);
    const loops = traceAlphaField(f, w, h, 128);
    expect(loops.length).toBe(1);
    const b = bbox(loops[0]);
    expect(b.x0).toBeGreaterThan(9);
    expect(b.x0).toBeLessThan(11);
    expect(b.x1).toBeGreaterThan(27.5);
    expect(b.x1).toBeLessThan(29.5);
    expect(Math.abs(signedArea(loops[0]))).toBeGreaterThan(200);
  });

  it("圆环（甜甜圈）→ 两个环，内外方向相反（nonzero 填充能挖洞）", () => {
    const w = 60;
    const h = 60;
    const f = field(w, h, (x, y) => {
      const d = Math.hypot(x - 30, y - 30);
      return d <= 25 && d >= 12;
    });
    const loops = traceAlphaField(f, w, h, 128);
    expect(loops.length).toBe(2);
    const oriented = orientLoops(loops);
    const areas = oriented.map((l) => signedArea(l)).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(0); // 内孔
    expect(areas[1]).toBeGreaterThan(0); // 外轮廓
  });

  it("空白场 → 没有轮廓", () => {
    expect(traceAlphaField(field(20, 20, () => false), 20, 20, 128).length).toBe(0);
    expect(traceAlphaField(field(20, 20, () => true), 20, 20, 128).length).toBe(0);
  });

  it("RDP 简化会把长直边压成两点，且不舍掉拐角", () => {
    const pts = [];
    for (let x = 0; x <= 40; x++) pts.push({ x, y: 0 });
    for (let y = 1; y <= 40; y++) pts.push({ x: 40, y });
    for (let x = 39; x >= 0; x--) pts.push({ x, y: 40 });
    for (let y = 39; y >= 1; y--) pts.push({ x: 0, y });
    const out = simplifyLoop(pts, 0.6);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("contoursToPathData 输出闭合路径，且带坐标变换", () => {
    const f = field(20, 20, (x, y) => x > 4 && x < 14 && y > 4 && y < 14);
    const loops = traceAlphaField(f, 20, 20, 128);
    const d = contoursToPathData(loops, (p) => ({ x: p.x * 0.5, y: p.y * 0.5 }), { tol: 0.4 });
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("Q"); // 默认二次曲线平滑
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(1.5);
    expect(Math.max(...nums)).toBeLessThanOrEqual(7.5);
  });

  it("非平滑模式输出折线 L", () => {
    const f = field(20, 20, (x, y) => x > 4 && x < 14 && y > 4 && y < 14);
    const loops = traceAlphaField(f, 20, 20, 128);
    const d = contoursToPathData(loops, (p) => p, { tol: 0.4, smooth: false });
    expect(d).toContain("L");
    expect(d).not.toContain("Q");
  });
});
