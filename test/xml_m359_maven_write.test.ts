// M359：应用到项目 = 写 maven 坐标（不拷文件）。gradle-deps 写入助手单测。
import { describe, it, expect } from "vitest";
import { mavenCoord, insertImplementation, insertRepoUrl } from "../lib/xml/gradle-deps";

describe("M359 maven 写入助手", () => {
  it("mavenCoord 拼坐标", () => {
    expect(mavenCoord("com.google.code.gson", "gson", "2.10.1")).toBe("com.google.code.gson:gson:2.10.1");
  });

  it("insertImplementation：已有 dependencies 块 → 块内插行", () => {
    const src = "plugins { id 'com.android.application' }\n\ndependencies {\n    implementation 'androidx.core:core-ktx:1.12.0'\n}\n";
    const [out, existed] = insertImplementation(src, "com.google.code.gson:gson:2.10.1", false);
    expect(existed).toBe(false);
    expect(out).toContain("implementation 'com.google.code.gson:gson:2.10.1'");
    // 原有依赖还在
    expect(out).toContain("androidx.core:core-ktx:1.12.0");
    // 幂等：再来一次 → 已存在
    const [out2, e2] = insertImplementation(out, "com.google.code.gson:gson:2.10.1", false);
    expect(e2).toBe(true);
    expect(out2).toBe(out);
  });

  it("insertImplementation：没有 dependencies 块 → 末尾建块", () => {
    const src = "plugins { id 'com.android.application' }\n";
    const [out, existed] = insertImplementation(src, "androidx.recyclerview:recyclerview:1.3.2", false);
    expect(existed).toBe(false);
    expect(out).toContain("dependencies {");
    expect(out).toContain("implementation 'androidx.recyclerview:recyclerview:1.3.2'");
  });

  it("insertImplementation：kts 用括号写法", () => {
    const src = "dependencies {\n}";
    const [out] = insertImplementation(src, "androidx.core:core-ktx:1.12.0", true);
    expect(out).toContain('implementation("androidx.core:core-ktx:1.12.0")');
  });

  it("insertRepoUrl：google() / mavenCentral() 系统函数 + 去重", () => {
    const src = "dependencyResolutionManagement {\n    repositories {\n        google()\n    }\n}";
    // google 已含（url 形式不匹配，但文本包含 dl.google.com？不，这里是 google() 函数）→ 视为需要补 mavenCentral
    const [out, existed] = insertRepoUrl(src, "https://repo.maven.apache.org/maven2", false);
    expect(existed).toBe(false);
    expect(out).toContain("mavenCentral()");
  });

  it("insertRepoUrl：url 已出现 → 不动", () => {
    const src = "repositories { maven { url 'https://maven.aliyun.com/repository/public' } }";
    const [out, existed] = insertRepoUrl(src, "https://maven.aliyun.com/repository/public", false);
    expect(existed).toBe(true);
    expect(out).toBe(src);
  });

  it("insertRepoUrl：没有 repositories 块 → 建块", () => {
    const src = "rootProject.name = 'MyApp'\n";
    const [out] = insertRepoUrl(src, "https://dl.google.com/dl/android/maven2", false);
    expect(out).toContain("repositories {");
    expect(out).toContain("google()");
  });
});
