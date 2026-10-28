// M5a：android:tintMode 渲染支持
// src_in/src_atop（默认）→ mask 填色；multiply/screen/add/src_over → 原图 + 混色层
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

const base = (extra: string) =>
  `<ImageView android:src="@drawable/pic" android:layout_width="48dp" android:layout_height="48dp" ${extra} />`;

describe("M5a tintMode 解析", () => {
  it("不写 tintMode：imgBlend 为空（沿用 mask 填色 = src_in）", () => {
    const n = first(base('android:tint="#FF0000"'));
    expect(n.imgTint).toBe("#FF0000");
    expect(n.imgBlend).toBeUndefined();
  });

  it("src_in / src_atop → mask 填色（imgBlend 空）", () => {
    for (const tm of ["src_in", "src_atop"]) {
      const n = first(base(`android:tint="#FF0000" android:tintMode="${tm}"`));
      expect(n.imgTint).toBe("#FF0000");
      expect(n.imgBlend).toBeUndefined();
    }
  });

  it("multiply → imgBlend=multiply（保留原图 + 混色层）", () => {
    const n = first(base('android:tint="#00FF00" android:tintMode="multiply"'));
    expect(n.imgTint).toBe("#00FF00");
    expect(n.imgBlend).toBe("multiply");
  });

  it("screen → imgBlend=screen", () => {
    expect(first(base('android:tint="#00FF00" android:tintMode="screen"')).imgBlend).toBe("screen");
  });

  it("add → imgBlend=plus-lighter", () => {
    expect(first(base('android:tint="#00FF00" android:tintMode="add"')).imgBlend).toBe("plus-lighter");
  });

  it("src_over → imgBlend=overlay（普通叠加，不混色）", () => {
    expect(first(base('android:tint="#00FF00" android:tintMode="src_over"')).imgBlend).toBe("overlay");
  });

  it("未知 tintMode 兜底 → mask 填色", () => {
    expect(first(base('android:tint="#00FF00" android:tintMode="bogus"')).imgBlend).toBeUndefined();
  });

  it("没有 tint 时 tintMode 不生效（imgBlend 空）", () => {
    expect(first(base('android:tintMode="multiply"')).imgBlend).toBeUndefined();
  });
});
