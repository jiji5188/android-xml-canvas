// test/xml_m186_inspector.test.ts — M186：检查器纯逻辑（inspector.ts）
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  collectMeasurements,
  flattenTree,
  fmtDp,
  inspectorWarningsOf,
  type InspectableNode,
  type MeasuredNode,
} from "@/lib/xml/inspector";

const tree: InspectableNode = {
  tag: "LinearLayout",
  path: "#0",
  children: [
    {
      tag: "android.widget.TextView",
      path: "#0/0",
      children: [],
      attrs: { id: "title", "layout_width": "wrap_content" },
    },
    {
      tag: "Button",
      path: "#0/1",
      children: [],
      attrs: { id: "go" },
    },
  ],
  attrs: { id: "root" },
};

describe("fmtDp", () => {
  it("保留两位小数", () => {
    expect(fmtDp(1.5)).toBe("1.5");
    expect(fmtDp(1.23456)).toBe("1.23");
    expect(fmtDp(0)).toBe("0");
  });
});

describe("flattenTree", () => {
  it("默认只出根（未展开）", () => {
    const rows = flattenTree(tree, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("#0");
  });
  it("展开后包含子节点与 id", () => {
    const rows = flattenTree(tree, new Set(["#0"]));
    expect(rows.map((r) => r.path)).toEqual(["#0", "#0/0", "#0/1"]);
    expect(rows[1].id).toBe("title");
    expect(rows[1].depth).toBe(1);
  });
  it("限流（limit）", () => {
    const big: InspectableNode = {
      tag: "R",
      path: "#0",
      children: Array.from({ length: 500 }, (_, i) => ({
        tag: "V",
        path: `#0/${i}`,
        children: [] as InspectableNode[],
      })),
    };
    expect(flattenTree(big, new Set(["#0"]), 100).length).toBeLessThanOrEqual(100);
  });
});

const measured: MeasuredNode[] = [
  { path: "#0", tag: "LinearLayout", x: 0, y: 0, w: 100, h: 200, parentPath: null },
  { path: "#0/0", tag: "TextView", x: 10, y: 10, w: 50, h: 20, parentPath: "#0" },
  { path: "#0/1", tag: "Button", x: 120, y: 150, w: 40, h: 20, parentPath: "#0" },
];

describe("inspectorWarningsOf", () => {
  it("正常布局无警告", () => {
    const good: MeasuredNode[] = [
      ...measured.slice(0, 2),
      { path: "#0/1", tag: "Button", x: 20, y: 150, w: 40, h: 20, parentPath: "#0" },
    ];
    expect(inspectorWarningsOf(tree, good)).toEqual([]);
  });
  it("越出父容器 → overflow（右边）", () => {
    const warns = inspectorWarningsOf(tree, measured);
    expect(warns).toHaveLength(1);
    expect(warns[0].kind).toBe("overflow");
    expect(warns[0].path).toBe("#0/1");
    expect(warns[0].message).toContain("越出");
  });
  it("1dp 以内抖动不报（取整容差）", () => {
    const edge: MeasuredNode[] = [
      measured[0],
      { path: "#0/1", tag: "Button", x: 99.5, y: 180, w: 0.4, h: 19.9, parentPath: "#0" },
    ];
    // w 结束 99.9 vs 父 100，差 0.1 < 1 → 不报
    expect(inspectorWarningsOf(tree, edge).filter((w) => w.kind === "overflow")).toEqual([]);
  });
  it("零尺寸控件 → zero-size", () => {
    const z: MeasuredNode[] = [
      measured[0],
      { path: "#0/0", tag: "TextView", x: 10, y: 10, w: 0, h: 0, parentPath: "#0" },
    ];
    const warns = inspectorWarningsOf(tree, z);
    expect(warns.some((w) => w.kind === "zero-size" && w.path === "#0/0")).toBe(true);
  });
  it("根节点缺失实测 → 不报溢出（只报零尺寸）", () => {
    const noRoot: MeasuredNode[] = [
      { path: "#0/1", tag: "Button", x: 120, y: 150, w: 40, h: 20, parentPath: "#0" },
    ];
    expect(inspectorWarningsOf(tree, noRoot).filter((w) => w.kind === "overflow")).toEqual([]);
  });
  it("空树 / 空实测 → 无警告", () => {
    expect(inspectorWarningsOf(null, measured)).toEqual([]);
    expect(inspectorWarningsOf(tree, [])).toEqual([]);
  });
});

describe("collectMeasurements", () => {
  it("px → dp（scale=2）并记录父 path", () => {
    // 构造最小 DOM：父 div[data-path] 里一个子 div[data-path]
    const root = document.createElement("div");
    root.dataset.path = "#0";
    root.dataset.tag = "LinearLayout";
    root.style.cssText = "position:relative;";
    const child = document.createElement("div");
    child.dataset.path = "#0/0";
    child.dataset.tag = "TextView";
    root.appendChild(child);
    // 手动设定 rect：collectMeasurements 用 getBoundingClientRect，
    // jsdom 下无法直接设，用 mock
    const fakeStageRect = { left: 0, top: 0 };
    const fakeRects = new Map<HTMLElement, DOMRect>();
    fakeRects.set(root, { left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => null } as DOMRect);
    fakeRects.set(child, { left: 20, top: 30, width: 40, height: 20, right: 60, bottom: 50, x: 20, y: 30, toJSON: () => null } as DOMRect);
    root.getBoundingClientRect = () => fakeRects.get(root)!;
    child.getBoundingClientRect = () => fakeRects.get(child)!;
    document.body.appendChild(root);

    const out = collectMeasurements(root as unknown as HTMLElement, [root, child], 2, () => "");
    expect(out).toHaveLength(2);
    expect(out[0].x).toBe(0);
    expect(out[0].w).toBe(100); // 200px / 2
    expect(out[1].x).toBe(10); // 20px / 2
    expect(out[1].y).toBe(15);
    expect(out[1].w).toBe(20);
    expect(out[1].parentPath).toBe("#0");
    expect(out[0].parentPath).toBeNull();
    void fakeStageRect;
  });
  it("同 path 去重", () => {
    const root = document.createElement("div");
    root.dataset.path = "#0";
    const out = collectMeasurements(root as unknown as HTMLElement, [root, root as unknown as HTMLElement], 1, () => "");
    expect(out).toHaveLength(1);
  });
});
