// test/xml_m4s_src_layer.test.ts — src 用 <img> 内容层画在 background 之上（M4s）
// 用户 2026-10-28：ImageView 没正确绘制 src；background 在下、src 在上（ImageButton 同理）
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function first(xml: string) {
  const m = buildRenderModel(
    parseLayoutXml(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="match_parent">${xml}</LinearLayout>`).root!,
    { ...DEFAULT_RESOURCES, drawables: { pic: PNG } },
  );
  return m.root.children[0];
}

describe("M4s src 画在上层（不占 background）", () => {
  it("src 不再写进 style.backgroundImage（否则会和 background 抢同一层）", () => {
    const n = first(`<ImageView android:src="@drawable/pic" android:background="#123456"
      android:layout_width="48dp" android:layout_height="48dp" />`);
    expect(n.imgSrc).toContain("data:image/png");
    expect(n.style.backgroundImage).toBeUndefined();
    // background 还在下面画着
    expect(n.style.backgroundColor).toBe("#123456");
  });

  it("ImageButton 走同样的路径", () => {
    const n = first(`<ImageButton android:src="@drawable/pic" android:background="#654321"
      android:layout_width="48dp" android:layout_height="48dp" />`);
    expect(n.className).toBe("axv-image");
    expect(n.imgSrc).toContain("data:image/png");
    expect(n.style.backgroundImage).toBeUndefined();
    expect(n.style.backgroundColor).toBe("#654321");
  });

  it("scaleType → object-fit（fitXY=fill / centerCrop=cover / center=none）", () => {
    expect(first(`<ImageView android:src="@drawable/pic" android:scaleType="fitXY"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgFit).toBe("fill");
    expect(first(`<ImageView android:src="@drawable/pic" android:scaleType="centerCrop"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgFit).toBe("cover");
    expect(first(`<ImageView android:src="@drawable/pic" android:scaleType="center"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgFit).toBe("none");
    expect(first(`<ImageView android:src="@drawable/pic"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgFit).toBe("contain");
  });

  it("tint 颜色透传给画布层（mask 用）", () => {
    const n = first(`<ImageView android:src="@drawable/pic" android:tint="#FF0000"
      android:layout_width="48dp" android:layout_height="48dp" />`);
    expect(n.imgTint).toBe("#FF0000");
  });

  it("纯色 src / 缺失 src 仍然走占位（不进 imgSrc）", () => {
    expect(first(`<ImageView android:src="#123456"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgSrc).toBeUndefined();
    expect(first(`<ImageView android:src="@drawable/none"
      android:layout_width="48dp" android:layout_height="48dp" />`).imgSrc).toBeUndefined();
  });
});
