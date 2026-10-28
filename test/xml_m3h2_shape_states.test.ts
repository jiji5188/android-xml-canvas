// test/xml_m3h2_shape_states.test.ts — M3h-2 第二批：selector 按下/禁用、layer-list 阴影、inset
import { describe, it, expect } from "vitest";
import { buildShapeXml, parseShapeSpec, specToCss, shapeResourceName, type ShapeSpec } from "../lib/xml/shape-gen";
import { parseShapeDrawable } from "../lib/xml/shape";

describe("M3h-2 selector 交互态", () => {
  const spec: ShapeSpec = {
    kind: "rectangle",
    solid: "#FFFFFF",
    radius: 12,
    states: { pressed: "#E8E8E8", disabled: "#F5F5F5" },
  };

  it("生成 <selector>，按下/禁用/常态三个 item", () => {
    const xml = buildShapeXml(spec);
    expect(xml.startsWith('<selector xmlns:android=')).toBe(true);
    expect(xml).toContain('<item android:state_pressed="true">');
    expect(xml).toContain('<item android:state_enabled="false">');
    expect(xml).toContain('android:color="#E8E8E8"');
    expect(xml).toContain('android:color="#F5F5F5"');
    // 常态 item 不带 state 属性，且排最后（Android 按顺序匹配，兜底要最后）
    const items = xml.split("<item").slice(1);
    expect(items[items.length - 1]).not.toContain("state_");
  });

  it("按下/禁用态继承圆角（同一 shape 结构）", () => {
    const xml = buildShapeXml(spec);
    // 三个 shape 各自带 corners
    expect((xml.match(/<corners android:radius="12dp"\/>/g) ?? []).length).toBe(3);
  });

  it("画布预览取常态色（不能用按下色）", () => {
    const style = parseShapeDrawable(buildShapeXml(spec), (c) => c);
    expect(style).not.toBeNull();
    expect(style!.solid).toBe("#FFFFFF");
    expect(style!.radiusDp).toBe(12);
  });

  it("往返一致", () => {
    expect(parseShapeSpec(buildShapeXml(spec))).toEqual(spec);
  });

  it("只有按下态也能工作", () => {
    const s: ShapeSpec = { kind: "rectangle", solid: "#FFF", states: { pressed: "#DDD" } };
    const back = parseShapeSpec(buildShapeXml(s));
    expect(back?.states).toEqual({ pressed: "#DDD" });
  });
});

describe("M3h-2 layer-list 阴影层", () => {
  const spec: ShapeSpec = {
    kind: "rectangle",
    solid: "#FFFFFF",
    radius: 16,
    shadow: { dx: 0, dy: 4, blur: 0, color: "#1F000000" },
  };

  it("生成 layer-list：阴影层在前，内容层在后", () => {
    const xml = buildShapeXml(spec);
    expect(xml.startsWith('<layer-list xmlns:android=')).toBe(true);
    expect(xml).toContain('android:top="4dp"');
    expect(xml).toContain('android:color="#1F000000"');
    // 内容层必须是最后一个 item（顶层）
    const items = xml.split("<item").slice(1);
    expect(items[items.length - 1]).toContain('android:color="#FFFFFF"');
  });

  it("水平偏移 dx>0 → left 负值", () => {
    const xml = buildShapeXml({ kind: "rectangle", solid: "#FFF", shadow: { dx: 3, dy: 0, blur: 0, color: "#22000000" } });
    expect(xml).toContain('android:left="-3dp"');
  });

  it("画布预览取顶层内容形状 + 带上阴影", () => {
    const style = parseShapeDrawable(buildShapeXml(spec), (c) => c);
    expect(style!.solid).toBe("#FFFFFF");
    expect(style!.radiusDp).toBe(16);
    expect(style!.shadow).toMatchObject({ dy: 4, color: "#1F000000" });
  });

  it("往返一致", () => {
    const back = parseShapeSpec(buildShapeXml(spec));
    expect(back).toEqual(spec);
  });

  it("命名带 shadow", () => {
    expect(shapeResourceName({ kind: "rectangle", radius: 16, shadow: { dx: 0, dy: 2, blur: 0, color: "#22000000" } })).toBe(
      "bg_rect_r16_shadow",
    );
  });
});

describe("M3h-2 inset", () => {
  const spec: ShapeSpec = { kind: "rectangle", solid: "#FFF", inset: { l: 2, t: 2, r: 2, b: 2 } };

  it("生成 <inset> 包裹", () => {
    const xml = buildShapeXml(spec);
    expect(xml.startsWith('<inset xmlns:android=')).toBe(true);
    // M5c 修正：标准属性名是 insetLeft / insetTop（旧版本误写成 insetL / insetT）
    expect(xml).toContain('android:insetLeft="2dp"');
    expect(xml).toContain('android:insetTop="2dp"');
  });

  it("画布预览等于内层形状", () => {
    const style = parseShapeDrawable(buildShapeXml(spec), (c) => c);
    expect(style!.solid).toBe("#FFF");
  });

  it("往返一致", () => {
    expect(parseShapeSpec(buildShapeXml(spec))).toEqual(spec);
  });
});

describe("M3h-2 组合：ripple + selector + shadow", () => {
  const spec: ShapeSpec = {
    kind: "rectangle",
    solid: "#FFFFFF",
    radius: 10,
    shadow: { dx: 0, dy: 2, blur: 0, color: "#14000000" },
    states: { pressed: "#EEEEEE" },
    ripple: { color: "#33FFFFFF" },
  };

  it("嵌套顺序 ripple > selector > layer-list > shape", () => {
    const xml = buildShapeXml(spec);
    const iRipple = xml.indexOf("<ripple");
    const iSelector = xml.indexOf("<selector");
    const iLayer = xml.indexOf("<layer-list");
    const iShape = xml.indexOf("<shape");
    expect(iRipple).toBeGreaterThanOrEqual(0);
    expect(iRipple).toBeLessThan(iSelector);
    expect(iSelector).toBeLessThan(iLayer);
    // 内容层（含按下态里的 shape）一定在 layer-list 之后
    const iContent = xml.lastIndexOf("<shape");
    expect(iLayer).toBeLessThan(iContent);
  });

  it("组合结构也能往返", () => {
    expect(parseShapeSpec(buildShapeXml(spec))).toEqual(spec);
  });

  it("预览 CSS 同时有背景、圆角、阴影", () => {
    const css = specToCss(spec);
    expect(css.background).toBe("#FFFFFF");
    expect(css.borderRadius).toBe("10px");
    expect(css.boxShadow).toContain("#14000000");
  });
});
