// M181：项目属性的纯函数 —— 包名解析/替换、gradle 依赖增删
import { describe, it, expect } from "vitest";
import {
  parseGradlePackage,
  setGradlePackage,
  listGradleDeps,
  addGradleDep,
  removeGradleDep,
} from "@/lib/xml/project-info";

const GROOVY = `plugins { id 'com.android.application' }
android {
    namespace "com.example.demo"
    applicationId "com.example.demo"
    compileSdk 35
}
dependencies {
    implementation "androidx.appcompat:appcompat:1.7.0"
    implementation 'com.google.android.material:material:1.12.0'
    testImplementation "junit:junit:4.13.2"
}
`;

const KTS = `plugins {
    id("com.android.application")
}
android {
    namespace = "com.example.kts"
    applicationId = "com.example.kts"
    compileSdk = 35
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.0")
    testImplementation("junit:junit:4.13.2")
}
`;

describe("parseGradlePackage", () => {
  it("Groovy 写法两个都拿到", () => {
    const r = parseGradlePackage(GROOVY);
    expect(r.namespace).toBe("com.example.demo");
    expect(r.applicationId).toBe("com.example.demo");
  });
  it("KTS 写法两个都拿到", () => {
    const r = parseGradlePackage(KTS);
    expect(r.namespace).toBe("com.example.kts");
    expect(r.applicationId).toBe("com.example.kts");
  });
  it("都没有就都 null", () => {
    const r = parseGradlePackage("android { compileSdk 35 }\n");
    expect(r.namespace).toBeNull();
    expect(r.applicationId).toBeNull();
  });
});

describe("setGradlePackage", () => {
  it("Groovy：两个都换，原有引号风格保留成双引号", () => {
    const r = setGradlePackage(GROOVY, "com.newpkg.app");
    expect(r.ok).toBe(true);
    expect(parseGradlePackage(r.text).namespace).toBe("com.newpkg.app");
    expect(parseGradlePackage(r.text).applicationId).toBe("com.newpkg.app");
    // 其它行原样
    expect(r.text).toContain("compileSdk 35");
  });
  it("KTS：等号写法", () => {
    const r = setGradlePackage(KTS, "a.b.c");
    expect(r.ok).toBe(true);
    expect(r.text).toContain('namespace = "a.b.c"');
    expect(r.text).toContain('applicationId = "a.b.c"');
  });
  it("只有一个也有替换", () => {
    const r = setGradlePackage("android { applicationId \"x.y.z\" }\n", "q.r");
    expect(r.ok).toBe(true);
    expect(r.text).toContain('applicationId "q.r"');
  });
  it("两个都没有 → 报错不改", () => {
    const src = "android { compileSdk 35 }\n";
    const r = setGradlePackage(src, "x");
    expect(r.ok).toBe(false);
    expect(r.text).toBe(src);
  });
});

describe("listGradleDeps", () => {
  it("Groovy 空格 + 括号混合都能列出来", () => {
    expect(listGradleDeps(GROOVY)).toEqual(
      expect.arrayContaining([
        "androidx.appcompat:appcompat:1.7.0",
        "com.google.android.material:material:1.12.0",
        "junit:junit:4.13.2",
      ]),
    );
  });
  it("KTS 括号式", () => {
    expect(listGradleDeps(KTS)).toEqual(
      expect.arrayContaining(["androidx.core:core-ktx:1.13.0"]),
    );
  });
  it("没有 dependencies 块 → 空", () => {
    expect(listGradleDeps("android { }")).toEqual([]);
  });
});

describe("addGradleDep", () => {
  it("Groovy：用空格式追加到块首", () => {
    const r = addGradleDep(GROOVY, "org.greenrobot:eventbus:3.3.1");
    expect(r.ok).toBe(true);
    expect(listGradleDeps(r.text)).toContain("org.greenrobot:eventbus:3.3.1");
    // 原有依赖都在
    expect(listGradleDeps(r.text)).toContain("androidx.appcompat:appcompat:1.7.0");
  });
  it("KTS：用括号式", () => {
    const r = addGradleDep(KTS, "org.jetbrains.kotlinx:kotlinx-coroutines:1.8.1");
    expect(r.ok).toBe(true);
    expect(r.text).toContain('implementation("org.jetbrains.kotlinx:kotlinx-coroutines:1.8.1")');
  });
  it("坐标不合法直接拒", () => {
    const r = addGradleDep(GROOVY, "bad coord !!!");
    expect(r.ok).toBe(false);
    expect(r.text).toBe(GROOVY);
  });
  it("没有 dependencies 块拒", () => {
    const r = addGradleDep("android { }\n", "a:b:1");
    expect(r.ok).toBe(false);
  });
});

describe("removeGradleDep", () => {
  it("Groovy 空格式删掉", () => {
    const r = removeGradleDep(GROOVY, "junit:junit:4.13.2");
    expect(r.ok).toBe(true);
    expect(listGradleDeps(r.text)).not.toContain("junit:junit:4.13.2");
    expect(listGradleDeps(r.text)).toContain("androidx.appcompat:appcompat:1.7.0");
  });
  it("KTS 括号式删掉", () => {
    const r = removeGradleDep(KTS, "junit:junit:4.13.2");
    expect(r.ok).toBe(true);
    expect(r.text).not.toContain("junit:junit:4.13.2");
  });
  it("不存在的坐标 → 提示没找到、原文不动", () => {
    const r = removeGradleDep(GROOVY, "zz:qq:1");
    expect(r.ok).toBe(false);
    expect(r.text).toBe(GROOVY);
  });
});
