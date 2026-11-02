// M89b：图标编辑器的「分组」——数据层（导出成真 <group>）+ 组变换数学 + 解组烘焙
import { describe, it, expect } from "vitest";
import {
  bakeGroupTransform,
  groupMatrix,
  groupTransform,
  groupsFromModel,
  invertMat,
  modelToShapes,
  shapesToModel,
  type CanvasMeta,
  type DrawShape,
  type GroupSpec,
} from "@/lib/xml/canvas-shapes";
import { parseVectorModel, buildVectorXml } from "@/lib/xml/vector-edit";

const META: CanvasMeta = {
  w: 24,
  h: 24,
  vw: 24,
  vh: 24,
  group: { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 12, pivotY: 12 },
};

const G: GroupSpec = { id: "g1", name: "dots", tx: 2, ty: -1, rot: 0, sx: 1, sy: 1, px: 6, py: 6 };

const rect = (id: string, group?: string): DrawShape => ({
  id,
  type: "rect",
  x: 2,
  y: 3,
  w: 4,
  h: 5,
  fill: "#111111",
  stroke: "none",
  strokeWidth: 0,
  alpha: 1,
  ...(group ? { group } : {}),
});

describe("M89b 分组导出", () => {
  it("同组相邻图形收进一个 <group android:name>，未分组的留在外面", () => {
    const shapes = [rect("a", "g1"), rect("b", "g1"), rect("c")];
    const m = shapesToModel(shapes, { ...META, groups: [G] });
    const xml = buildVectorXml(m, "ic_t");
    expect(xml).toContain('android:name="dots"');
    expect(xml).toContain('android:translateX="2"');
    expect(xml).toContain('android:translateY="-1"');
    // c 在组外：出现在 </group> 之后
    const close = xml.indexOf("</group>");
    const cAt = xml.indexOf('android:fillColor="#111111"', close);
    expect(close).toBeGreaterThan(0);
    expect(cAt).toBeGreaterThan(close);
  });

  it("组的旋转/缩放写进 group 属性，pivot 跟随", () => {
    const g: GroupSpec = { ...G, rot: 30, sx: 2, sy: 0.5 };
    const xml = buildVectorXml(shapesToModel([rect("a", "g1")], { ...META, groups: [g] }), "ic_t");
    expect(xml).toContain('android:rotation="30"');
    expect(xml).toContain('android:scaleX="2"');
    expect(xml).toContain('android:scaleY="0.5"');
    expect(xml).toContain('android:pivotX="6"');
  });

  it("没有 groups 时不产生额外 <group>（旧行为不变）", () => {
    const xml = buildVectorXml(shapesToModel([rect("a")], META), "ic_t");
    expect(xml).not.toContain("<group");
  });

  it("打开带 <group> 的图标 → 图元带分组 id，组参数读出来", () => {
    const src = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
      <group android:name="ring" android:scaleX="0.5" android:scaleY="0.5" android:pivotX="12" android:pivotY="12">
        <path android:fillColor="#111111" android:pathData="M2 2h20v20h-20z"/>
      </group>
      <path android:fillColor="#222222" android:pathData="M0 0h2v2h-2z"/>
    </vector>`;
    const model = parseVectorModel(src)!;
    const groups = groupsFromModel(model);
    const shapes = modelToShapes(model);
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe("ring");
    expect(groups[0].sx).toBe(0.5);
    expect(shapes.filter((s) => s.group).length).toBe(1);
    expect(shapes.filter((s) => !s.group).length).toBe(1);
  });

  it("打开→保存：带组的图标结构不丢", () => {
    const src = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
      <group android:name="ring" android:rotation="45" android:pivotX="12" android:pivotY="12">
        <path android:fillColor="#111111" android:pathData="M2 2h20v20h-20z"/>
      </group>
    </vector>`;
    const model = parseVectorModel(src)!;
    const meta = { ...META, groups: groupsFromModel(model) };
    const out = buildVectorXml(shapesToModel(modelToShapes(model), meta), "ic_ring");
    expect(out).toContain('android:name="ring"');
    expect(out).toContain('android:rotation="45"');
    expect(out).toContain('android:pathData="M2 2h20v20h-20z"');
  });
});

describe("M89b 组变换数学", () => {
  it("矩阵：平移 + 绕 pivot 缩放", () => {
    const m = groupMatrix({ ...G, rot: 0, sx: 2, sy: 2 });
    // 点 pivot 本身不动，只平移
    expect(m.a * 6 + m.c * 6 + m.e).toBeCloseTo(8, 6);
    expect(m.b * 6 + m.d * 6 + m.f).toBeCloseTo(5, 6);
  });

  it("逆变换来回一致", () => {
    const g: GroupSpec = { ...G, rot: 37, sx: 1.7, sy: 0.6 };
    const m = groupMatrix(g);
    const p = { x: 3.25, y: 9.5 };
    const back = invertMat(m, { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("恒等组不产生 transform 字符串", () => {
    expect(groupTransform({ ...G, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 })).toBeUndefined();
    expect(groupTransform({ ...G, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 })).toBeUndefined();
    expect(groupTransform({ ...G, rot: 90 })).toContain("rotate(90");
  });
});

describe("M89b 解组烘焙", () => {
  it("矩形：平移 + 等比缩放后位置尺寸正确", () => {
    const out = bakeGroupTransform(rect("a", "g1"), { ...G, sx: 2, sy: 2 }) as unknown as {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    // x: 2*(2-6)+6+2 = 0 ; y: 2*(3-6)+6-1 = -1
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(-1, 6);
    expect(out.w).toBeCloseTo(8, 6);
    expect(out.h).toBeCloseTo(10, 6);
  });

  it("圆：非等比缩放时自动变椭圆", () => {
    const c: DrawShape = {
      id: "c",
      type: "circle",
      cx: 10,
      cy: 10,
      r: 2,
      fill: "#111",
      stroke: "none",
      strokeWidth: 0,
      alpha: 1,
      group: "g1",
    };
    const out = bakeGroupTransform(c, { ...G, tx: 0, ty: 0, sx: 2, sy: 0.5 });
    expect(out.type).toBe("ellipse");
  });

  it("path：缩放 + 平移后 pathData 变了但仍是合法路径", () => {
    const p: DrawShape = {
      id: "p",
      type: "path",
      d: "M2 2h4v4h-4z",
      fill: "#111",
      stroke: "none",
      strokeWidth: 0,
      alpha: 1,
      group: "g1",
    };
    const out = bakeGroupTransform(p, { ...G, sx: 2, sy: 2 }) as Extract<DrawShape, { type: "path" }>;
    expect(out.d).not.toBe("M2 2h4v4h-4z");
    expect(out.d).not.toMatch(/NaN/);
  });
});
