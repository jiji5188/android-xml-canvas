// M4y：字形像素 → 轮廓 pathData（纯几何，Node 可测）
import { expect, test, describe } from "vitest";
import {
  boundaryEdges,
  chainEdges,
  simplifyPoly,
  polyToPathData,
  maskToPathData,
} from "../lib/xml/font-glyph";

function makeMask(S: number, paint: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (paint(x, y)) m[y * S + x] = 1;
  return m;
}

describe("M4y boundaryEdges", () => {
  test("单像素：4 条边，首尾相接", () => {
    const S = 4;
    const m = makeMask(S, (x, y) => x === 1 && y === 1);
    const e = boundaryEdges(m, S);
    expect(e.length).toBe(4);
    // 顶边向右、右边向下、底边向左、左边向上
    expect(e).toContainEqual({ from: [1, 1], to: [2, 1] });
    expect(e).toContainEqual({ from: [2, 1], to: [2, 2] });
    expect(e).toContainEqual({ from: [2, 2], to: [1, 2] });
    expect(e).toContainEqual({ from: [1, 2], to: [1, 1] });
  });

  test("2×2 实心块：8 条外边，无内边", () => {
    const S = 6;
    const m = makeMask(S, (x, y) => x >= 1 && x <= 2 && y >= 1 && y <= 2);
    const e = boundaryEdges(m, S);
    expect(e.length).toBe(8);
  });

  test("圆环：内孔也产生边（方向与外环相反）", () => {
    const S = 9;
    const m = makeMask(S, (x, y) => {
      const outer = x >= 1 && x <= 7 && y >= 1 && y <= 7;
      const hole = x >= 3 && x <= 5 && y >= 3 && y <= 5;
      return outer && !hole;
    });
    const e = boundaryEdges(m, S);
    // 环外圈 7×7 = 28 + 内孔 3×3 = 12
    expect(e.length).toBe(28 + 12);
    const polys = chainEdges(e);
    expect(polys.length).toBe(2);
  });
});

describe("M4y chainEdges", () => {
  test("单像素：一条闭合 4 点多边形", () => {
    const S = 4;
    const m = makeMask(S, (x, y) => x === 1 && y === 1);
    const polys = chainEdges(boundaryEdges(m, S));
    expect(polys.length).toBe(1);
    expect(polys[0].length).toBe(4);
  });

  test("两个分离块：2 条闭合多边形", () => {
    const S = 10;
    const m = makeMask(S, (x, y) =>
      (x >= 1 && x <= 3 && y >= 1 && y <= 3) || (x >= 6 && x <= 8 && y >= 6 && y <= 8)
    );
    const polys = chainEdges(boundaryEdges(m, S));
    expect(polys.length).toBe(2);
  });

  test("环：外环顺时针、内孔逆时针（非零填充才能挖空）", () => {
    const S = 11;
    const m = makeMask(S, (x, y) => {
      const outer = x >= 1 && x <= 9 && y >= 1 && y <= 9;
      const hole = x >= 4 && x <= 6 && y >= 4 && y <= 6;
      return outer && !hole;
    });
    const polys = chainEdges(boundaryEdges(m, S));
    expect(polys.length).toBe(2);
    // 有向面积符号：外环与内孔相反
    const area = (p: number[][]) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const [x1, y1] = p[i];
        const [x2, y2] = p[(i + 1) % p.length];
        a += x1 * y2 - x2 * y1;
      }
      return a / 2;
    };
    const areas = polys.map(area).sort((a, b) => a - b);
    expect(areas[0] * areas[1]).toBeLessThan(0);
    // 外环面积大、内孔面积小
    expect(Math.abs(areas[1])).toBeGreaterThan(Math.abs(areas[0]));
  });
});

describe("M4y simplifyPoly", () => {
  test("共线点被剔除：4×4 方块 → 4 个角", () => {
    const S = 8;
    const m = makeMask(S, (x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5);
    const polys = chainEdges(boundaryEdges(m, S));
    expect(polys.length).toBe(1);
    expect(simplifyPoly(polys[0]).length).toBe(4);
  });

  test("L 形：6 个角", () => {
    const S = 12;
    const m = makeMask(S, (x, y) => {
      const inSquare = x >= 1 && x <= 9 && y >= 1 && y <= 9;
      const inNotch = x >= 5 && x <= 9 && y >= 5 && y <= 9;
      return inSquare && !inNotch;
    });
    const polys = chainEdges(boundaryEdges(m, S));
    expect(simplifyPoly(polys[0]).length).toBe(6);
  });
});

describe("M4y maskToPathData", () => {
  test("空 mask → null", () => {
    expect(maskToPathData(new Uint8Array(9), 3)).toBeNull();
  });

  test("S=96 换算到 24 视口：坐标 = 像素 / 4", () => {
    const S = 96;
    const m = makeMask(S, (x, y) => x >= 20 && x <= 23 && y >= 20 && y <= 23);
    const d = maskToPathData(m, S)!;
    expect(d).toContain("5 5"); // 20/96*24 = 5
    expect(d).toContain("6 6"); // 24/96*24 = 6
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  test("环：pathData 含两段（外环 + 内孔），各自闭合", () => {
    const S = 12;
    const m = makeMask(S, (x, y) => {
      const outer = x >= 1 && x <= 10 && y >= 1 && y <= 10;
      const hole = x >= 4 && x <= 7 && y >= 4 && y <= 7;
      return outer && !hole;
    });
    const d = maskToPathData(m, S, 12)!;
    const zCount = (d.match(/Z/g) ?? []).length;
    expect(zCount).toBe(2);
  });

  test("pathData 里没有 NaN/undefined", () => {
    const S = 24;
    const m = makeMask(S, (x, y) => (x - 12) ** 2 + (y - 12) ** 2 <= 100);
    const d = maskToPathData(m, S)!;
    expect(d).not.toContain("NaN");
    expect(d).not.toContain("undefined");
  });
});

describe("M4y polyToPathData", () => {
  test("退化多边形（<3 点）→ 空串", () => {
    expect(polyToPathData([[1, 1], [2, 2]], 4, 4)).toBe("");
  });

  test("正方形 → M...L...L...L...Z", () => {
    const d = polyToPathData([[0, 0], [2, 0], [2, 2], [0, 2]], 4, 4);
    expect(d).toBe("M0 0 L2 0 L2 2 L0 2 Z");
  });
});
