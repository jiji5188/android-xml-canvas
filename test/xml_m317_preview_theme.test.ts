import { describe, it, expect } from "vitest";
import {
  mapThemeParent,
  mapThemeItem,
  extractStyleBlock,
  stripStyleBlock,
  buildPreviewThemeXml,
} from "../lib/xml/preview-theme";

describe("mapThemeParent（M317b 框架等价映射）", () => {
  it("Material3.Light → Theme.Material.Light.NoActionBar？→ 基座 Material.Light", () => {
    expect(mapThemeParent("Theme.Material3.Light")).toBe("@android:style/Theme.Material.Light");
  });
  it("Material3.Dark → 深色基座 Theme.Material", () => {
    expect(mapThemeParent("Theme.Material3.Dark")).toBe("@android:style/Theme.Material");
  });
  it("AppCompat.Light.NoActionBar → Material.Light + NoActionBar", () => {
    expect(mapThemeParent("Theme.AppCompat.Light.NoActionBar")).toBe(
      "@android:style/Theme.Material.Light.NoActionBar",
    );
  });
  it("Holo → Theme.Holo", () => {
    expect(mapThemeParent("Theme.Holo")).toBe("@android:style/Theme.Holo");
  });
  it("@android: 前缀原样保留", () => {
    expect(mapThemeParent("@android:style/Theme.Holo.Light")).toBe("@android:style/Theme.Holo.Light");
  });
  it("Material3 Light NoActionBar Fullscreen → 带 NoActionBar.Fullscreen", () => {
    expect(mapThemeParent("Theme.Material3.Light.NoActionBar.Fullscreen")).toBe(
      "@android:style/Theme.Material.Light.NoActionBar.Fullscreen",
    );
  });
  it("空值 → 默认 Material.Light", () => {
    expect(mapThemeParent("")).toBe("@android:style/Theme.Material.Light");
  });
});

describe("mapThemeItem（attr → framework 等价）", () => {
  it("colorPrimary → android:colorPrimary", () => {
    expect(mapThemeItem("colorPrimary")).toBe("android:colorPrimary");
  });
  it("colorSecondary → android:colorAccent", () => {
    expect(mapThemeItem("colorSecondary")).toBe("android:colorAccent");
  });
  it("colorOnPrimary → null（framework 没有）", () => {
    expect(mapThemeItem("colorOnPrimary")).toBeNull();
  });
  it("android: 前缀原样", () => {
    expect(mapThemeItem("android:windowBackground")).toBe("android:windowBackground");
  });
  it("未知 attr → null", () => {
    expect(mapThemeItem("isMaterialButton")).toBeNull();
  });
});

describe("buildPreviewThemeXml（生成自足预览主题）", () => {
  const themesXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    '  <style name="Theme.MyApp" parent="Theme.Material3.Light">',
    '    <item name="colorPrimary">#FF6750A4</item>',
    '    <item name="colorOnPrimary">#FFFFFFFF</item>',
    '    <item name="colorSecondary">#FF625B71</item>',
    '    <item name="android:windowBackground">#FF141218</item>',
    "  </style>",
    "  <style name=\"MyButton\">",
    '    <item name="android:background">@drawable/btn</item>',
    "  </style>",
    "</resources>",
  ].join("\n");

  it("Material3.Light 的 app 主题 → framework 等价（parent + 只留 android: item）", () => {
    const built = buildPreviewThemeXml(themesXml, "Theme.MyApp");
    expect(built).not.toBeNull();
    expect(built!.parent).toBe("@android:style/Theme.Material.Light");
    const names = built!.items.map((i) => i.name);
    expect(names).toContain("android:colorPrimary");
    expect(names).toContain("android:colorAccent");
    expect(names).toContain("android:windowBackground");
    expect(names).not.toContain("colorPrimary");
    expect(names).not.toContain("colorOnPrimary");
  });

  it("剥掉原同名 style 后其它 style 保留", () => {
    const stripped = stripStyleBlock(themesXml, "Theme.MyApp");
    expect(stripped).not.toContain('name="Theme.MyApp"');
    expect(stripped).toContain('name="MyButton"');
  });

  it("找不到 style → null", () => {
    expect(buildPreviewThemeXml(themesXml, "NoSuchTheme")).toBeNull();
  });
});
