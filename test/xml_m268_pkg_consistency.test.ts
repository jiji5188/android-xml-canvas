import { describe, it, expect } from "vitest";
import { forceManifestPkg, dominantJavaPackage, rPackageFromSources } from "../lib/xml/find-launcher";

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

describe("rPackageFromSources (M271)", () => {
  it("显式 import 新包 R 优先于多数旧包", () => {
    const srcs = [
      // 多数文件还在旧包
      { path: "a.java", code: "package com.momo.ReturnSystem;\nimport com.momo.ReturnSystem.R;\nclass A{int x=R.layout.a;}" },
      { path: "b.java", code: "package com.momo.ReturnSystem;\nclass B{}" },
      { path: "c.java", code: "package com.momo.ReturnSystem;\nclass C{}" },
      // 少数文件 import 新包 R
      { path: "TableAdapter.java", code: "package com.momo.ReturnSystem3;\nimport com.momo.ReturnSystem3.R;\nclass T{}" },
    ];
    expect(rPackageFromSources(srcs)).toBe("com.momo.ReturnSystem");
    // 多数 import 旧包 → 取多数
  });

  it("import R 的包取多数", () => {
    const srcs = [
      { path: "a.java", code: "package p;\nimport com.momo.ReturnSystem3.R;\nclass A{}" },
      { path: "b.java", code: "package p;\nimport com.momo.ReturnSystem3.R;\nclass B{}" },
      { path: "c.java", code: "package p;\nimport com.old.R;\nclass C{}" },
    ];
    expect(rPackageFromSources(srcs)).toBe("com.momo.ReturnSystem3");
  });

  it("没 import 时，同包直接用 R.layout 的文件包名", () => {
    const srcs = [
      { path: "Home.java", code: "package com.app.x;\nclass H{int a=R.layout.home;}" },
      { path: "Home2.java", code: "package com.app.x;\nclass H2{int b=R.id.b;}" },
    ];
    expect(rPackageFromSources(srcs)).toBe("com.app.x");
  });

  it("完全没 R 引用 → 空（调用方回退）", () => {
    expect(rPackageFromSources([{ path: "a.java", code: "package p;\nclass A{}" }])).toBe("");
  });
});
