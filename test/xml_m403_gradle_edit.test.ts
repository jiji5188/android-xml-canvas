// test/xml_m403_gradle_edit.test.ts — M403：gradle 可编辑纯函数
import { describe, it, expect } from "vitest";
import {
  findBlock,
  readGradleProp,
  setGradleProp,
  listGradleProps,
  parseBuildFeatures,
  setBuildFeature,
  parseRepoScope,
  addRepoUrl,
  removeRepoUrl,
} from "../lib/xml/gradle-edit";

const SETTINGS = [
  "pluginManagement {",
  "    repositories {",
  "        google()",
  "        mavenCentral()",
  "    }",
  "}",
  "dependencyResolutionManagement {",
  "    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)",
  "    repositories {",
  "        google()",
  "        mavenCentral()",
  "        maven { url 'https://jitpack.io' }",
  "    }",
  "}",
  "rootProject.name = 'MyApp'",
  "include ':app'",
].join("\n");

const ROOT_BUILD = [
  "buildscript {",
  "    repositories {",
  "        google()",
  "        mavenCentral()",
  "    }",
  "    dependencies {",
  "        classpath 'com.android.tools.build:gradle:8.5.2'",
  "    }",
  "}",
  "allprojects {",
  "    repositories {",
  "        maven { url 'https://dl.google.com/maven2' }",
  "    }",
  "}",
].join("\n");

const APP_BUILD = [
  "android {",
  "    compileSdk 34",
  "    defaultConfig { minSdk 24 }",
  "    buildFeatures {",
  "        viewBinding true",
  "        buildConfig false",
  "    }",
  "}",
].join("\n");

const PROPS = [
  "# comment",
  "org.gradle.jvmargs=-Xmx4g",
  "android.useAndroidX=true",
  "android.enableJetifier=true",
  "android.nonTransitiveRClass=true",
].join("\n");

describe("findBlock", () => {
  it("找到嵌套块的正确闭合", () => {
    const t = "android {\n  buildFeatures {\n    viewBinding true\n  }\n}";
    const b = findBlock(t, "buildFeatures");
    expect(b).not.toBeNull();
    expect(t.slice(b!.open, b!.close)).toContain("viewBinding true");
  });
  it("字符串里的花括号不干扰", () => {
    const t = "x { }";
    const b = findBlock(t, "x");
    expect(b).not.toBeNull();
  });
});

describe("gradle.properties 编辑", () => {
  it("读到现有值", () => {
    expect(readGradleProp(PROPS, "android.useAndroidX")).toBe("true");
    expect(readGradleProp(PROPS, "org.gradle.jvmargs")).toBe("-Xmx4g");
    expect(readGradleProp(PROPS, "android.enableJetifier")).toBe("true");
  });
  it("改现有 key", () => {
    const r = setGradleProp(PROPS, "android.useAndroidX", "false");
    expect(r.changed).toBe(true);
    expect(r.text).toContain("android.useAndroidX=false");
    expect(r.text).toContain("android.enableJetifier=true");
  });
  it("新增 key 追加末尾", () => {
    const r = setGradleProp(PROPS, "android.nonFinalResIds", "true");
    expect(r.changed).toBe(true);
    expect(r.text.trimEnd().endsWith("android.nonFinalResIds=true")).toBe(true);
  });
  it("listGradleProps 列出全部 key", () => {
    expect(listGradleProps(PROPS)).toEqual([
      "org.gradle.jvmargs",
      "android.useAndroidX",
      "android.enableJetifier",
      "android.nonTransitiveRClass",
    ]);
  });
});

describe("buildFeatures", () => {
  it("解析开关 + 键列表", () => {
    const bf = parseBuildFeatures(APP_BUILD);
    expect(bf.viewBinding).toBe(true);
    expect(bf.buildConfig).toBe(false);
    expect(bf.keys).toContain("viewBinding");
    expect(bf.keys).toContain("buildConfig");
  });
  it("改现有键", () => {
    const r = setBuildFeature(APP_BUILD, "buildConfig", true);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/buildConfig true/);
  });
  it("新增键到 buildFeatures 块", () => {
    const r = setBuildFeature(APP_BUILD, "compose", true);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("compose true");
  });
  it("没有 buildFeatures 块 → 建在 android { } 里", () => {
    const t = "android {\n  compileSdk 34\n}";
    const r = setBuildFeature(t, "viewBinding", true);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("buildFeatures {");
  });
  it("不识别的键报错", () => {
    const r = setBuildFeature(APP_BUILD, "fake", true);
    expect(r.ok).toBe(false);
  });
});

describe("仓库 scope 区分", () => {
  it("buildscript / allprojects 不混淆", () => {
    const bs = parseRepoScope(ROOT_BUILD, "buildscript");
    const al = parseRepoScope(ROOT_BUILD, "allprojects");
    expect(bs.map((e) => e.name)).toEqual(["google", "mavenCentral"]);
    expect(al.map((e) => e.url)).toEqual(["https://dl.google.com/maven2"]);
    // buildscript 里没有那个 maven url
    expect(bs.some((e) => e.url === "https://dl.google.com/maven2")).toBe(false);
  });
  it("settings scope 含 pluginManagement + dependencyResolutionManagement", () => {
    const st = parseRepoScope(SETTINGS, "settings");
    expect(st.some((e) => e.url === "https://jitpack.io")).toBe(true);
    expect(st.some((e) => e.name === "gradlePluginPortal")).toBe(false);
  });
  it("addRepoUrl 进 allprojects（不动 buildscript）", () => {
    const r = addRepoUrl(ROOT_BUILD, "allprojects", "https://maven.aliyun.com/repository/public");
    expect(r.ok).toBe(true);
    const al = parseRepoScope(r.text, "allprojects");
    expect(al.some((e) => e.url === "https://maven.aliyun.com/repository/public")).toBe(true);
    const bs = parseRepoScope(r.text, "buildscript");
    expect(bs.some((e) => e.url === "https://maven.aliyun.com/repository/public")).toBe(false);
  });
  it("removeRepoUrl 只删指定 scope 那条", () => {
    const r = removeRepoUrl(ROOT_BUILD, "allprojects", "https://dl.google.com/maven2");
    expect(r.ok).toBe(true);
    expect(parseRepoScope(r.text, "allprojects").length).toBe(0);
    // buildscript 的 google/mavenCentral 还在
    expect(parseRepoScope(r.text, "buildscript").length).toBe(2);
  });
});
