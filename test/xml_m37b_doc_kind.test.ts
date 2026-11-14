import { describe, expect, it } from "vitest";
import { codeOnlyNotice, detectDocKind, kindOfPath, localTag, looksLikeJavaSource, looksLikeKotlin, rootTagOf } from "@/lib/xml/doc-kind";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<!-- 应用清单 -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.demo.app">
  <application android:label="@string/app_name" />
</manifest>`;

const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:orientation="vertical" android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" />
</LinearLayout>`;

describe("M37b rootTagOf", () => {
  it("跳过声明/注释/DOCTYPE", () => {
    expect(rootTagOf(MANIFEST)).toBe("manifest");
    expect(rootTagOf(LAYOUT)).toBe("LinearLayout");
    expect(rootTagOf(`<!DOCTYPE foo [ <!ENTITY x "y"> ]><FrameLayout />`)).toBe("FrameLayout");
    expect(rootTagOf("")).toBeNull();
    expect(rootTagOf("   ")).toBeNull();
    expect(rootTagOf("<")).toBeNull();
  });

  it("localTag 去掉命名空间前缀", () => {
    expect(localTag("androidx.constraintlayout.widget.ConstraintLayout")).toBe(
      "androidx.constraintlayout.widget.ConstraintLayout",
    );
    expect(localTag("android:View")).toBe("View");
  });
});

describe("M37b kindOfPath", () => {
  it("布局 / 非布局 / 未知", () => {
    expect(kindOfPath("app/src/main/res/layout/activity_main.xml")).toBe("layout");
    expect(kindOfPath("res/layout-land/main.xml")).toBe("layout");
    expect(kindOfPath("app/src/main/AndroidManifest.xml")).toBe("code");
    expect(kindOfPath("app/src/main/res/values/strings.xml")).toBe("code");
    expect(kindOfPath("app/src/main/res/menu/main.xml")).toBe("code");
    expect(kindOfPath("app/src/main/res/drawable/ic_launcher.xml")).toBe("code");
    expect(kindOfPath("app/src/main/java/com/demo/MainActivity.java")).toBe("code");
    expect(kindOfPath("build.gradle")).toBe("code");
    expect(kindOfPath("activity_main.xml")).toBeNull();
    expect(kindOfPath(null)).toBeNull();
  });
});

describe("M37b detectDocKind", () => {
  it("路径优先：manifest 即使内容像布局也是 code", () => {
    expect(detectDocKind(LAYOUT, "app/src/main/AndroidManifest.xml")).toBe("code");
  });

  it("路径优先：layout 目录下即使是 <merge> 也是 layout", () => {
    expect(detectDocKind("<merge><View /></merge>", "res/layout/part.xml")).toBe("layout");
  });

  it("没路径时看根标签：manifest / resources / vector / menu → code", () => {
    expect(detectDocKind(MANIFEST)).toBe("code");
    expect(detectDocKind("<resources><string name=\"a\">b</string></resources>")).toBe("code");
    expect(detectDocKind("<shape xmlns:android=\"x\"><corners /></shape>")).toBe("code");
    expect(detectDocKind("<vector xmlns:android=\"x\" />")).toBe("code");
    expect(detectDocKind("<menu />")).toBe("code");
  });

  it("没路径时看根标签：布局根 → layout；未知根兜底 layout（保持老行为）", () => {
    expect(detectDocKind(LAYOUT)).toBe("layout");
    expect(detectDocKind("<FrameLayout />")).toBe("layout");
    expect(detectDocKind("<SomeCustomThing />")).toBe("layout");
    expect(detectDocKind("")).toBe("layout");
  });

  it("第二个参数当文件名回落使用", () => {
    expect(detectDocKind(MANIFEST, null, "AndroidManifest.xml")).toBe("code");
  });
});

describe("M37b codeOnlyNotice 文案", () => {
  it("manifest 有专属说明", () => {
    const n = codeOnlyNotice("app/src/main/AndroidManifest.xml");
    expect(n.title).toContain("AndroidManifest.xml");
    expect(n.msg).toContain("清单");
  });

  it("文件名带完整路径也能取出短名", () => {
    expect(codeOnlyNotice("res/values/strings.xml").title.startsWith("strings.xml")).toBe(true);
    expect(codeOnlyNotice("").title.length).toBeGreaterThan(0);
  });
});

describe("M255 looksLikeJavaSource / looksLikeKotlin（按内容嗅探，防 XML 规则误伤 Java/Kotlin）", () => {
  const KOTLIN_FRAGMENT = [
    "if (System.currentTimeMillis() - backPressedTime < EXIT_INTERVAL) {",
    "    super.onBackPressed()",
    "} else {",
    "    backPressedTime = System.currentTimeMillis()",
    "    Toast.makeText(this, \"再按一次退出应用\", Toast.LENGTH_SHORT).show()",
    "}",
  ].join("\n");

  it("Kotlin 片段（无 package/class 头，靠 Toast/System/this 强信号）被认出来", () => {
    expect(looksLikeJavaSource(KOTLIN_FRAGMENT)).toBe(true);
    expect(looksLikeKotlin(KOTLIN_FRAGMENT)).toBe(true); // 全篇 0 分号
  });

  it("带 class 头的 Java 被认出", () => {
    expect(looksLikeJavaSource("package com.x;\nimport android.app.Activity;\npublic class A extends Activity {\n}")).toBe(true);
    expect(looksLikeKotlin("public class A extends Activity {\n}")).toBe(false); // 有 ; 且无 val/fun
  });

  it("XML 布局不被误认成 Java", () => {
    expect(looksLikeJavaSource(LAYOUT)).toBe(false);
    expect(looksLikeJavaSource(MANIFEST)).toBe(false);
  });

  it("空串 / 纯空白不报 Java", () => {
    expect(looksLikeJavaSource("")).toBe(false);
    expect(looksLikeJavaSource("   \n  ")).toBe(false);
  });
});
