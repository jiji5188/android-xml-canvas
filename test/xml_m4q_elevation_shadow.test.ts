// test/xml_m4q_elevation_shadow.test.ts — elevation 阴影颜色 + Button 默认样式 + ImageButton 组件
// 用户 2026-10-28：① 所有控件都有 elevation 吗 ② 阴影颜色能不能定义
//                 ③ 组件面板缺 ImageButton ④ Button 默认有内边距、文字居中
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { WIDGET_MAP, WIDGETS } from "../components/widget-catalog";
import { ATTR_CATALOG } from "../components/attr-catalog";

const wrap = (inner: string) => `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">${inner}</LinearLayout>`;

function first(xml: string) {
  const m = buildRenderModel(parseLayoutXml(wrap(xml)).root!, DEFAULT_RESOURCES);
  return m.root.children[0];
}

describe("M4q elevation 阴影颜色", () => {
  it("任意控件写 elevation 都会出阴影（elevation 是 View 基类属性）", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:elevation="4dp" android:text="x" />`);
    expect(String(n.style.boxShadow)).toContain("rgba(0,0,0,0.20)");
    expect(Number(n.style.zIndex)).toBeGreaterThan(1);
  });

  it("outlineSpotShadowColor / outlineAmbientShadowColor 能改阴影颜色", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:elevation="8dp"
      android:outlineSpotShadowColor="#FF0000"
      android:outlineAmbientShadowColor="#00FF00"
      android:text="x" />`);
    const s = String(n.style.boxShadow);
    expect(s).toContain("rgba(255,0,0,0.20)");
    expect(s).toContain("rgba(0,255,0,0.10)");
  });

  it("只写一个也算数，另一个保持默认黑", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:elevation="4dp" android:outlineSpotShadowColor="#0000FF" android:text="x" />`);
    const s = String(n.style.boxShadow);
    expect(s).toContain("rgba(0,0,255,0.20)");
    expect(s).toContain("rgba(0,0,0,0.10)");
  });

  it("属性目录里有这两个阴影颜色", () => {
    expect(ATTR_CATALOG.find((a) => a.name === "outlineSpotShadowColor")?.editor).toBe("color");
    expect(ATTR_CATALOG.find((a) => a.name === "outlineAmbientShadowColor")?.editor).toBe("color");
  });
});

describe("M4q Button 默认样式 / ImageButton 组件", () => {
  it("Button 默认：88dp 最小宽、48dp 最小高、左右 16dp 内边距、文字居中", () => {
    const n = first(`<Button android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="OK" />`);
    expect(n.style.minWidth).toBe("176px"); // 88dp @2x
    expect(n.style.minHeight).toBe("96px"); // 48dp @2x
    expect(n.style.paddingLeft).toBe("32px");
    expect(n.style.paddingRight).toBe("32px");
    expect(n.style.textAlign).toBe("center");
    expect(n.style.justifyContent).toBe("center");
  });

  it("显式写了 padding 就听 XML 的，不被默认值覆盖", () => {
    const n = first(`<Button android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:paddingLeft="4dp" android:text="OK" />`);
    expect(n.style.paddingLeft).toBe("8px");
  });

  it("组件面板有 ImageButton（图片按钮 / 图标按钮）", () => {
    expect(WIDGET_MAP["imgbtn"]?.tag).toBe("ImageButton");
    expect(WIDGET_MAP["iconbtn"]?.tag).toBe("ImageButton");
    const inGroup = WIDGETS.filter((w) => w.tag === "ImageButton");
    expect(inGroup.length).toBeGreaterThanOrEqual(2);
    // ImageButton 的模板能被解析
    for (const w of inGroup) {
      expect(parseLayoutXml(w.xml).issues.filter((i) => i.level === "error")).toEqual([]);
    }
  });
});
