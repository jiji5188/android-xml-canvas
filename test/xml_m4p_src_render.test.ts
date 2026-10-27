// test/xml_m4p_src_render.test.ts — 画布要真画出 src 图片资源
// 用户 2026-10-28：预览框没绘制出 src 的图片资源
// 三个根因：① ImageButton 没映射到 axv-image（落到 axv-container，src 根本没进样式）
//          ② 上传的 vector xml 只返回 "vector:name" 占位，画布画紫虚线框
//          ③ M4s 起：src 改由 <img> 内容层画（background 在下、src 在上），不再进 style.backgroundImage
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { resolveDrawable } from "../lib/xml/resolve";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const VECTOR = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path android:fillColor="#FF000000" android:pathData="M12,2L2,22h20z" />
</vector>`;

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function first(xml: string, res = DEFAULT_RESOURCES) {
  const m = buildRenderModel(
    parseLayoutXml(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent">${xml}</LinearLayout>`).root!,
    res,
  );
  return m.root.children[0];
}

describe("M4p src 渲染", () => {
  it("ImageView + data URL：图片挂在内容层（imgSrc）", () => {
    const n = first(
      `<ImageView android:src="@drawable/pic" android:layout_width="48dp" android:layout_height="48dp" />`,
      { ...DEFAULT_RESOURCES, drawables: { pic: PNG_DATA_URL } },
    );
    expect(n.imgSrc).toBe(PNG_DATA_URL);
    expect(n.style.backgroundImage).toBeUndefined();
  });

  it("ImageButton 也走 axv-image（以前落到 axv-container，src 全丢）", () => {
    const res = { ...DEFAULT_RESOURCES, drawables: { pic: PNG_DATA_URL } };
    for (const tag of ["ImageButton", "androidx.appcompat.widget.AppCompatImageButton"]) {
      const n = first(`<${tag} android:src="@drawable/pic" android:layout_width="48dp" android:layout_height="48dp" />`, res);
      expect(n.className).toBe("axv-image");
      expect(n.imgSrc).toBe(PNG_DATA_URL);
    }
  });

  it("上传的 vector xml 不再只给 vector: 占位，而是转 data URL 真画", () => {
    const res = { ...DEFAULT_RESOURCES, vectorNames: ["ic_tri"], drawableXml: { ic_tri: VECTOR } };
    const out = resolveDrawable("@drawable/ic_tri", res, [], "#0", "src");
    expect(out.startsWith("data:image/svg+xml")).toBe(true);
    const n = first(`<ImageView android:src="@drawable/ic_tri" android:layout_width="48dp" android:layout_height="48dp" />`, res);
    expect(String(n.imgSrc)).toContain("data:image/svg+xml");
    expect(n.style.border).toBeUndefined();
  });

  it("真缺失的资源仍然是占位（不静默变空白）", () => {
    const out = resolveDrawable("@drawable/nope", DEFAULT_RESOURCES, [], "#0", "src");
    expect(out).toBe("missing:drawable/nope");
    const n = first(`<ImageView android:src="@drawable/nope" android:layout_width="48dp" android:layout_height="48dp" />`);
    expect(n.imgSrc).toBeUndefined();
    expect(n.style.border).toContain("dashed");
  });
});
