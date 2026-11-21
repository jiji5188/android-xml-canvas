// M462：AndroidManifest.xml → build.gradle 同步（package / versionCode / versionName）
// 用户：manifest 改版本和包名也要同步 build.gradle，不然「这改一些那改一些容易改乱」。
import { describe, expect, it } from "vitest";
import {
  readManifestAppAttrs,
  syncManifestAttrsToGradle,
} from "@/lib/xml/manifest-gradle-sync";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.momo.returnsystem2"
    android:versionCode="478"
    android:versionName="1.18.65">
    <application android:label="@string/app_name" />
</manifest>`;

const MANIFEST_USESSDK = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.foo.bar">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="30"
        android:versionCode="12" android:versionName="3.2.1" />
    <application />
</manifest>`;

const GRADLE = `plugins { id "com.android.application" }
android {
    namespace 'com.old.pkg'
    compileSdk 34
    defaultConfig {
        applicationId "com.old.pkg"
        minSdk 24
        targetSdk 34
        versionCode 478
        versionName "1.18.64"
    }
}`;

describe("M462 readManifestAppAttrs", () => {
  it("读 manifest 根上的 package + versionCode + versionName", () => {
    const a = readManifestAppAttrs(MANIFEST);
    expect(a.pkg).toBe("com.momo.returnsystem2");
    expect(a.versionCode).toBe("478");
    expect(a.versionName).toBe("1.18.65");
  });

  it("读 <uses-sdk> 上的 versionCode/Name（根上没有时）", () => {
    const a = readManifestAppAttrs(MANIFEST_USESSDK);
    expect(a.pkg).toBe("com.foo.bar");
    expect(a.versionCode).toBe("12");
    expect(a.versionName).toBe("3.2.1");
  });

  it("没有 uses-sdk 的版本属性 → 空串", () => {
    const a = readManifestAppAttrs(`<manifest package="com.x"><application /></manifest>`);
    expect(a.pkg).toBe("com.x");
    expect(a.versionCode).toBe("");
    expect(a.versionName).toBe("");
  });
});

describe("M462 syncManifestAttrsToGradle", () => {
  it("包名不一致 → namespace + applicationId 一起换", () => {
    const r = syncManifestAttrsToGradle(MANIFEST, GRADLE);
    expect(r.ok).toBe(true);
    expect(r.changed).toContain("package");
    expect(r.text).toMatch(/namespace [\"']com\.momo\.returnsystem2[\"']/);
    expect(r.text).toMatch(/applicationId "com\.momo\.returnsystem2"/);
    // 其它行保留
    expect(r.text).toContain("compileSdk 34");
  });

  it("versionCode/Name 不一致 → 替换 defaultConfig 里的值", () => {
    // 用 uses-sdk 版本（vc=12 / vn=3.2.1），与 GRADLE 的 478/1.18.64 都不同
    const r = syncManifestAttrsToGradle(MANIFEST_USESSDK, GRADLE);
    expect(r.changed).toEqual(expect.arrayContaining(["versionCode", "versionName"]));
    expect(r.text).toMatch(/versionCode 12/);
    expect(r.text).toMatch(/versionName "3\.2\.1"/);
  });

  it("全部一致 → 无变更（text 原样）", () => {
    const same = `android {
    namespace 'com.momo.returnsystem2'
    defaultConfig {
        applicationId "com.momo.returnsystem2"
        versionCode 478
        versionName "1.18.65"
    }
}`;
    const r = syncManifestAttrsToGradle(MANIFEST, same);
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual([]);
    expect(r.text).toBe(same);
  });

  it("manifest 没有 versionCode/Name → 不碰 gradle 的版本", () => {
    const r = syncManifestAttrsToGradle(
      `<manifest package="com.a"><application /></manifest>`,
      GRADLE,
    );
    expect(r.changed).not.toContain("versionCode");
    expect(r.changed).not.toContain("versionName");
    expect(r.text).toContain('versionName "1.18.64"');
  });

  it("gradle 缺失 versionCode → M461 兜底插入 defaultConfig", () => {
    const g = `android {
    namespace 'com.momo.returnsystem2'
    defaultConfig {
        minSdk 24
    }
}`;
    const r = syncManifestAttrsToGradle(MANIFEST, g);
    expect(r.changed).toEqual(expect.arrayContaining(["versionCode", "versionName"]));
    const dc = r.text.match(/defaultConfig \{[\s\S]*?\}/)?.[0] || "";
    expect(dc).toMatch(/versionCode 478/);
    expect(dc).toMatch(/versionName "1\.18\.65"/);
    expect(dc).toContain("minSdk 24");
  });

  it("kts 工程：缺失字段用 = 号插入", () => {
    const g = `android {
    namespace = "com.momo.returnsystem2"
    defaultConfig {
        minSdk = 24
    }
}`;
    const r = syncManifestAttrsToGradle(MANIFEST, g, true);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/versionCode = 478/);
    expect(r.text).toMatch(/versionName = "1\.18\.65"/);
  });

  it("MANIFEST+GRADLE 默认样例：包名和 versionName 不一致（vc 相同）", () => {
    const r = syncManifestAttrsToGradle(MANIFEST, GRADLE);
    // vc 478 两边一样 → 不写；包名 + versionName 写
    expect(r.changed).toEqual(["package", "versionName"]);
  });

  it("三项全不一致 → 全写", () => {
    const r = syncManifestAttrsToGradle(MANIFEST_USESSDK, GRADLE);
    expect(r.changed).toEqual(expect.arrayContaining(["package", "versionCode", "versionName"]));
  });
});
