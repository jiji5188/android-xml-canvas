import { describe, it, expect } from "vitest";
import { shapesToModel, modelToShapes, shapeBox, type DrawShape } from "@/lib/xml/canvas-shapes";
import { buildVectorXml } from "@/lib/xml/vector-edit";

const rect = (extra: Partial<DrawShape> = {}): DrawShape =>
  ({
    id: "a",
    type: "rect",
    x: 2,
    y: 2,
    w: 10,
    h: 10,
    fill: "#123456",
    stroke: "none",
    strokeWidth: 0,
    alpha: 1,
    ...extra,
  }) as DrawShape;

const meta = { w: 24, h: 24, vw: 24, vh: 24, group: { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 12, pivotY: 12 } };

describe("M88l 单图层旋转", () => {
  it("无 rot 时导出的 XML 与旧版一致（不进 group）", () => {
    const xml = buildVectorXml(shapesToModel([rect()], meta), "ic");
    expect(xml).not.toContain("<group");
    expect(xml).toContain('android:pathData="M2,2h10v10h-10Z"');
  });

  it("rot=15 时该 path 自己包一层 group，pivot 是包围盒中心", () => {
    const xml = buildVectorXml(shapesToModel([rect({ rot: 15 })], meta), "ic");
    expect(xml).toContain("<group");
    expect(xml).toContain('android:rotation="15"');
    expect(xml).toContain('android:pivotX="7"');
    expect(xml).toContain('android:pivotY="7"');
    // 属性块正常闭合（末位属性带 >）
    expect(xml).toMatch(/android:pivotY="7">/);
    expect(xml).toContain("</group>");
    // path 仍在 group 里面，缩进多一级
    expect(xml).toMatch(/<group[\s\S]*?android:pathData="M2,2h10v10h-10Z"[\s\S]*?<\/group>/);
  });

  it("rot=0 视为没有旋转", () => {
    const m = shapesToModel([rect({ rot: 0 })], meta);
    expect(m.paths[0].rotation).toBeUndefined();
    expect(buildVectorXml(m, "ic")).not.toContain("<group");
  });

  it("modelToShapes 读回 rotation → rot，再导出保持一致", () => {
    const m = shapesToModel([rect({ rot: -30 })], meta);
    const back = modelToShapes(m);
    expect((back[0] as { rot?: number }).rot).toBe(-30);
    const xml2 = buildVectorXml(shapesToModel(back, meta), "ic");
    expect(xml2).toContain('android:rotation="-30"');
  });

  it("多图层只有带 rot 的那层被包 group", () => {
    const xml = buildVectorXml(
      shapesToModel([rect({ id: "a" }), rect({ id: "b", x: 0, y: 0, rot: 90 })], meta),
      "ic",
    );
    expect(xml.match(/<group/g)?.length).toBe(1);
  });

  it("旋转不影响包围盒（框还是没转的框，方便拖拽/对齐）", () => {
    const b0 = shapeBox(rect());
    const b1 = shapeBox(rect({ rot: 45 }));
    expect(b1).toEqual(b0);
  });
});
