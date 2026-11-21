// M461：项目属性页 包名/版本 写 build.gradle 修复
// 用户报：项目属性页改包名+版本后 build.gradle 没变（漏写）
// 两个根因：
//   ① step3.5/3.6 单字段失败 early-return → step4 saveRel 不跑 → 连成功的包名改动都写不进盘
//   ② setAppConfigField 对 versionCode/versionName 缺失直接报错（不插 defaultConfig）
import { describe, expect, it } from "vitest";
import { setAppConfigField } from "@/lib/xml/project-info";
import { parseAppConfig } from "@/lib/xml/gradle-deps";

describe("M461 setAppConfigField 缺失字段插入 defaultConfig", () => {
  const GRADLE = `plugins { id "com.android.application" }
android {
    namespace 'com.foo'
    compileSdk 34
    defaultConfig {
        minSdk 24
        targetSdk 34
    }
}`;

  it("versionCode 缺失 → 插进 defaultConfig（groovy 空格风格）", () => {
    const r = setAppConfigField(GRADLE, "versionCode", "99");
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/defaultConfig \{[\s\S]*?versionCode 99[\s\S]*?\}/);
    // 没破坏已有行
    expect(r.text).toContain("minSdk 24");
    expect(r.text).toContain("namespace 'com.foo'");
  });

  it("versionName 缺失 → 带引号插进 defaultConfig", () => {
    const r = setAppConfigField(GRADLE, "versionName", "2.0.0");
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/versionName "2\.0\.0"/);
  });

  it("namespace 已有 → 替换值（不改其它）", () => {
    const r = setAppConfigField(GRADLE, "namespace", "com.bar");
    expect(r.ok).toBe(true);
    // QUOTED_FIELDS 统一用双引号
    expect(r.text).toMatch(/namespace [\"']com\.bar[\"']/);
    expect(r.text).not.toContain("com.foo");
    // 保留其它行
    expect(r.text).toContain("minSdk 24");
  });

  it("applicationId 缺失且无 defaultConfig → 插 android 顶层（兜底）", () => {
    const g = `android {\n    compileSdk 34\n}`;
    const r = setAppConfigField(g, "applicationId", "com.x");
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/applicationId "com\.x"/);
  });

  it("kts 风格：versionCode 缺失 → = 号插入", () => {
    const g = `android {\n    namespace = "com.foo"\n    defaultConfig {\n        minSdk = 24\n    }\n}`;
    const r = setAppConfigField(g, "versionCode", "5", true);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/versionCode = 5/);
  });

  it("已有 versionCode → 替换原值", () => {
    const g = `android {\n    defaultConfig {\n        versionCode 10\n        versionName "1.0"\n    }\n}`;
    const r = setAppConfigField(g, "versionCode", "11");
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/versionCode 11/);
    expect(r.text).not.toMatch(/versionCode 10\b/);
  });
});

describe("M461 parseAppConfig 读取", () => {
  it("读 defaultConfig 里的 versionCode/Name", () => {
    const g = `android {\n    namespace 'com.foo'\n    defaultConfig {\n        versionCode 42\n        versionName "9.9"\n    }\n}`;
    const ac = parseAppConfig(g);
    expect(ac.versionCode).toBe("42");
    expect(ac.versionName).toBe("9.9");
    expect(ac.namespace).toBe("com.foo");
  });
});
