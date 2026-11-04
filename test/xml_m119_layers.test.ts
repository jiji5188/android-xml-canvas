// M119：形状绘制 —— layer-list 图层（build / parse 双向）
import { describe, expect, it } from "vitest";
import { buildShapeXml, parseShapeSpec, type ShapeSpec } from "@/lib/xml/shape-gen";

describe("M119 图层：buildShapeXml", () => {
  it("两层：按数组顺序从底到顶写 item", () => {
    const spec: ShapeSpec = {
      kind: "rectangle",
      solid: "#FFFFFFFF",
      layers: [
        { spec: { kind: "oval", solid: "#FF0000FF" } },
        { spec: { kind: "rectangle", solid: "#FF00FF00", radius: 8 } },
      ],
    };
    const xml = buildShapeXml(spec);
    expect(xml).toContain("<layer-list");
    const first = xml.indexOf("#FF0000FF");
    const second = xml.indexOf("#FF00FF00");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first); // 数组第一个先写 = 画在底层
    expect(xml.match(/<item/g)?.length).toBe(2);
    // 根节点只声明一次 xmlns
    expect(xml.match(/xmlns:android/g)?.length).toBe(1);
  });

  it("item 偏移 / 尺寸 / 透明度 / gravity 都写出去", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      layers: [
        {
          spec: { kind: "rectangle", solid: "#FF112233" },
          item: { left: 4, top: 6, right: 8, bottom: 10, width: 20, height: 30, alpha: 0.5, gravity: "center" },
        },
      ],
    });
    expect(xml).toContain('android:left="4dp"');
    expect(xml).toContain('android:top="6dp"');
    expect(xml).toContain('android:right="8dp"');
    expect(xml).toContain('android:bottom="10dp"');
    expect(xml).toContain('android:width="20dp"');
    expect(xml).toContain('android:height="30dp"');
    expect(xml).toContain('android:alpha="0.5"');
    expect(xml).toContain('android:gravity="center"');
  });

  it("阴影 + 图层：阴影层在最底，内容层由图层提供，不再补一个多余 item", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      solid: "#FFFFFFFF",
      shadow: { dx: 0, dy: 4, blur: 6, color: "#1F000000" },
      layers: [
        { spec: { kind: "rectangle", solid: "#FF111111" } },
        { spec: { kind: "rectangle", solid: "#FF222222" } },
      ],
    });
    expect(xml.match(/<item/g)?.length).toBe(3);
    const shadowAt = xml.indexOf("#1F000000");
    const l1 = xml.indexOf("#FF111111");
    const l2 = xml.indexOf("#FF222222");
    expect(shadowAt).toBeLessThan(l1);
    expect(l1).toBeLessThan(l2);
  });

  it("图层里的包装器字段被剥掉（不允许层内套 selector / ripple）", () => {
    const xml = buildShapeXml({
      kind: "rectangle",
      layers: [
        {
          spec: {
            kind: "rectangle",
            solid: "#FFABCDEF",
            ripple: { color: "#33FFFFFF" },
            states: { pressed: "#FF000000" },
            shadow: { dx: 0, dy: 2, blur: 2, color: "#33000000" },
          },
        },
      ],
    });
    expect(xml).toContain("#FFABCDEF");
    expect(xml).not.toContain("<selector");
    expect(xml).not.toContain("<ripple");
    expect(xml.match(/<layer-list/g)?.length).toBe(1);
  });
});

describe("M119 图层：parseShapeSpec", () => {
  it("反解析出 layers（顺序、颜色、偏移都在）", () => {
    const xml = [
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">`,
      `  <item android:left="4dp" android:right="4dp">`,
      `    <shape android:shape="oval"><solid android:color="#FF0000FF"/></shape>`,
      `  </item>`,
      `  <item android:alpha="0.6">`,
      `    <shape android:shape="rectangle"><corners android:radius="8dp"/><solid android:color="#FF00FF00"/></shape>`,
      `  </item>`,
      `</layer-list>`,
    ].join("\n");
    const parsed = parseShapeSpec(xml);
    expect(parsed?.layers?.length).toBe(2);
    expect(parsed?.layers?.[0].spec.kind).toBe("oval");
    expect(parsed?.layers?.[0].spec.solid).toBe("#FF0000FF");
    expect(parsed?.layers?.[0].item).toEqual({ left: 4, right: 4 });
    expect(parsed?.layers?.[1].spec.radius).toBe(8);
    expect(parsed?.layers?.[1].item).toEqual({ alpha: 0.6 });
  });

  it("build → parse → build 稳定（写出去再读回来不变）", () => {
    const spec: ShapeSpec = {
      kind: "rectangle",
      layers: [
        { spec: { kind: "oval", solid: "#FF0000FF" }, item: { left: 2, bottom: 3 } },
        { spec: { kind: "ring", solid: "#FF00FF00", ringHole: 0.5 }, item: { alpha: 0.4 } },
      ],
    };
    const once = buildShapeXml(spec);
    const back = parseShapeSpec(once);
    expect(back).not.toBeNull();
    const twice = buildShapeXml(back!);
    expect(twice).toBe(once);
  });

  it("旧阴影写法（2 层 + 第一层带 left/top）仍识别为 shadow，不当成图层", () => {
    const xml = [
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">`,
      `  <item android:left="2dp" android:top="4dp">`,
      `    <shape android:shape="rectangle"><solid android:color="#33000000"/></shape>`,
      `  </item>`,
      `  <item>`,
      `    <shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape>`,
      `  </item>`,
      `</layer-list>`,
    ].join("\n");
    const parsed = parseShapeSpec(xml);
    expect(parsed?.shadow).toBeDefined();
    expect(parsed?.shadow?.dy).toBe(4);
    expect(parsed?.layers).toBeUndefined();
    expect(parsed?.solid).toBe("#FFFFFFFF");
  });

  it("无偏移的两层 layer-list = 两层图层（不是阴影）", () => {
    const xml = [
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">`,
      `  <item><shape android:shape="oval"><solid android:color="#80000000"/></shape></item>`,
      `  <item><shape android:shape="oval"><solid android:color="#FFFF0000"/></shape></item>`,
      `</layer-list>`,
    ].join("\n");
    const parsed = parseShapeSpec(xml);
    expect(parsed?.shadow).toBeUndefined();
    expect(parsed?.layers?.length).toBe(2);
    expect(parsed?.layers?.[1].spec.solid).toBe("#FFFF0000");
  });

  it("图层 + 外层 ripple / selector 能被还原", () => {
    const spec: ShapeSpec = {
      kind: "rectangle",
      ripple: { color: "#33FFFFFF" },
      layers: [{ spec: { kind: "rectangle", solid: "#FF123456", radius: 6 } }],
    };
    const parsed = parseShapeSpec(buildShapeXml(spec));
    expect(parsed?.ripple?.color).toBe("#33FFFFFF");
    expect(parsed?.layers?.length).toBe(1);
    expect(parsed?.layers?.[0].spec.radius).toBe(6);
  });
});
