// test/xml_m189_publish_info.test.ts — M189：版本信息读写 + 发布前检查
import { describe, it, expect } from "vitest";
import {
  bumpVersionCode,
  checkPublish,
  readPublishInfo,
  setPublishVersion,
} from "../lib/xml/gradle-publish";

const GRADLE = `plugins {
    id 'com.android.application'
}

android {
    namespace 'com.example.myapp'
    compileSdk 34

    defaultConfig {
        applicationId 'com.example.myapp'
        minSdk 24
        targetSdk 34
        versionCode 7
        versionName '1.3'
    }
}
`;

const KTS = `android {
    namespace = "com.acme.demo"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.acme.demo"
        minSdk = 26
        targetSdk = 34
        versionCode = 12
        versionName = "2.0.1"
    }
}
`;

describe("M189 readPublishInfo", () => {
  it("Groovy 写法全部读到", () => {
    const i = readPublishInfo(GRADLE);
    expect(i.versionCode).toBe(7);
    expect(i.versionName).toBe("1.3");
    expect(i.applicationId).toBe("com.example.myapp");
    expect(i.namespace).toBe("com.example.myapp");
    expect(i.minSdk).toBe(24);
    expect(i.targetSdk).toBe(34);
    expect(i.compileSdk).toBe(34);
  });

  it("KTS 写法（带 = 和双引号）同样能读", () => {
    const i = readPublishInfo(KTS);
    expect(i.versionCode).toBe(12);
    expect(i.versionName).toBe("2.0.1");
    expect(i.applicationId).toBe("com.acme.demo");
    expect(i.minSdk).toBe(26);
  });

  it("缺字段就是 null，不乱猜", () => {
    const i = readPublishInfo("android { }");
    expect(i.versionCode).toBeNull();
    expect(i.versionName).toBeNull();
    expect(i.applicationId).toBeNull();
  });
});

describe("M189 setPublishVersion", () => {
  it("改 versionCode 保留原写法", () => {
    const r = setPublishVersion(GRADLE, { versionCode: 8 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("versionCode 8");
    expect(r.text).not.toContain("versionCode 7");
  });

  it("改 versionName 保留引号风格（单引号）", () => {
    const r = setPublishVersion(GRADLE, { versionName: "1.4" });
    expect(r.text).toContain("versionName '1.4'");
  });

  it("KTS 双引号风格也保持", () => {
    const r = setPublishVersion(KTS, { versionName: "2.1.0", versionCode: 13 });
    expect(r.text).toContain('versionName = "2.1.0"');
    expect(r.text).toContain("versionCode = 13");
  });

  it("两项一起改", () => {
    const r = setPublishVersion(GRADLE, { versionCode: 9, versionName: "1.5" });
    expect(r.ok).toBe(true);
    expect(readPublishInfo(r.text).versionCode).toBe(9);
    expect(readPublishInfo(r.text).versionName).toBe("1.5");
  });

  it("字段不存在时报错不改文本", () => {
    const r = setPublishVersion("android { }", { versionCode: 2 });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("android { }");
  });

  it("versionCode 非法值（0/负数）被夹到 1", () => {
    expect(readPublishInfo(setPublishVersion(GRADLE, { versionCode: 0 }).text).versionCode).toBe(1);
    expect(readPublishInfo(setPublishVersion(GRADLE, { versionCode: -5 }).text).versionCode).toBe(1);
  });
});

describe("M189 bumpVersionCode", () => {
  it("默认 +1", () => {
    const r = bumpVersionCode(GRADLE);
    expect(r.ok).toBe(true);
    expect(r.next).toBe(8);
    expect(readPublishInfo(r.text).versionCode).toBe(8);
  });

  it("可以一次 +10（跳过几个内部版本）", () => {
    const r = bumpVersionCode(GRADLE, 10);
    expect(r.next).toBe(17);
  });

  it("没有 versionCode 时 ok=false", () => {
    expect(bumpVersionCode("android { }").ok).toBe(false);
  });
});

describe("M189 checkPublish", () => {
  it("正常工程：没有 error（可能只有 com.example 类 warning）", () => {
    const issues = checkPublish({
      info: readPublishInfo(GRADLE),
      keystoreExists: true,
      anyScheme: true,
    });
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    // com.example.* 会给一条 warn
    expect(issues.some((i) => i.msg.includes("com.example"))).toBe(true);
  });

  it("自建包名 + 一切正常：完全没问题", () => {
    const g = GRADLE.replace(/com\.example\.myapp/g, "com.acme.app");
    expect(checkPublish({ info: readPublishInfo(g), keystoreExists: true, anyScheme: true })).toEqual([]);
  });

  it("versionCode 缺失 → error", () => {
    const issues = checkPublish({ info: readPublishInfo("android { }"), keystoreExists: true, anyScheme: true });
    expect(issues.some((i) => i.level === "error" && i.msg.includes("versionCode"))).toBe(true);
  });

  it("包名不合法 → error + fix set-package", () => {
    const g = 'android { namespace "Bad-PKG" }';
    const issues = checkPublish({ info: readPublishInfo(g), keystoreExists: true, anyScheme: true });
    const hit = issues.find((i) => i.fix === "set-package");
    expect(hit?.level).toBe("error");
  });

  it("targetSdk < minSdk → error", () => {
    const g = GRADLE.replace("targetSdk 34", "targetSdk 21");
    const issues = checkPublish({ info: readPublishInfo(g), keystoreExists: true, anyScheme: true });
    expect(issues.some((i) => i.msg.includes("targetSdk 比 minSdk"))).toBe(true);
  });

  it("keystore 不存在 → warn（不阻断）", () => {
    const issues = checkPublish({ info: readPublishInfo(GRADLE), keystoreExists: false, storeFile: ".axv/r.keystore", anyScheme: true });
    const hit = issues.find((i) => i.msg.includes("keystore"));
    expect(hit?.level).toBe("warn");
    expect(hit?.msg).toContain(".axv/r.keystore");
  });

  it("v1/v2/v3 全关 → error", () => {
    const issues = checkPublish({ info: readPublishInfo(GRADLE), keystoreExists: true, anyScheme: false });
    expect(issues.some((i) => i.fix === "enable-v2")).toBe(true);
  });

  it("结果按 error → warn → info 排序", () => {
    const g = 'android { namespace "com.example.x" }';
    const issues = checkPublish({
      info: readPublishInfo(g),
      keystoreExists: false,
      anyScheme: false,
      defaultAppName: true,
    });
    const ranks = issues.map((i) => (i.level === "error" ? 0 : i.level === "warn" ? 1 : 2));
    expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
  });
});
