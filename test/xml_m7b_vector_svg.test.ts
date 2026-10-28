// test/xml_m7b_vector_svg.test.ts — 矢量 SVG 导出里的纯函数（不依赖 DOM）
import { describe, expect, it } from "vitest";
import {
  parseGradient,
  parseRadius,
  parseShadow,
  roundedRectPath,
  splitTopLevel,
  svgColor,
} from "../lib/xml/export-svg";

describe("splitTopLevel", () => {
  it("按顶层逗号切，括号内不切", () => {
    expect(splitTopLevel("rgba(0,0,0,.2) 0px 2px, #fff 100%")).toEqual(["rgba(0,0,0,.2) 0px 2px", " #fff 100%"]);
  });
});

describe("parseGradient", () => {
  it("解析 linear-gradient 角度与色标", () => {
    const g = parseGradient("linear-gradient(180deg, #ffffff 0%, #000000 100%)");
    expect(g?.type).toBe("linear");
    expect(g?.angle).toBe(180);
    expect(g?.stops).toEqual([
      { color: "#ffffff", offset: 0 },
      { color: "#000000", offset: 100 },
    ]);
  });

  it("无角度时默认 to bottom(180deg)", () => {
    expect(parseGradient("linear-gradient(#fff, #000)")?.angle).toBe(180);
  });

  it("to right 换算成 90deg", () => {
    expect(parseGradient("linear-gradient(to right, #fff 0%, #000 100%)")?.angle).toBe(90);
  });

  it("rgb() 里的逗号不会被当成色标分隔", () => {
    const g = parseGradient("linear-gradient(90deg, rgb(255, 0, 0) 0%, rgba(0, 0, 0, 0.5) 50%)");
    expect(g?.stops).toHaveLength(2);
    expect(g?.stops[1].color).toBe("rgba(0, 0, 0, 0.5)");
    expect(g?.stops[1].offset).toBe(50);
  });

  it("radial 类型", () => {
    expect(parseGradient("radial-gradient(circle, #fff 0%, #000 100%)")?.type).toBe("radial");
  });

  it("非渐变或色标不足返回 null", () => {
    expect(parseGradient("none")).toBeNull();
    expect(parseGradient("linear-gradient(#fff)")).toBeNull();
  });
});

describe("parseRadius", () => {
  it("1/2/3/4 值按 CSS 顺序展开成四角", () => {
    expect(parseRadius("8px")).toEqual([8, 8, 8, 8]);
    expect(parseRadius("8px 4px")).toEqual([8, 4, 8, 4]);
    expect(parseRadius("8px 4px 2px")).toEqual([8, 4, 2, 4]);
    expect(parseRadius("8px 4px 2px 0px")).toEqual([8, 4, 2, 0]);
  });

  it("非 px 值返回 null", () => {
    expect(parseRadius("50%")).toBeNull();
    expect(parseRadius("")).toBeNull();
  });
});

describe("parseShadow", () => {
  it("解析 rgba 阴影", () => {
    const s = parseShadow("rgba(0, 0, 0, 0.2) 0px 2px 6px 0px");
    expect(s).toEqual({ dx: 0, dy: 2, blur: 6, color: "rgb(0,0,0)", opacity: 0.2 });
  });

  it("多层只取第一层", () => {
    const s = parseShadow("rgba(0,0,0,.1) 0px 1px 2px 0px, rgba(0,0,0,.2) 0px 4px 8px 0px");
    expect(s?.dy).toBe(1);
    expect(s?.blur).toBe(2);
  });

  it("none / 数字不够返回 null", () => {
    expect(parseShadow("none")).toBeNull();
    expect(parseShadow("0px 1px")).toBeNull();
  });
});

describe("svgColor", () => {
  it("rgba 拆成 color + opacity", () => {
    expect(svgColor("rgba(103, 80, 164, 0.5)")).toEqual({ color: "rgb(103,80,164)", opacity: 0.5 });
  });

  it("hex 与关键字原样保留", () => {
    expect(svgColor("#1a73e8")).toEqual({ color: "#1a73e8", opacity: 1 });
    expect(svgColor("white")).toEqual({ color: "white", opacity: 1 });
  });

  it("transparent 变成零透明度", () => {
    expect(svgColor("transparent")).toEqual({ color: "#000000", opacity: 0 });
  });

  it("解析不了返回 null", () => {
    expect(svgColor("")).toBeNull();
    expect(svgColor("var(--x)")).toBeNull();
  });
});

describe("roundedRectPath", () => {
  it("零圆角退化成矩形路径", () => {
    expect(roundedRectPath(0, 0, 10, 10, [0, 0, 0, 0])).toBe("M0,0 H10 V10 H0 V0 Z");
  });

  it("四角圆角生成弧线", () => {
    const d = roundedRectPath(0, 0, 20, 20, [4, 4, 4, 4]);
    expect(d.match(/A4,4/g)).toHaveLength(4);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("圆角被钳制到短边一半以内", () => {
    const d = roundedRectPath(0, 0, 10, 6, [99, 99, 99, 99]);
    expect(d).toContain("A3,3");
  });
});
