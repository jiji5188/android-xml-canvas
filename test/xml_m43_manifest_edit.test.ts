// M43：AndroidManifest.xml 视图编辑（纯逻辑）
import { describe, it, expect } from "vitest";
import {
  appendComponent,
  appendPermission,
  attrOfElement,
  findElements,
  isManifestPath,
  looksLikeManifest,
  parseManifest,
  removeElement,
  setElementAttr,
} from "@/lib/xml/manifest-edit";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<!-- 顶部注释要保留 -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.demo.app">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service android:name=".SyncService" />
    </application>
</manifest>
`;

describe("parseManifest", () => {
  it("解析出根 / uses-sdk / application / 权限 / 组件", () => {
    const d = parseManifest(SAMPLE);
    expect(d.ok).toBe(true);
    expect(attrOfElement(SAMPLE, d.manifest!, "package")).toBe("com.demo.app");
    expect(attrOfElement(SAMPLE, d.usesSdk!, "android:minSdkVersion")).toBe("21");
    expect(attrOfElement(SAMPLE, d.usesSdk!, "android:targetSdkVersion")).toBe("34");
    expect(attrOfElement(SAMPLE, d.application!, "android:label")).toBe("@string/app_name");
    expect(d.permissions.map((p) => attrOfElement(SAMPLE, p, "android:name"))).toEqual([
      "android.permission.INTERNET",
      "android.permission.CAMERA",
    ]);
    expect(d.components.map((c) => `${c.tag}:${attrOfElement(SAMPLE, c, "android:name")}`)).toEqual([
      "activity:.MainActivity",
      "service:.SyncService",
    ]);
  });

  it("没有 manifest 根节点 → ok=false", () => {
    const d = parseManifest("<resources></resources>");
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("manifest");
  });

  it("自闭合和带子节点都能算对 end", () => {
    const acts = findElements(SAMPLE, "activity");
    expect(acts).toHaveLength(1);
    const body = SAMPLE.slice(acts[0].from, acts[0].end);
    expect(body).toContain("</activity>");
    expect(body).toContain("intent-filter");
  });
});

describe("setElementAttr", () => {
  it("改已有属性只动值", () => {
    const d = parseManifest(SAMPLE);
    const next = setElementAttr(SAMPLE, d.manifest!, "package", "com.demo.next");
    expect(next).toContain('package="com.demo.next"');
    expect(next).toContain("<!-- 顶部注释要保留 -->");
    expect(next.replace("com.demo.next", "com.demo.app")).toBe(SAMPLE);
  });

  it("补不存在的属性（普通开标签）", () => {
    const d = parseManifest(SAMPLE);
    const next = setElementAttr(SAMPLE, d.usesSdk!, "android:debuggable", "true");
    expect(next).toContain('android:targetSdkVersion="34" android:debuggable="true" />');
  });

  it("补不存在属性的自闭合标签不会插到 /> 外面", () => {
    const d = parseManifest(SAMPLE);
    const perm = d.permissions[0];
    const next = setElementAttr(SAMPLE, perm, "android:maxSdkVersion", "33");
    expect(next).toContain('android:name="android.permission.INTERNET" android:maxSdkVersion="33" />');
  });
});

describe("removeElement / append", () => {
  it("删权限整行干净", () => {
    const d = parseManifest(SAMPLE);
    const next = removeElement(SAMPLE, d.permissions[1]);
    expect(next).not.toContain("android.permission.CAMERA");
    expect(next).toContain("android.permission.INTERNET");
    expect(next).toContain("<!-- 顶部注释要保留 -->");
  });

  it("追加权限插在 </manifest> 前", () => {
    const next = appendPermission(SAMPLE, "android.permission.VIBRATE");
    expect(next).toContain('<uses-permission android:name="android.permission.VIBRATE" />');
    expect(next.indexOf("VIBRATE")).toBeLessThan(next.indexOf("</manifest>"));
    expect(next).toContain("android.permission.CAMERA");
  });

  it("追加组件插在 </application> 前并保持缩进", () => {
    const next = appendComponent(SAMPLE, "activity", {
      "android:name": ".DetailActivity",
      "android:exported": "false",
    });
    expect(next).toContain('<activity android:name=".DetailActivity" android:exported="false" />');
    expect(next.indexOf("DetailActivity")).toBeLessThan(next.indexOf("</application>"));
    expect(next.indexOf("DetailActivity")).toBeGreaterThan(next.indexOf("<service"));
  });
});

describe("识别", () => {
  it("looksLikeManifest 只认根节点", () => {
    expect(looksLikeManifest(SAMPLE)).toBe(true);
    expect(looksLikeManifest('<resources><string name="a">x</string></resources>')).toBe(false);
  });

  it("isManifestPath 认各种路径", () => {
    expect(isManifestPath("app/src/main/AndroidManifest.xml")).toBe(true);
    expect(isManifestPath("AndroidManifest.xml")).toBe(true);
    expect(isManifestPath("res/layout/main.xml")).toBe(false);
  });
});
