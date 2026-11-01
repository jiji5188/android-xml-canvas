// M48：默认项目图标 + 项目库类型识别（AndroidX / Support / Android）
import { describe, it, expect } from "vitest";
import { DEFAULT_ICON_SVG, DEFAULT_ICON_URL, DEFAULT_ICON_COLOR } from "@/lib/xml/default-icon";
import { parseLibKind } from "@/lib/xml/project-browse";
import { androidSkeleton } from "@/lib/xml/new-project";

describe("M48 默认图标", () => {
  it("SVG 是青绿底 + 白色机器人头，并带网格", () => {
    expect(DEFAULT_ICON_SVG).toContain(DEFAULT_ICON_COLOR);
    expect(DEFAULT_ICON_SVG).toContain("#ffffff");
    expect(DEFAULT_ICON_SVG).toContain("<clipPath");
    // 圆顶 + 两只眼睛
    expect(DEFAULT_ICON_SVG.match(/<circle/g)?.length).toBe(2);
  });

  it("data URL 可直接给 <img src>，中文/特殊字符已转义", () => {
    expect(DEFAULT_ICON_URL.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(DEFAULT_ICON_URL).not.toContain("#ffffff"); // # 必须被编码
    expect(DEFAULT_ICON_URL).toContain("%23ffffff");
  });

  it("新建项目骨架的启动图配色与新默认图标一致", () => {
    const files = androidSkeleton("Demo");
    const bg = files.find((f) => f.rel.endsWith("drawable/ic_launcher_background.xml"));
    const fg = files.find((f) => f.rel.endsWith("drawable/ic_launcher_foreground.xml"));
    expect(bg?.text).toContain("#3FBFA0");
    expect(fg?.text).toContain("#FFFFFF");
    // 眼睛用背景色透出来
    expect(fg?.text).toContain("#3FBFA0");
    expect(fg?.text).toContain("M30,66a24,24");
  });
});

describe("M48 库类型识别", () => {
  it("gradle.properties 里 useAndroidX=true → androidx（最权威）", () => {
    expect(parseLibKind("android.useAndroidX=true\nandroid.enableJetifier=true")).toBe("androidx");
  });

  it("gradle.properties 里有注释干扰也能认", () => {
    expect(parseLibKind("# android.useAndroidX = false\nandroid.useAndroidX = true")).toBe("androidx");
  });

  it("依赖里出现 androidx. → androidx", () => {
    expect(parseLibKind("", "implementation 'androidx.appcompat:appcompat:1.6.1'")).toBe("androidx");
    expect(parseLibKind(null, "implementation(\"androidx.core:core-ktx:1.12.0\")")).toBe("androidx");
  });

  it("依赖里出现 com.android.support → support", () => {
    expect(parseLibKind("", "implementation 'com.android.support:appcompat-v7:28.0.0'")).toBe("support");
  });

  it("只有 com.android.application 插件、无 support/androidx → 普通 Android 工程", () => {
    expect(
      parseLibKind("", "apply plugin: 'com.android.application'\ndependencies {}"),
    ).toBe("android");
  });

  it("什么都没有（空工程/读不到文件）→ android", () => {
    expect(parseLibKind(null, null, null)).toBe("android");
    expect(parseLibKind("", "")).toBe("android");
  });

  it("root build.gradle 里的 androidx 也算（多模块工程）", () => {
    expect(parseLibKind("", "", "classpath 'androidx.navigation:navigation-safe-args-gradle-plugin:2.7.0'")).toBe(
      "androidx",
    );
  });
});
