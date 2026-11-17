// test/xml_m345_gradle_deps.test.ts — M345：解析 build.gradle 依赖
import { describe, it, expect } from "vitest";
import {
  parseGradleDeps,
  parseGradleDepsDetailed,
  parseGradleProperties,
  parseSettingsModules,
  parseSettingsRepos,
  parseAppConfig,
  parseBuildscriptClasspath,
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

describe("M347 gradle.properties 编译标记", () => {
  it("提取 useAndroidX / enableJetifier 等开关", () => {
    const p = parseGradleProperties(`
# comment
org.gradle.jvmargs=-Xmx2048m
android.useAndroidX=true
android.enableJetifier=true
android.nonTransitiveRClass=true
`);
    const keys = p.flags.map((f) => f.key).sort();
    expect(keys).toEqual([
      "android.enableJetifier",
      "android.nonTransitiveRClass",
      "android.useAndroidX",
      "org.gradle.jvmargs",
    ]);
    expect(p.flags.find((f) => f.key === "android.useAndroidX")?.value).toBe("true");
  });

  it("提取 SDK 号（支持变量拼接）", () => {
    const p = parseGradleProperties(
      [
        "ext.minV = 24",
        "android.minSdkVersion=\$ext.minV",
        "targetSdkVersion=34",
        "compileSdkVersion=34",
      ].join("\n"),
    );
    expect(p.minSdk).toBe("24");
    expect(p.targetSdk).toBe("34");
    expect(p.compileSdk).toBe("34");
  });

  it("注释 / 空行 / 行内注释 都处理（# 和 ! 都是注释）", () => {
    const p = parseGradleProperties([
      "# android.useAndroidX=true（注释掉不算）",
      "android.enableJetifier=true  # 行内注释",
      "",
      "!important=false（! 也是注释行，不算）",
    ].join("\n"));
    expect(p.raw["android.enableJetifier"]).toBe("true");
    expect(p.raw["!important"]).toBeUndefined(); // ! 开头的行是注释
    expect(p.raw["android.useAndroidX"]).toBeUndefined();
  });
});

describe("M347 settings.gradle 模块", () => {
  it("include ':a', ':b' 拆出模块名", () => {
    const s = parseSettingsModules("rootProject.name = 'MyApp'\ninclude ':app', ':feature'");
    expect(s.modules).toEqual(["app", "feature"]);
    expect(s.rootProjectName).toBe("MyApp");
  });

  it("Kotlin include(\":a\", \"b\") 也认", () => {
    const s = parseSettingsModules('include(":app", ":lib")');
    expect(s.modules).toContain("app");
    expect(s.modules).toContain("lib");
  });
});

describe("M347 根 build.gradle buildscript classpath", () => {
  it("抓 classpath 'g:a:v'", () => {
    const r = parseBuildscriptClasspath(
      [
        "buildscript {",
        "  dependencies {",
        "    classpath 'com.android.tools.build:gradle:7.4.2'",
        "    classpath 'com.google.gms:google-services:4.4.0'",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ group: "com.android.tools.build", name: "gradle", version: "7.4.2" });
  });

  it("map 写法 classpath group:.., name:.., version:..", () => {
    const r = parseBuildscriptClasspath(
      "classpath group: 'org.jetbrains.kotlin', name: 'kotlin-gradle-plugin', version: '1.9.0'",
    );
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("kotlin-gradle-plugin");
  });
});

describe("M347b settings.gradle 仓库", () => {
  it("内置简写 + 自定义 url，去重", () => {
    const r = parseSettingsRepos([
      "dependencyResolutionManagement {",
      "  repositories {",
      "    google()",
      "    mavenCentral()",
      "    maven { url 'https://jitpack.io' }",
      "    maven { url 'https://jitpack.io' }",
      "  }",
      "}",
    ].join("\n"));
    const names = r.map((x) => x.name);
    expect(names).toContain("google");
    expect(names).toContain("mavenCentral");
    // 两个 jitpack 去重成一个
    const jit = r.filter((x) => x.url === "https://jitpack.io");
    expect(jit).toHaveLength(1);
  });

  it("Kotlin uri() 写法", () => {
    const r = parseSettingsRepos('maven { url = uri("https://maven.aliyun.com/repository/google") }');
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe("https://maven.aliyun.com/repository/google");
  });
});

describe("M347b app/build.gradle 模块配置", () => {
  const g = [
    "plugins { id 'com.android.application' }",
    "android {",
    "  namespace 'com.example.app'",
    "  compileSdk 34",
    "  defaultConfig {",
    "    applicationId \"com.example.app\"",
    "    minSdk 24",
    "    targetSdk 34",
    "    versionCode 1",
    "    versionName \"1.0\"",
    "  }",
    "  signingConfigs { release { ... } }",
    "}",
  ].join("\n");

  it("抓 namespace / applicationId / sdk / 版本 / 签名", () => {
    const c = parseAppConfig(g);
    expect(c.namespace).toBe("com.example.app");
    expect(c.applicationId).toBe("com.example.app");
    expect(c.minSdk).toBe("24");
    expect(c.targetSdk).toBe("34");
    expect(c.compileSdk).toBe("34");
    expect(c.versionCode).toBe("1");
    expect(c.versionName).toBe("1.0");
    expect(c.hasSigning).toBe(true);
  });

  it("旧写法 xxxSdkVersion 也认", () => {
    const c = parseAppConfig("compileSdkVersion 33\nminSdkVersion 21");
    expect(c.compileSdk).toBe("33");
    expect(c.minSdk).toBe("21");
  });
});

