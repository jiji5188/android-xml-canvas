import { describe, it, expect } from "vitest";
import { forceManifestPkg, dominantJavaPackage } from "../lib/xml/find-launcher";

describe("forceManifestPkg (M268)", () => {
  it("改已有 package 属性", () => {
    const r = forceManifestPkg(
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.momo.ReturnSystem"><application/></manifest>',
      "com.momo.ReturnSystem3",
    );
    expect(r.changed).toBe(true);
    expect(r.text).toContain('package="com.momo.ReturnSystem3"');
    expect(r.text).not.toContain("com.momo.ReturnSystem\"");
  });

  it("android: 前缀也能改", () => {
    const r = forceManifestPkg(
      '<manifest android:package="com.old"><application/></manifest>',
      "com.new",
    );
    expect(r.changed).toBe(true);
    expect(r.text).toContain('android:package="com.new"');
  });

  it("没有 package 就插到 <manifest 开标签", () => {
    const r = forceManifestPkg(
      '<manifest xmlns:a="http://schemas.android.com/apk/res/android" versionCode="1"><application/></manifest>',
      "com.inserted",
    );
    expect(r.changed).toBe(true);
    expect(r.text).toMatch(/<manifest[^>]*package="com\.inserted"/);
    // 没动 versionCode
    expect(r.text).toContain('versionCode="1"');
  });

  it("包名相同 → 不改", () => {
    const src = '<manifest package="com.same"><application/></manifest>';
    const r = forceManifestPkg(src, "com.same");
    expect(r.changed).toBe(false);
    expect(r.text).toBe(src);
  });

  it("空 manifest / 空 pkg 原样返回", () => {
    expect(forceManifestPkg("", "x")).toEqual({ text: "", changed: false });
    expect(forceManifestPkg("<manifest/>", "")).toEqual({ text: "<manifest/>", changed: false });
  });
});

describe("dominantJavaPackage (M268)", () => {
  it("多数决", () => {
    const srcs = [
      { path: "a.java", code: "package com.momo.ReturnSystem3;\nclass A{}" },
      { path: "b.java", code: "package com.momo.ReturnSystem3;\nclass B{}" },
      { path: "c.java", code: "package com.momo.ReturnSystem;\nclass C{}" },
    ];
    expect(dominantJavaPackage(srcs)).toBe("com.momo.ReturnSystem3");
  });

  it("没 package 声明 → 空", () => {
    expect(dominantJavaPackage([{ path: "a.java", code: "class A{}" }])).toBe("");
  });

  it("空输入 → 空", () => {
    expect(dominantJavaPackage([])).toBe("");
  });

  it("Kotlin 的 package 行也能认", () => {
    expect(dominantJavaPackage([{ path: "A.kt", code: "package com.kt.x\n\nclass A" }])).toBe("com.kt.x");
  });
});
