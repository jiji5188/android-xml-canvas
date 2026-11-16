import { describe, it, expect } from "vitest";
import { needsThirdPartyDep, ANDROID_THEME_PRESETS, androidThemeById } from "../lib/xml/android-theme-presets";

describe("M329 needsThirdPartyDep（工具不内置资源库，选 Material/AppCompat 需用户自加依赖）", () => {
  it("系统主题（framework / @android:style / Theme.Material）不需要第三方依赖", () => {
    expect(needsThirdPartyDep("@android:style/Theme.Holo")).toBeNull();
    expect(needsThirdPartyDep("@android:style/Theme.DeviceDefault")).toBeNull();
    expect(needsThirdPartyDep("@android:style/Theme.Material")).toBeNull();
    expect(needsThirdPartyDep("@android:style/Theme.Material.Dialog")).toBeNull();
  });

  it("AppCompat 主题需要 androidx.appcompat", () => {
    for (const id of ["appcompat", "appcompat-light", "appcompat-light-noactionbar", "appcompat-dialog"]) {
      const r = needsThirdPartyDep(androidThemeById(id).parent);
      expect(r).not.toBeNull();
      expect(r!.lib).toBe("androidx.appcompat");
    }
  });

  it("Material 2 / 3 主题需要 com.google.android.material", () => {
    for (const id of ["material2", "material3-light", "material3-fullscreen", "material3-dialog"]) {
      const r = needsThirdPartyDep(androidThemeById(id).parent);
      expect(r).not.toBeNull();
      expect(r!.lib).toBe("com.google.android.material");
    }
  });

  it("全覆盖：结果与 parent 前缀一致（@android:/framework Material=null，AppCompat/Material3/MaterialComponents=需依赖）", () => {
    for (const p of ANDROID_THEME_PRESETS) {
      const r = needsThirdPartyDep(p.parent);
      if (p.parent.startsWith("@android:") || /^Theme\.Material(\.|$)/.test(p.parent)) {
        expect(r, p.id + " " + p.parent).toBeNull();
      } else {
        expect(r, p.id + " " + p.parent).not.toBeNull();
      }
    }
  });
});
