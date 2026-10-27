// test/xml_m3h_shape_gen.test.ts — M3h 自定义形状：生成 XML / 反解析 / ripple / 命名
import { describe, it, expect } from "vitest";
import {
  buildShapeXml,
  parseShapeSpec,
  shapeResourceName,
  specToCss,
  type ShapeSpec,
} from "../lib/xml/shape-gen";
import { parseShapeDrawable } from "../lib/xml/shape";
import { buildResBundle, missingDrawables } from "../lib/xml/bundle";

describe("M3h 生成 shape xml", () => {
  it("纯色 + 统一圆角", () => {
    const xml = buildShapeXml({ kind: "rectangle", solid: "#FFFFFF", radius: 16 });
    expect(xml).toContain('<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">');
    expect(xml).toContain('<solid android:color="#FFFFFF"/>');
    expect(xml).toContain('<corners android:radius="16dp"/>');
    expect(xml.trim().endsWith("</shape>")).toBe(true);
  });

  it("四角不同 → 逐角属性（不再写 radius）", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      solid: "#FFF",
      corners: { tl: 8, tr: 8, br: 0, bl: 0 },
    });
    expect(xml).toContain('android:topLeftRadius="8dp"');
    expect(xml).toContain('android:bottomRightRadius="0dp"');
    expect(xml).not.toContain('android:radius="');
  });

  it("椭圆不写 corners（靠 shape 属性）", () => {
    const xml = buildShapeXml({ kind: "oval", solid: "#123456" });
    expect(xml).toContain('android:shape="oval"');
    expect(xml).not.toContain("<corners");
  });

  it("描边 + 虚线", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      solid: "#FFFFFF",
      stroke: { width: 2, color: "#000000", dashWidth: 4, dashGap: 3 },
    });
    expect(xml).toContain('android:width="2dp"');
    expect(xml).toContain('android:dashWidth="4dp"');
    expect(xml).toContain('android:dashGap="3dp"');
  });

  it("线性渐变带角度，且不再输出 solid", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      gradient: { type: "linear", start: "#FF0000", end: "#0000FF", angle: 45 },
    });
    expect(xml).toContain('android:type="linear"');
    expect(xml).toContain('android:angle="45"');
    expect(xml).not.toContain("<solid");
  });

  it("径向渐变不写 angle", () => {
    const xml = buildShapeXml({ kind: "oval", gradient: { type: "radial", start: "#FFF", end: "#000" } });
    expect(xml).toContain('android:type="radial"');
    expect(xml).not.toContain("android:angle");
  });
});

describe("M3h ripple 包装", () => {
  it("生成 <ripple> 且内层 shape 缩进正确", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      solid: "#FFFFFF",
      radius: 12,
      ripple: { color: "#33FFFFFF" },
    });
    expect(xml.startsWith("<ripple")).toBe(true);
    expect(xml).toContain('android:color="#33FFFFFF"');
    expect(xml).toContain("    <item>");
    expect(xml).toContain('        <shape android:shape="rectangle">');
    expect(xml).toContain('            <solid android:color="#FFFFFF"/>');
    expect(xml.trim().endsWith("</ripple>")).toBe(true);
  });

  it("ripple 包在画布上仍能解析出形状（不能变成空背景）", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      solid: "#FF0000",
      radius: 10,
      ripple: { color: "#33FFFFFF" },
    });
    const style = parseShapeDrawable(xml, (c) => c);
    expect(style).not.toBeNull();
    expect(style!.solid).toBe("#FF0000");
    expect(style!.radiusDp).toBe(10);
  });

  it("ripple 形状也能在导出包里认出来（不缺引用）", () => {
    const xml = buildShapeXml({ kind: "rectangle", solid: "#FFF", ripple: { color: "#33000000" } });
    const layout = `<Button android:background="@drawable/bg_rect_ripple"/>`;
    const entries = buildResBundle({ layoutXml: layout, generatedDrawables: { bg_rect_ripple: xml } });
    expect(missingDrawables(layout, entries)).toEqual([]);
    expect(entries.find((e) => e.path === "drawable/bg_rect_ripple.xml")!.text).toContain("<ripple");
  });
});

describe("M3h 反解析（编辑已有形状）", () => {
  it("裸 shape 往返一致", () => {
    const spec: ShapeSpec = {
      kind: "rectangle",
      solid: "#FFFFFF",
      radius: 16,
      stroke: { width: 1, color: "#E0E0E0" },
    };
    const back = parseShapeSpec(buildShapeXml(spec));
    expect(back).toMatchObject({
      kind: "rectangle",
      solid: "#FFFFFF",
      radius: 16,
      stroke: { width: 1, color: "#E0E0E0" },
    });
  });

  it("四角 + 渐变 + ripple 往返一致", () => {
    const spec: ShapeSpec = {
      kind: "rectangle",
      gradient: { type: "linear", start: "#7C4DFF", end: "#00BCD4", angle: 90 },
      corners: { tl: 8, tr: 8, br: 0, bl: 0 },
      ripple: { color: "#33FFFFFF" },
    };
    const back = parseShapeSpec(buildShapeXml(spec));
    expect(back).toEqual(spec);
  });

  it("手写的外部 xml（带 inset/padding 这类没建模的标签）也不崩", () => {
    const xml = `<shape xmlns:android="http://schemas.android.com/apk/res/android">
      <padding android:left="8dp" android:top="4dp"/>
      <solid android:color="#FFFFFF"/>
      <corners android:radius="8dp"/>
    </shape>`;
    const back = parseShapeSpec(xml);
    expect(back).toMatchObject({ kind: "rectangle", solid: "#FFFFFF", radius: 8 });
  });

  it("vector / selector 里没有 shape → null", () => {
    expect(parseShapeSpec("<vector/>")).toBeNull();
    expect(parseShapeSpec(`<selector><item android:drawable="@drawable/x"/></selector>`)).toBeNull();
  });
});

describe("M3h 资源命名", () => {
  it("按形状/圆角/水波纹起名", () => {
    expect(shapeResourceName({ kind: "rectangle", radius: 16 }, [])).toBe("bg_rect_r16");
    expect(shapeResourceName({ kind: "oval" }, [])).toBe("bg_oval");
    expect(shapeResourceName({ kind: "rectangle", radius: 8, ripple: { color: "#33000000" } }, [])).toBe(
      "bg_rect_r8_ripple",
    );
  });

  it("重名自动加 _2 / _3", () => {
    const spec: ShapeSpec = { kind: "rectangle", radius: 12 };
    expect(shapeResourceName(spec, ["bg_rect_r12"])).toBe("bg_rect_r12_2");
    expect(shapeResourceName(spec, ["bg_rect_r12", "bg_rect_r12_2"])).toBe("bg_rect_r12_3");
  });
});

describe("M3h 预览 CSS 与画布语义一致", () => {
  it("圆角/描边/纯色", () => {
    const css = specToCss({ kind: "rectangle", solid: "#FFF", radius: 12, stroke: { width: 1, color: "#000" } });
    expect(css.background).toBe("#FFF");
    expect(css.borderRadius).toBe("12px");
    expect(css.border).toBe("1px solid #000");
  });

  it("椭圆 → 50%", () => {
    expect(specToCss({ kind: "oval", solid: "#FFF" }).borderRadius).toBe("50%");
  });

  it("渐变角度按 Android 语义换算（90° = 下→上 = CSS 0deg）", () => {
    const css = specToCss({ kind: "rectangle", gradient: { type: "linear", start: "#000", end: "#FFF", angle: 90 } });
    expect(css.background).toBe("linear-gradient(0deg, #000, #FFF)");
  });

  it("虚线描边", () => {
    const css = specToCss({ kind: "rectangle", stroke: { width: 2, color: "#000", dashWidth: 4, dashGap: 2 } });
    expect(css.border).toBe("2px dashed #000");
  });
});
