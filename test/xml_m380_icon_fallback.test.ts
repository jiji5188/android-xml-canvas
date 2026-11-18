// M380：manifest 引用但项目缺失的图标 → 自动补默认矢量图标（否则 aapt2 link 必失败）
import { describe, it, expect } from "vitest";
import {
  manifestIconRefs,
  hasResFile,
  injectMissingManifestIcons,
  FALLBACK_ICON_VECTOR,
} from "../lib/xml/icon-fallback";

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.momo.ReturnSystem">
  <application android:icon="@mipmap/app" android:roundIcon="@mipmap/app_round" android:label="@string/app_name">
  </application>
</manifest>`;

describe("M380 图标补齐", () => {
  it("从 manifest 认出 icon / roundIcon", () => {
    expect(manifestIconRefs(MANIFEST)).toEqual([
      { type: "mipmap", name: "app" },
      { type: "mipmap", name: "app_round" },
    ]);
  });

  it("带扩展名/带限定符目录的已有图标算「已有」", () => {
    expect(hasResFile([{ path: "mipmap-hdpi/app.png", text: "" } as never], "mipmap", "app")).toBe(true);
    expect(hasResFile([{ path: "mipmap-anydpi-v26/app.xml", text: "" } as never], "mipmap", "app")).toBe(true);
    expect(hasResFile([{ path: "mipmap/app.webp", text: "" } as never], "mipmap", "app")).toBe(true);
    expect(hasResFile([{ path: "drawable/app.xml", text: "" } as never], "mipmap", "app")).toBe(false);
  });

  it("项目里一个都没有 → 两个都补成 mipmap/app.xml、mipmap/app_round.xml", () => {
    const r = injectMissingManifestIcons([{ path: "layout/main.xml", text: "<x/>" } as never], MANIFEST);
    expect(r.injected).toEqual(["@mipmap/app", "@mipmap/app_round"]);
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain("mipmap/app.xml");
    expect(paths).toContain("mipmap/app_round.xml");
    expect(r.files.find((f) => f.path === "mipmap/app.xml")?.text).toBe(FALLBACK_ICON_VECTOR);
    expect(r.files.length).toBe(3); // 原布局 + 2 个图标
  });

  it("已有 png 的不重复补；另一个缺的才补", () => {
    const r = injectMissingManifestIcons(
      [{ path: "mipmap-xxhdpi/app.png", text: "" } as never],
      MANIFEST,
    );
    expect(r.injected).toEqual(["@mipmap/app_round"]);
    expect(r.files.map((f) => f.path)).toEqual(["mipmap-xxhdpi/app.png", "mipmap/app_round.xml"]);
  });

  it("manifest 没有图标属性 → 原样返回", () => {
    const files = [{ path: "layout/main.xml", text: "<x/>" } as never];
    const r = injectMissingManifestIcons(files, `<manifest><application/></manifest>`);
    expect(r.injected).toEqual([]);
    expect(r.files).toBe(files);
  });
});
