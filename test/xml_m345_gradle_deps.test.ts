// test/xml_m345_gradle_deps.test.ts — M345：解析 build.gradle 依赖
import { describe, it, expect } from "vitest";
import {
  parseGradleDeps,
  parseGradleDepsDetailed,
  collectGradleVars,
  gradleDepDownloadUrls,
  gradleDepFname,
} from "@/lib/xml/gradle-deps";

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

describe("变量版本解析（M345b）", () => {
  it("collectGradleVars 收集 def / ext. / rootProject.ext. / 裸赋值", () => {
    const vars = collectGradleVars(`
def materialVersion = '1.11.0'
ext.coreKtx = "1.13.1"
rootProject.ext.junitV = '4.13.2'
retrofitV = "3.0.0"
`);
    expect(vars.get("materialVersion")).toBe("1.11.0");
    expect(vars.get("coreKtx")).toBe("1.13.1");
    expect(vars.get("junitV")).toBe("4.13.2");
    expect(vars.get("retrofitV")).toBe("3.0.0");
  });

  it("$var 与 ${var} 两种引用都能解出版本", () => {
    const g = `
def materialVersion = '1.11.0'
def okhttp = "4.12.0"
dependencies {
    implementation "com.google.android.material:material:$materialVersion"
    implementation(\"com.squareup.okhttp3:okhttp:\${okhttp}\")
}
`;
    const { deps, unresolved } = parseGradleDepsDetailed(g);
    expect(unresolved).toHaveLength(0);
    expect(deps).toHaveLength(2);
    expect(deps[0]).toMatchObject({ group: "com.google.android.material", name: "material", version: "1.11.0", isAar: true });
    expect(deps[1]).toMatchObject({ group: "com.squareup.okhttp3", name: "okhttp", version: "4.12.0", isAar: false });
  });

  it("版本变量没在本文件定义 → 进 unresolved，不当字面版本去下载", () => {
    const g = `dependencies {
    implementation "androidx.core:core-ktx:$kotlinVersion"
    implementation 'junit:junit:4.13.2'
}`;
    const { deps, unresolved } = parseGradleDepsDetailed(g);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("junit");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].vars).toEqual(["kotlinVersion"]);
    expect(unresolved[0].coord).toContain("$kotlinVersion");
  });

  it("变量套变量也能解（最多 5 轮）", () => {
    const g = `
def major = '1'
def minor = '13'
def coreV = "$major.$minor.1"
dependencies {
    implementation "androidx.core:core-ktx:$coreV"
}`;
    const { deps } = parseGradleDepsDetailed(g);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("1.13.1");
  });

  it("解析前的注释里的变量声明不算（否则会误命中）", () => {
    const g = `// def junk = '9.9.9'
implementation 'com.x:y:1.0'
`;
    expect(collectGradleVars(g).size).toBe(0);
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
