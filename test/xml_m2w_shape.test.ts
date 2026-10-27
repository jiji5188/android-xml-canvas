// M2w：shape drawable（渐变 / 圆角 / 描边 / oval）解析与渲染
import { describe, expect, it } from "vitest";
import { parseShapeDrawable, androidAngleToCss } from "../lib/xml/shape";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import type { ResourceTable } from "../lib/xml/types";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const color = (raw: string) => (raw.startsWith("@color/") ? `#${raw.slice(7)}` : raw);

describe("M2w shape drawable", () => {
  it("solid + corners → 纯色 + 圆角", () => {
    const s = parseShapeDrawable(
      `<shape ${A} android:shape="rectangle">
         <solid android:color="#FF6750A4" />
         <corners android:radius="12dp" />
       </shape>`,
      color,
    )!;
    expect(s.solid).toBe("#FF6750A4");
    expect(s.radiusDp).toBe(12);
  });

  it("gradient linear：角度换成 CSS 角度，颜色引用可解析", () => {
    const s = parseShapeDrawable(
      `<shape ${A}><gradient android:startColor="@color/FF0000" android:endColor="#0000FF" android:angle="0" /></shape>`,
      color,
    )!;
    expect(s.gradient).toContain("linear-gradient(90deg");
    expect(s.gradient).toContain("#FF0000");
    expect(s.gradient).toContain("#0000FF");
  });

  it("gradient 带 centerColor → 三段色标", () => {
    const s = parseShapeDrawable(
      `<shape ${A}><gradient android:startColor="#111111" android:centerColor="#222222" android:endColor="#333333" /></shape>`,
      color,
    )!;
    expect(s.gradient).toContain("#111111");
    expect(s.gradient).toContain("#222222");
    expect(s.gradient).toContain("#333333");
  });

  it("gradient radial / sweep → 对应 CSS 函数", () => {
    const radial = parseShapeDrawable(
      `<shape ${A}><gradient android:type="radial" android:startColor="#000" android:endColor="#fff" /></shape>`,
      color,
    )!;
    expect(radial.gradient).toContain("radial-gradient(circle");
    // 少于两色 → 不生成渐变
    const none = parseShapeDrawable(`<shape ${A}><gradient android:startColor="#000" /></shape>`, color);
    expect(none!.gradient).toBeUndefined();
  });

  it("oval → oval 标记；line → line 标记", () => {
    expect(parseShapeDrawable(`<shape ${A} android:shape="oval" />`, color)!.oval).toBe(true);
    expect(parseShapeDrawable(`<shape ${A} android:shape="line" />`, color)!.line).toBe(true);
  });

  it("corners 四角独立", () => {
    const s = parseShapeDrawable(
      `<shape ${A}><corners android:topLeftRadius="4dp" android:bottomRightRadius="16dp" /></shape>`,
      color,
    )!;
    expect(s.cornersDp).toEqual({ tl: 4, tr: 0, br: 16, bl: 0 });
  });

  it("stroke → 宽度与颜色", () => {
    const s = parseShapeDrawable(
      `<shape ${A}><stroke android:width="1dp" android:color="@color/CCCCCC" /></shape>`,
      color,
    )!;
    expect(s.strokeDp).toBe(1);
    expect(s.strokeColor).toBe("#CCCCCC");
  });

  it("非 shape（vector）→ null", () => {
    expect(parseShapeDrawable(`<vector ${A} />`, color)).toBeNull();
  });

  it("androidAngleToCss：0→90、90→0、45→45", () => {
    expect(androidAngleToCss(0)).toBe(90);
    expect(androidAngleToCss(90)).toBe(0);
    expect(androidAngleToCss(45)).toBe(45);
    expect(androidAngleToCss(270)).toBe(180);
  });

  it("端到端：background=@drawable/bg_card 渲染成渐变 + 圆角 + 描边", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: {
        bg_card: `<shape ${A}><gradient android:startColor="#FF6750A4" android:endColor="#FF3F2E7A" android:angle="270"/><corners android:radius="16dp"/><stroke android:width="1dp" android:color="#FFB0AEB8"/></shape>`,
      },
    };
    const { root } = parseLayoutXml(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content"
          android:background="@drawable/bg_card" />`,
    )!;
    const m = buildRenderModel(root!, res, 2, undefined, { w: 412, h: 892 });
    expect(String(m.root.style.backgroundImage)).toContain("linear-gradient");
    expect(m.root.style.borderRadius).toBe("32px"); // 16dp * 2
    expect(m.root.style.border).toBe("2px solid #B0AEB8"); // ARGB 8 位已转成 RGB
  });

  it("端到端：oval 背景 → 50% 圆角", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: { circle: `<shape ${A} android:shape="oval"><solid android:color="#FF112233"/></shape>` },
    };
    const { root } = parseLayoutXml(
      `<View ${A} android:layout_width="48dp" android:layout_height="48dp" android:background="@drawable/circle" />`,
    )!;
    const m = buildRenderModel(root!, res, 2, undefined, { w: 412, h: 892 });
    expect(m.root.style.borderRadius).toBe("50%");
    expect(m.root.style.backgroundColor).toBe("#112233");
  });

  it("未上传 drawable xml 时不影响原纯色背景", () => {
    const { root } = parseLayoutXml(
      `<View ${A} android:layout_width="10dp" android:layout_height="10dp" android:background="#FF00FF00" />`,
    )!;
    const m = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 });
    expect(m.root.style.backgroundColor).toBe("#00FF00");
    expect(m.root.style.backgroundImage).toBeUndefined();
  });
});
