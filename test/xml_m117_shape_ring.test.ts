// M117：形状编辑器优化之 ring 基础形状（原生 shape="ring"）
import { describe, expect, it } from "vitest";
import {
  argbColorsForPreview,
  buildShapeXml,
  parseShapeSpec,
  shapeResourceName,
  specToCss,
  type ShapeSpec,
} from "../lib/xml/shape-gen";

describe("M117 ring shape 底层生成/反解析/预览", () => {
  it("buildShapeXml：ring 输出原生 <shape android:shape=\"ring\">", () => {
    const spec: ShapeSpec = {
      kind: "ring",
      solid: "#FF0000FF",
      ringHole: 0.5,
    };
    const xml = buildShapeXml(spec);
    expect(xml).toMatch(/<shape[^>]*android:shape="ring"/);
    expect(xml).toContain("android:innerRadiusRatio=");
    expect(xml).toContain("android:thicknessRatio=");
    expect(xml).not.toContain("<layer-list");
    expect(xml).not.toMatch(/\d+dpdp/);
  });

  it("parseShapeSpec：原生 ring 能反解析回 ring + 洞比例", () => {
    const spec: ShapeSpec = { kind: "ring", solid: "#FF123456", ringHole: 0.3 };
    const xml = buildShapeXml(spec);
    const parsed = parseShapeSpec(xml);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("ring");
    expect(parsed?.ringHole).toBeCloseTo(0.3, 1);
    expect(parsed?.solid).toBe("#FF123456");
  });

  it("parseShapeSpec：普通 shadow layer-list（双 item 但内层不是 inset oval）不误判成 ring", () => {
    // 手工构造：shadow 场景下 shadow 层 + 内容层都是 oval，但 item[1] 没有 insetLeft
    const xml = [
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">`,
      `  <item>`,
      `    <shape android:shape="oval"><solid android:color="#80000000"/></shape>`,
      `  </item>`,
      `  <item>`,
      `    <shape android:shape="oval"><solid android:color="#FFFF0000"/></shape>`,
      `  </item>`,
      `</layer-list>`,
    ].join("\n");
    const parsed = parseShapeSpec(xml);
    // 没有 insetLeft → 不走 ring 分支，走 shadow 分支（kind 仍是 oval）
    expect(parsed?.kind).toBe("oval");
    expect(parsed?.shadow).toBeDefined();
  });

  it("specToCss：ring 预览用 ellipse farthest-side 透明洞", () => {
    const spec: ShapeSpec = { kind: "ring", solid: "#FF0000FF", ringHole: 0.4 };
    const css = specToCss(argbColorsForPreview(spec));
    expect(css.background).toBeDefined();
    // 不能用 circle：宽扁盒子上 farthest-corner 会把洞撑出上下边，只剩两个月牙
    expect(css.background).toContain("radial-gradient(ellipse farthest-side");
    expect(css.borderRadius).toBe("50%");
    // 0.4 → 洞占比 40%，radial-gradient 色标也是 40%
    expect(css.background).toContain("40%");
  });

  it("shapeResourceName：ring 带 h 洞比例 + 无圆角后缀", () => {
    const spec: ShapeSpec = { kind: "ring", solid: "#FF123456", ringHole: 0.6 };
    const name = shapeResourceName(spec, []);
    expect(name).toMatch(/^bg_ring_h60$/);
  });

  it("ring + ripple：最外层仍是 ripple，里面才是 layer-list ring", () => {
    const spec: ShapeSpec = {
      kind: "ring",
      solid: "#FF123456",
      ringHole: 0.5,
      ripple: { color: "#33FFFFFF" },
    };
    const xml = buildShapeXml(spec);
    // ripple 是最外层
    expect(xml.startsWith("<ripple")).toBe(true);
    // 里面直接是原生 ring
    expect(xml).not.toContain("<layer-list");
    expect(xml).toMatch(/android:shape="ring"/);
    expect(xml).not.toMatch(/\d+dpdp/);
  });
});
