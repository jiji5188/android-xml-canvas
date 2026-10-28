// M4z：scaleType 完整映射（fitStart/fitEnd 对齐、matrix 近似）
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function first(xml: string) {
  const m = buildRenderModel(
    parseLayoutXml(
      `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
        android:layout_width="match_parent" android:layout_height="match_parent">${xml}</LinearLayout>`
    ).root!,
    { ...DEFAULT_RESOURCES, drawables: { pic: PNG } }
  );
  return m.root.children[0];
}

const pic =
  '<ImageView android:src="@drawable/pic" android:layout_width="48dp" android:layout_height="48dp" />';

describe("M4z scaleType 完整映射", () => {
  it("fitXY → fill", () => {
    expect(first(pic.replace(/\/>/, ' android:scaleType="fitXY" />')).imgFit).toBe("fill");
  });

  it("centerCrop → cover", () => {
    expect(first(pic.replace(/\/>/, ' android:scaleType="centerCrop" />')).imgFit).toBe("cover");
  });

  it("fitCenter（缺省）/ centerInside → contain，居中（无 imgPos）", () => {
    const a = first(pic);
    const b = first(pic.replace(/\/>/, ' android:scaleType="centerInside" />'));
    expect(a.imgFit).toBe("contain");
    expect(b.imgFit).toBe("contain");
    expect(a.imgPos).toBeUndefined();
    expect(b.imgPos).toBeUndefined();
  });

  it("fitStart → contain + 左对齐", () => {
    const n = first(pic.replace(/\/>/, ' android:scaleType="fitStart" />'));
    expect(n.imgFit).toBe("contain");
    expect(n.imgPos).toBe("left center");
  });

  it("fitEnd → contain + 右对齐", () => {
    const n = first(pic.replace(/\/>/, ' android:scaleType="fitEnd" />'));
    expect(n.imgFit).toBe("contain");
    expect(n.imgPos).toBe("right center");
  });

  it("center → none（原始尺寸）", () => {
    expect(first(pic.replace(/\/>/, ' android:scaleType="center" />')).imgFit).toBe("none");
  });

  it("matrix → none（浏览器无矩阵变换，近似原尺寸居中）", () => {
    expect(first(pic.replace(/\/>/, ' android:scaleType="matrix" />')).imgFit).toBe("none");
  });

  it("非法值兜底 → contain", () => {
    expect(first(pic.replace(/\/>/, ' android:scaleType="bogus" />')).imgFit).toBe("contain");
  });
});

describe("M11 默认 scaleType 与 matrix", () => {
  const raw =
    '<ImageView android:src="@drawable/pic" android:layout_width="48dp" android:layout_height="48dp" />';

  it("ImageView 不写 scaleType 默认 fitCenter", () => {
    expect(first(raw).imgFit).toBe("contain");
  });

  it("ImageButton 不写 scaleType 默认 center（Android 构造函数里写死 CENTER）", () => {
    const ib = raw.replace("<ImageView", "<ImageButton").replace("ImageView", "ImageButton");
    const n = first(ib);
    expect(n.imgFit).toBe("none");
  });

  it("matrix → 原始尺寸、左上角对齐", () => {
    const n = first(raw.replace(/\/>/, ' android:scaleType="matrix" />'));
    expect(n.imgFit).toBe("none");
    expect(n.imgPos).toBe("left top");
  });

  it("center 保持居中（不写 imgPos）", () => {
    const n = first(raw.replace(/\/>/, ' android:scaleType="center" />'));
    expect(n.imgFit).toBe("none");
    expect(n.imgPos).toBeUndefined();
  });
});
