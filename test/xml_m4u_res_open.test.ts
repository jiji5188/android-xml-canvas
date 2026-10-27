// test/xml_m4u_res_open.test.ts — 资源树点击分流（M4u）
// 用户 2026-10-28：drawable 目录的 xml 默认用绘制编辑器打开；图片格式弹图片预览框
import { describe, it, expect } from "vitest";
import { resOpenAction, resBaseName } from "../lib/xml/resource-open";
import type { ResourceExtras } from "../lib/xml/resdir";

const extras = {
  drawables: { ic_home: "data:image/png;base64,AAA", bg_card: "data:image/png;base64,BBB" },
  vectorNames: [],
  drawableXml: {},
  valuesXml: "",
  styles: {},
  sourceFiles: [],
  counts: { images: 2, vectors: 0, values: 0, styles: 0, shapes: 0 },
} as unknown as ResourceExtras;

const SHAPE = `<shape xmlns:android="http://schemas.android.com/apk/res/android">
  <solid android:color="#FFFFFF" /><corners android:radius="8dp" /></shape>`;
const RIPPLE = `<ripple xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/x" /></ripple>`;
const VECTOR = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#000000" android:pathData="M0,0h24v24H0z" /></vector>`;

describe("M4u 资源树点击分流", () => {
  it("图片（含密度目录）→ image + 解析好的 dataURL", () => {
    const a = resOpenAction("res/drawable-hdpi/ic_home.png", null, extras);
    expect(a).toEqual({ kind: "image", name: "ic_home", url: "data:image/png;base64,AAA" });
  });

  it("同一张图放在 mipmap-xxhdpi 也能找到", () => {
    const a = resOpenAction("res/mipmap-xxhdpi/ic_home.webp", null, extras);
    expect(a.kind).toBe("image");
    expect((a as { url: string }).url).toContain("data:image/png");
  });

  it("shape xml → drawable（走绘制编辑器），xml 原文带上", () => {
    const a = resOpenAction("res/drawable/bg_card.xml", SHAPE, extras);
    expect(a.kind).toBe("drawable");
    expect((a as { xml: string }).xml).toContain("<shape");
    expect((a as { name: string }).name).toBe("bg_card");
  });

  it("ripple / selector / layer-list / inset 都算可编辑形状", () => {
    for (const xml of [
      RIPPLE,
      `<selector xmlns:android="http://schemas.android.com/apk/res/android"><item android:state_pressed="true" android:drawable="@color/a"/></selector>`,
      `<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/a"/></layer-list>`,
      `<inset xmlns:android="http://schemas.android.com/apk/res/android" android:insetLeft="4dp"><shape><solid android:color="#fff"/></shape></inset>`,
    ]) {
      expect(resOpenAction("res/drawable/x.xml", xml, extras).kind).toBe("drawable");
    }
  });

  it("vector xml → vector，并转成 svg dataURL 可直接预览", () => {
    const a = resOpenAction("res/drawable/ic_star.xml", VECTOR, extras);
    expect(a.kind).toBe("vector");
    expect((a as { url: string }).url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("layout / values / 未知 xml / 非 drawable 目录 → none", () => {
    expect(resOpenAction("res/layout/activity_main.xml", "<LinearLayout/>", extras).kind).toBe("none");
    expect(resOpenAction("res/values/strings.xml", "<resources/>", extras).kind).toBe("none");
    expect(resOpenAction("res/drawable/weird.xml", "not xml at all", extras).kind).toBe("none");
    expect(resOpenAction("res/menu/main.xml", "<menu/>", extras).kind).toBe("none");
  });

  it("图片没解析到内容时 url 为空（预览框给提示，不崩）", () => {
    const a = resOpenAction("res/drawable-hdpi/unknown_thing.jpg", null, extras);
    expect(a).toEqual({ kind: "image", name: "unknown_thing", url: "" });
  });

  it("整目录导入（src/main/res/…）也能识别", () => {
    const a = resOpenAction("src/main/res/drawable/ic_home.xml", SHAPE, extras);
    expect(a.kind).toBe("drawable");
    const b = resOpenAction("src/main/res/drawable-hdpi/ic_home.png", null, extras);
    expect(b).toEqual({ kind: "image", name: "ic_home", url: "data:image/png;base64,AAA" });
  });

  it("resBaseName 去掉目录和扩展名（含 .9.png）", () => {
    expect(resBaseName("res/drawable/ic_home.xml")).toBe("ic_home");
    expect(resBaseName("res/drawable-hdpi/bg.9.png")).toBe("bg.9");
    expect(resBaseName("res/mipmap-anydpi-v26/ic_launcher.xml")).toBe("ic_launcher");
  });
});
