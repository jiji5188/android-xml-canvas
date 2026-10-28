// test/xml_m5c_inset.test.ts — M5c <inset> 进 ShapeEditor UI + 渲染
import { describe, it, expect } from "vitest";
import { buildShapeXml, parseShapeSpec, specToCss } from "../lib/xml/shape-gen";
import { parseShapeDrawable } from "../lib/xml/shape";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const INSET_XML = `<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="4dp" android:insetTop="6dp" android:insetRight="8dp" android:insetBottom="10dp">
  <shape android:shape="rectangle">
    <solid android:color="#FF2196F3" />
    <corners android:radius="12dp" />
  </shape>
</inset>`;

describe("M5c shape.ts：解析 inset 内缩", () => {
  it("解析出四边内缩 + 内层 shape 样式", () => {
    const st = parseShapeDrawable(INSET_XML, (c) => c);
    expect(st).not.toBeNull();
    expect(st!.insetDp).toEqual({ l: 4, t: 6, r: 8, b: 10 });
    expect(st!.solid).toBe("#FF2196F3");
    expect(st!.radiusDp).toBe(12);
  });

  it("普通 shape 没有 insetDp", () => {
    const st = parseShapeDrawable(`<shape><solid android:color="#FF0000"/></shape>`, (c) => c);
    expect(st!.insetDp).toBeUndefined();
  });

  it("inset 三边为 0 时不产生 insetDp（等价无内缩）", () => {
    const st = parseShapeDrawable(
      `<inset><shape><solid android:color="#FF0000"/></shape></inset>`,
      (c) => c
    );
    expect(st!.insetDp).toBeUndefined();
  });
});

describe("M5c shape-gen：UI 参数 ↔ XML 往返", () => {
  const spec = {
    kind: "rectangle" as const,
    solid: "#2196F3",
    radius: 12,
    inset: { l: 4, t: 6, r: 8, b: 10 },
  };

  it("buildShapeXml 生成 <inset> 外壳并带上四边属性", () => {
    const xml = buildShapeXml(spec);
    expect(xml).toContain("<inset");
    expect(xml).toContain('android:insetLeft="4dp"');
    expect(xml).toContain('android:insetTop="6dp"');
    expect(xml).toContain('android:insetRight="8dp"');
    expect(xml).toContain('android:insetBottom="10dp"');
    // 内层 shape 仍在
    expect(xml).toContain("<shape");
    expect(xml).toContain('android:color="#2196F3"');
  });

  it("parseShapeSpec 能把 inset 读回来（往返一致）", () => {
    const back = parseShapeSpec(buildShapeXml(spec));
    expect(back).not.toBeNull();
    expect(back!.inset).toEqual({ l: 4, t: 6, r: 8, b: 10 });
    expect(back!.solid).toBe("#2196F3");
    expect(back!.radius).toBe(12);
  });

  it("不设 inset 不生成外壳", () => {
    const xml = buildShapeXml({ kind: "rectangle", solid: "#FFFFFF", radius: 8 });
    expect(xml).not.toContain("<inset");
    expect(xml.trim().startsWith("<shape")).toBe(true);
  });

  it("specToCss 给预览输出 clip-path（含圆角）", () => {
    const css = specToCss(spec);
    expect(css.clipPath).toBe("inset(6px 8px 10px 4px round 12px)");
  });

  it("无 inset 时没有 clipPath", () => {
    expect(specToCss({ kind: "rectangle", solid: "#fff", radius: 8 }).clipPath).toBeUndefined();
  });
});

describe("M5c css：画布用独立背景层画内缩背景", () => {
  it("inset 背景不在节点上，而是 bgInset 层（不裁子控件）", () => {
    const root = parseLayoutXml(
      `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="@drawable/bg_inset" /></LinearLayout>`
    ).root!;
    const m = buildRenderModel(root, { ...DEFAULT_RESOURCES, drawableXml: { bg_inset: INSET_XML } });
    const n = m.root.children[0];
    expect(n.bgInset).toBeDefined();
    expect(n.bgInset).toMatchObject({ t: 6, r: 8, b: 10, l: 4 });
    expect(n.bgInset!.radius).toBe("24px"); // 12dp × scale 2
    // 节点自身不再画背景（否则会铺满整块，inset 就白做了）
    expect(n.style.backgroundColor).toBeUndefined();
    expect(n.style.borderRadius).toBeUndefined();
  });

  it("普通 shape 背景仍直接画在节点上（bgInset 为空）", () => {
    const root = parseLayoutXml(
      `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="@drawable/bg_plain" /></LinearLayout>`
    ).root!;
    const m = buildRenderModel(root, {
      ...DEFAULT_RESOURCES,
      drawableXml: {
        bg_plain: `<shape><solid android:color="#FF00C853"/><corners android:radius="8dp"/></shape>`,
      },
    });
    const n = m.root.children[0];
    expect(n.bgInset).toBeUndefined();
    expect(n.style.backgroundColor).toBe("#00C853");
    expect(n.style.borderRadius).toBe("16px");
  });
});
