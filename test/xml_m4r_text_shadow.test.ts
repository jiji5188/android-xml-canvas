// test/xml_m4r_text_shadow.test.ts — android:shadowColor（文字阴影）≠ elevation 阴影
// 用户 2026-10-28：还有 ShadowColor 属性没用上
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { ATTR_CATALOG } from "../components/attr-catalog";

const wrap = (inner: string) => `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">${inner}</LinearLayout>`;

function first(xml: string) {
  const m = buildRenderModel(parseLayoutXml(wrap(xml)).root!, DEFAULT_RESOURCES);
  return m.root.children[0];
}

describe("M4r 文字阴影 shadowColor", () => {
  it("shadowColor + Dx/Dy/Radius → textShadow（1dp=2px）", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="x" android:shadowColor="#80000000"
      android:shadowDx="2dp" android:shadowDy="3dp" android:shadowRadius="4dp" />`);
    expect(n.style.textShadow).toBe("4.0px 6.0px 8.0px rgba(0, 0, 0, 0.5)"); // #80000000 在 resolveColor 里已转成 rgba
  });

  it("只写 shadowColor 也能出阴影（偏移/模糊默认 0）", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="x" android:shadowColor="#FF0000" />`);
    expect(n.style.textShadow).toBe("0.0px 0.0px 0.0px #FF0000");
  });

  it("没写 shadowColor 就不出 textShadow（不污染其它控件）", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />`);
    expect(n.style.textShadow).toBeUndefined();
  });

  it("Button 上同样生效", () => {
    const n = first(`<Button android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="OK" android:shadowColor="#000000" android:shadowDy="1dp" />`);
    expect(String(n.style.textShadow)).toContain("#000000");
  });

  it("属性目录里有这四个（shadowColor 是 color，其余是 dimen）", () => {
    expect(ATTR_CATALOG.find((a) => a.name === "shadowColor")?.editor).toBe("color");
    for (const k of ["shadowDx", "shadowDy", "shadowRadius"]) {
      expect(ATTR_CATALOG.find((a) => a.name === k)?.editor).toBe("dimen");
    }
  });

  it("文字阴影不影响 elevation 的 boxShadow（两套互不干扰）", () => {
    const n = first(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="x" android:elevation="4dp" android:shadowColor="#FF0000" />`);
    expect(String(n.style.boxShadow)).toContain("rgba(0,0,0,0.20)");
    expect(String(n.style.textShadow)).toContain("#FF0000");
  });
});
