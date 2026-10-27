// test/xml_m4i_bg_button.test.ts — background 属性的绘制：颜色 / shape / 位图 / 矢量 / backgroundTint
// 用户 2026-10-28 02:23：按钮的背景有没有真的按 android:background 画？
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import type { ResourceTable } from "../lib/xml/types";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function styleOf(xml: string, res: ResourceTable = DEFAULT_RESOURCES) {
  const { root } = parseLayoutXml(xml)!;
  const m = buildRenderModel(root!, res, 2, undefined, { w: 412, h: 892 });
  return m.root.style as Record<string, unknown>;
}

describe("M4i background 属性 → 画布绘制", () => {
  it("Button 纯色 background：#FF0000 就是红底（不是默认紫）", () => {
    const s = styleOf(
      `<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="#FFFF0000" android:text="OK"/>`,
    );
    expect(String(s.backgroundColor).toUpperCase()).toBe("#FF0000");
  });

  it("Button + shape drawable：用 shape 的 solid，不是灰色 #888888", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: {
        bg_btn: `<shape ${A}><solid android:color="#FF00C853"/><corners android:radius="12dp"/></shape>`,
      },
    };
    const s = styleOf(
      `<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="@drawable/bg_btn" android:text="OK"/>`,
      res,
    );
    expect(s.backgroundColor).toBe("#00C853");
    expect(s.borderRadius).toBe("24px"); // 12dp * 2
  });

  it("Button + 渐变 shape：渐变图，不叠灰色底", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: {
        bg_grad: `<shape ${A}><gradient android:startColor="#FF6750A4" android:endColor="#FF3F2E7A" android:angle="270"/><corners android:radius="8dp"/></shape>`,
      },
    };
    const s = styleOf(
      `<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="@drawable/bg_grad"/>`,
      res,
    );
    expect(String(s.backgroundImage)).toContain("linear-gradient");
    expect(s.backgroundColor).not.toBe("#888888");
  });

  it("Button + 位图 drawable：铺图（backgroundImage = url(...)）", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawables: { photo: "data:image/png;base64,AAAA" },
    };
    const s = styleOf(
      `<Button ${A} android:layout_width="80dp" android:layout_height="40dp" android:background="@drawable/photo"/>`,
      res,
    );
    expect(String(s.backgroundImage)).toContain("url(data:image/png;base64,AAAA)");
    expect(s.backgroundSize).toBe("100% 100%");
  });

  it("Button + vector drawable：转成 svg dataURL 铺图", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: {
        ic_dot: `<vector ${A} android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FF2196F3" android:pathData="M0,0h24v24h-24z"/></vector>`,
      },
    };
    const s = styleOf(
      `<Button ${A} android:layout_width="48dp" android:layout_height="48dp" android:background="@drawable/ic_dot"/>`,
      res,
    );
    expect(String(s.backgroundImage)).toContain("data:image/svg+xml");
  });

  it("background 引用了不存在的 drawable：不退化成灰块", () => {
    const s = styleOf(
      `<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:background="@drawable/nope"/>`,
    );
    expect(s.backgroundColor).not.toBe("#888888");
    expect(s.backgroundImage).toBeUndefined();
  });

  it("没写 background 的 Button 才用默认主色 #6750A4", () => {
    const s = styleOf(`<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="OK"/>`);
    expect(s.backgroundColor).toBe("#6750A4");
    expect(String(s.color).toUpperCase()).toBe("#FFFFFF");
  });

  it("app:backgroundTint 生效（MaterialButton 抠色）", () => {
    const s = styleOf(
      `<com.google.android.material.button.MaterialButton ${A} xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="wrap_content" android:layout_height="wrap_content" app:backgroundTint="#FFB3261E" android:text="删"/>`,
    );
    expect(String(s.backgroundColor).toUpperCase()).toBe("#B3261E");
  });

  it("CardView 的 background 也不会被默认白色覆盖", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      drawableXml: { bg_card2: `<shape ${A}><solid android:color="#FF123456"/></shape>` },
    };
    const s = styleOf(
      `<androidx.cardview.widget.CardView ${A} android:layout_width="200dp" android:layout_height="100dp" android:background="@drawable/bg_card2"><TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x"/></androidx.cardview.widget.CardView>`,
      res,
    );
    expect(s.backgroundColor).toBe("#123456");
  });
});
