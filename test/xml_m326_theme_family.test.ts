import { describe, it, expect } from "vitest";
import { ANDROID_THEME_PRESETS, themeFamily, androidThemeById } from "../lib/xml/android-theme-presets";

describe("M326 themeFamily（样张按家族复刻真实 Android 控件）", () => {
  it("分组映射正确", () => {
    for (const p of ANDROID_THEME_PRESETS) {
      if (p.group === "appcompat") expect(themeFamily(p)).toBe("appcompat");
      else if (p.group === "material2") expect(themeFamily(p)).toBe("material2");
      else if (p.group === "material3") expect(themeFamily(p)).toBe("material3");
    }
  });

  it("系统组按 parent 区分 Holo / DeviceDefault", () => {
    expect(themeFamily(androidThemeById("system-holo"))).toBe("holo");
    const dd = ANDROID_THEME_PRESETS.filter((p) => p.group === "system" && /DeviceDefault/i.test(p.parent));
    expect(dd.length).toBeGreaterThan(0);
    for (const p of dd) expect(themeFamily(p)).toBe("device");
  });

  it("Holo 浅色/深色都归 holo 家族", () => {
    const holos = ANDROID_THEME_PRESETS.filter((p) => /Holo/i.test(p.parent));
    expect(holos.length).toBeGreaterThan(0);
    for (const p of holos) expect(themeFamily(p)).toBe("holo");
  });

  it("对话框组主题也能判出家族（用于样张）", () => {
    for (const p of ANDROID_THEME_PRESETS.filter((x) => x.kind === "dialog")) {
      expect(["appcompat", "material2", "material3", "holo", "device"]).toContain(themeFamily(p));
    }
  });
});
