import { describe, it, expect } from "vitest";
import { ANDROID_THEME_PRESETS, inferPreviewFeatures, androidThemeById } from "../lib/xml/android-theme-presets";

describe("M324 inferPreviewFeatures", () => {
  it("Material3 全屏主题 → fullscreen=true + noActionBar=true", () => {
    const f = inferPreviewFeatures(androidThemeById("material3-fullscreen"));
    expect(f.fullscreen).toBe(true);
    expect(f.noActionBar).toBe(true);
  });

  it("各 NoActionBar 主题 → noActionBar=true", () => {
    for (const id of ["material2-noactionbar", "material3-noactionbar", "appcompat-light-noactionbar"]) {
      const f = inferPreviewFeatures(androidThemeById(id));
      expect(f.noActionBar, id).toBe(true);
    }
  });

  it("dialog 主题 → noActionBar=true + dialogStyle 按系列", () => {
    expect(inferPreviewFeatures(androidThemeById("material3-light-dialog")).dialogStyle).toBe("material3");
    expect(inferPreviewFeatures(androidThemeById("material2-light-dialog")).dialogStyle).toBe("material2");
    expect(inferPreviewFeatures(androidThemeById("appcompat-light-dialog")).dialogStyle).toBe("appcompat");
    expect(inferPreviewFeatures(androidThemeById("system-device-default-dialog")).dialogStyle).toBe("system");
    // 所有 dialog 预设 noActionBar 都为 true
    for (const p of ANDROID_THEME_PRESETS.filter((x) => x.kind === "dialog")) {
      expect(inferPreviewFeatures(p).noActionBar).toBe(true);
    }
  });

  it("Holo 主题 → dialogStyle=holo", () => {
    expect(inferPreviewFeatures(androidThemeById("system-holo")).dialogStyle).toBe("holo");
  });

  it("普通 Material2 非全屏 → fullscreen=false", () => {
    const f = inferPreviewFeatures(androidThemeById("material2"));
    expect(f.fullscreen).toBe(false);
    expect(f.dialogStyle).toBe("material2");
  });

  it("Material3 普通主题（非 NoActionBar）也 noActionBar=true（M3 默认无 ActionBar）", () => {
    expect(inferPreviewFeatures(androidThemeById("material3-light")).noActionBar).toBe(true);
  });
});
