// M83：画布编辑器的纯逻辑——对齐/均分、层级、转路径
// 这些函数从 IconCanvasEditor 抽到 canvas-shapes.ts，方便直接单测（不依赖 DOM）。
import { describe, it, expect } from "vitest";
import {
  alignShapes,
  convertShapesToPaths,
  moveInList,
  shapeBox,
  translatePath,
  type DrawShape,
} from "@/lib/xml/canvas-shapes";

const rect = (id: string, x: number, y: number, w = 4, h = 4): DrawShape => ({
  id,
  type: "rect",
  x,
  y,
  w,
  h,
  fill: "#000000",
  stroke: "none",
  strokeWidth: 0,
  alpha: 1,
});

const byId = (list: DrawShape[], id: string) => list.find((s) => s.id === id)!;

describe("alignShapes 对齐", () => {
  const base = [rect("a", 0, 0), rect("b", 10, 6), rect("c", 3, 12)];

  it("少于 2 个不动", () => {
    expect(alignShapes(base, ["a"], "left")).toBe(base);
    expect(alignShapes(base, [], "left")).toBe(base);
  });

  it("左对齐 → 统一到最左 x", () => {
    const out = alignShapes(base, ["a", "b"], "left");
    expect(byId(out, "b").type === "rect" && (byId(out, "b") as { x: number }).x).toBe(0);
  });

  it("右对齐 → 右边界统一", () => {
    const out = alignShapes(base, ["a", "b"], "right");
    const bx = shapeBox(byId(out, "a"));
    const bb = shapeBox(byId(out, "b"));
    expect(bb.x + bb.w).toBeCloseTo(bx.x + bx.w, 6);
  });

  it("水平居中 → 中心 x 一致", () => {
    const out = alignShapes(base, ["a", "b", "c"], "hcenter");
    const cx = (s: DrawShape) => {
      const b = shapeBox(s);
      return b.x + b.w / 2;
    };
    expect(cx(byId(out, "b"))).toBeCloseTo(cx(byId(out, "a")), 6);
    expect(cx(byId(out, "c"))).toBeCloseTo(cx(byId(out, "a")), 6);
  });

  it("顶对齐 / 垂直居中 / 底对齐", () => {
    const top = alignShapes(base, ["a", "b"], "top");
    expect(shapeBox(byId(top, "b")).y).toBeCloseTo(shapeBox(byId(top, "a")).y, 6);

    const vc = alignShapes(base, ["a", "b"], "vcenter");
    const cy = (s: DrawShape) => {
      const b = shapeBox(s);
      return b.y + b.h / 2;
    };
    expect(cy(byId(vc, "b"))).toBeCloseTo(cy(byId(vc, "a")), 6);

    const bot = alignShapes(base, ["a", "b", "c"], "bottom");
    const b0 = shapeBox(byId(bot, "a"));
    const b1 = shapeBox(byId(bot, "c"));
    expect(b1.y + b1.h).toBeCloseTo(b0.y + b0.h, 6);
  });

  it("不改动原数组（不可变）", () => {
    const before = JSON.stringify(base);
    alignShapes(base, ["a", "b"], "left");
    expect(JSON.stringify(base)).toBe(before);
  });

  it("未选中的图形保持原位", () => {
    const out = alignShapes(base, ["a", "b"], "left");
    expect(shapeBox(byId(out, "c"))).toEqual(shapeBox(byId(base, "c")));
  });
});

describe("alignShapes 均分", () => {
  it("少于 3 个不处理", () => {
    const two = [rect("a", 0, 0), rect("b", 10, 0)];
    expect(alignShapes(two, ["a", "b"], "hdist")).toBe(two);
  });

  it("水平均分：首尾不动，中间等间距", () => {
    const list = [rect("a", 0, 0, 4), rect("b", 5, 0, 4), rect("c", 30, 0, 4)];
    const out = alignShapes(list, ["a", "b", "c"], "hdist");
    const a = shapeBox(byId(out, "a"));
    const b = shapeBox(byId(out, "b"));
    const c = shapeBox(byId(out, "c"));
    // 总宽 34，三个宽 4 → gap = (34 - 12) / 2 = 11
    expect(b.x).toBeCloseTo(a.x + a.w + 11, 6);
    expect(c.x).toBeCloseTo(b.x + b.w + 11, 6);
  });

  it("垂直均分：中间图形落到等距位置", () => {
    const list = [rect("a", 0, 0, 4, 4), rect("b", 0, 2, 4, 4), rect("c", 0, 20, 4, 4)];
    const out = alignShapes(list, ["a", "b", "c"], "vdist");
    const a = shapeBox(byId(out, "a"));
    const b = shapeBox(byId(out, "b"));
    const c = shapeBox(byId(out, "c"));
    // 总高 24，三个高 4 → gap = (24 - 12) / 2 = 6
    expect(b.y).toBeCloseTo(a.y + a.h + 6, 6);
    expect(c.y).toBeCloseTo(b.y + b.h + 6, 6);
  });
});

describe("moveInList 层级", () => {
  const list = [rect("a", 0, 0), rect("b", 1, 0), rect("c", 2, 0)];

  it("front → 挪到列表尾（视觉最上）", () => {
    expect(moveInList(list, ["a"], "front").map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("back → 挪到列表头（视觉最下）", () => {
    expect(moveInList(list, ["c"], "back").map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("多选一起移动，保持彼此相对顺序", () => {
    expect(moveInList(list, ["a", "c"], "front").map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("空选中原样返回", () => {
    expect(moveInList(list, [], "front")).toBe(list);
  });
});

describe("translatePath 路径平移", () => {
  it("绝对命令全部偏移（H/V/L 不再漏）", () => {
    expect(translatePath("M5 5h14v14H5z", 1, 2)).toBe("M6 7h14v14H6z");
  });

  it("绝对 L / C / A 只挪锚点与终点", () => {
    expect(translatePath("M0 0L10 0", 2, 3)).toBe("M2 3L12 3");
    expect(translatePath("M0 0C1 1 2 2 3 3", 1, 1)).toBe("M1 1C2 2 3 3 4 4");
    // A rx ry rot laf sf x y → 只动最后两个
    expect(translatePath("M0 0A5 5 0 0 1 10 10", 2, 2)).toBe("M2 2A5 5 0 0 1 12 12");
  });

  it("纯相对路径前面补 M 位移", () => {
    expect(translatePath("l5 0l0 5z", 2, 3)).toBe("M2,3l5 0l0 5z");
  });

  it("偏移 0 时形状不变", () => {
    expect(translatePath("M5 5h14v14H5z", 0, 0)).toBe("M5 5h14v14H5z");
  });
});

describe("convertShapesToPaths 转路径", () => {
  it("矩形 → path，几何字段换成 d，样式保留", () => {
    const r: DrawShape = { ...rect("r", 2, 3, 6, 5), fill: "#B3261E", alpha: 0.5, strokeWidth: 2 };
    const out = convertShapesToPaths([r], ["r"]);
    const s = out[0];
    expect(s.type).toBe("path");
    if (s.type !== "path") throw new Error("type");
    expect(s.d).toBe("M2,3h6v5h-6Z");
    expect(s.fill).toBe("#B3261E");
    expect(s.alpha).toBe(0.5);
    expect(s.strokeWidth).toBe(2);
  });

  it("圆形/椭圆/多边形/星形都能转出 d", () => {
    const shapes: DrawShape[] = [
      { ...rect("c", 0, 0, 8, 8), type: "circle", cx: 4, cy: 4, r: 4 } as unknown as DrawShape,
      { ...rect("e", 0, 0, 8, 8), type: "ellipse", cx: 4, cy: 4, rx: 4, ry: 2 } as unknown as DrawShape,
      { ...rect("p", 0, 0, 8, 8), type: "polygon", cx: 4, cy: 4, r: 4, sides: 5 } as unknown as DrawShape,
      { ...rect("s", 0, 0, 8, 8), type: "star", cx: 4, cy: 4, r: 4, inner: 0.45, points: 5 } as unknown as DrawShape,
    ];
    const out = convertShapesToPaths(shapes, shapes.map((s) => s.id));
    for (const s of out) {
      expect(s.type).toBe("path");
      if (s.type === "path") expect(s.d.length).toBeGreaterThan(4);
    }
  });

  it("path / text 原样不动", () => {
    const p: DrawShape = { ...rect("p", 0, 0), type: "path", d: "M0 0h4v4z" } as unknown as DrawShape;
    const t: DrawShape = { ...rect("t", 0, 0), type: "text", x: 1, y: 2, text: "A", size: 8 } as unknown as DrawShape;
    const out = convertShapesToPaths([p, t], ["p", "t"]);
    expect(out[0]).toBe(p);
    expect(out[1]).toBe(t);
  });

  it("未选中的保持原对象", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 5, 5);
    const out = convertShapesToPaths([a, b], ["a"]);
    expect(out[1]).toBe(b);
    expect(out[0].type).toBe("path");
  });
});
