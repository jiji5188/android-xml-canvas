// test/xml_m345_gradle_deps.test.ts — M345：解析 build.gradle 依赖
import { describe, it, expect } from "vitest";
import { parseGradleDeps, gradleDepDownloadUrls, gradleDepFname } from "@/lib/xml/gradle-deps";

describe("parseGradleDeps", () => {
  it("提取 implementation 单引号写法", () => {
    const g = `
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'androidx.recyclerview:recyclerview:1.3.2'
}
`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(2);
    expect(deps[0]).toMatchObject({
      group: "com.squareup.okhttp3",
      name: "okhttp",
      version: "4.12.0",
      config: "implementation",
      isAar: false,
    });
    expect(deps[1]).toMatchObject({
      group: "androidx.recyclerview",
      name: "recyclerview",
      version: "1.3.2",
      isAar: true,
    });
  });

  it("提取 implementation 双引号 + 括号写法", () => {
    const g = `dependencies {
    implementation("com.google.zxing:core:3.5.3")
    api("androidx.appcompat:appcompat:1.7.0")
}`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(2);
    expect(deps[0]).toMatchObject({ group: "com.google.zxing", name: "core", version: "3.5.3" });
    expect(deps[1]).toMatchObject({ config: "api", group: "androidx.appcompat" });
  });

  it("提取 group/name/version map 写法", () => {
    const g = `dependencies {
    implementation group: 'com.google.code.gson', name: 'gson', version: '2.10.1'
}`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ group: "com.google.code.gson", name: "gson", version: "2.10.1", isAar: false });
  });

  it("跳过 fileTree / project / 注释", () => {
    const g = `dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation project(':app')
    // implementation 'com.x:y:1.0'
    implementation 'com.x:y:1.0'
}`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ group: "com.x", name: "y", version: "1.0" });
  });

  it("多行 + 多配置类型混合", () => {
    const g = `
implementation 'androidx.core:core-ktx:1.13.1'
implementation("com.squareup.retrofit2:retrofit:3.0.0")
compile 'joda-time:joda-time:2.10.14'
testImplementation 'junit:junit:4.13.2'
runtimeOnly 'androidx.legacy:legacy-support-v4:1.0.0'
`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(5);
    expect(deps.map((d) => d.config)).toEqual([
      "implementation",
      "implementation",
      "compile",
      "testImplementation",
      "runtimeOnly",
    ]);
    expect(deps[0].isAar).toBe(true); // androidx.*
    expect(deps[1].isAar).toBe(false); // com.squareup.*
  });

  it("去重（同一坐标出现两次）", () => {
    const g = `
implementation 'com.x:y:1.0'
implementation 'com.x:y:1.0'
api 'com.x:y:1.0'
`;
    const deps = parseGradleDeps(g);
    expect(deps).toHaveLength(1);
  });
});

describe("gradleDepDownloadUrls / gradleDepFname", () => {
  it("androidx 走 Google Maven 候选，文件名 .aar", () => {
    const deps = parseGradleDeps(`implementation 'androidx.cardview:cardview:1.0.0'`);
    const d = deps[0];
    expect(d.isAar).toBe(true);
    expect(gradleDepFname(d)).toBe("cardview-1.0.0.aar");
    const urls = gradleDepDownloadUrls(d);
    // 第一个是局域网镜像
    expect(urls[0]).toContain("_dl/libs/cardview-1.0.0.aar");
    // 包含阿里云 google 镜像
    expect(urls.some((u) => u.includes("maven.aliyun.com/repository/google"))).toBe(true);
  });

  it("第三方走 Maven Central 候选，文件名 .jar", () => {
    const deps = parseGradleDeps(`implementation 'com.google.code.gson:gson:2.10.1'`);
    const d = deps[0];
    expect(d.isAar).toBe(false);
    expect(gradleDepFname(d)).toBe("gson-2.10.1.jar");
    const urls = gradleDepDownloadUrls(d);
    expect(urls.some((u) => u.includes("maven.aliyun.com/repository/central"))).toBe(true);
  });
});
