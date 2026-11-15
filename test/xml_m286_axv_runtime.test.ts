import { describe, it, expect } from "vitest";
import { axvRuntimeSources, injectAxvLogProvider, axvLogProviderFqn, axvLogAuthorities } from "../lib/xml/axv-runtime";

describe("axvRuntimeSources M286", () => {
  it("生成两个 .java 文件，路径与包名一致", () => {
    const srcs = axvRuntimeSources("com.example.myapp");
    expect(srcs.length).toBe(2);
    const p1 = srcs[0].path;
    const p2 = srcs[1].path;
    expect(p1).toBe("src/com/example/myapp/axvlog/AxvRuntimeLog.java");
    expect(p2).toBe("src/com/example/myapp/axvlog/AxvLogProvider.java");
    expect(srcs[0].code).toContain("package com.example.myapp.axvlog;");
    expect(srcs[1].code).toContain("public class AxvLogProvider extends ContentProvider");
    expect(srcs[0].code).toContain("registerActivityLifecycleCallbacks");
    expect(srcs[0].code).toContain("Thread.setDefaultUncaughtExceptionHandler");
    // 不依赖 androidx（注释里提到 androidx.startup 是说明，不算 import）
    expect(srcs[0].code + srcs[1].code).not.toContain("import androidx");
  });

  it("不同包名生成不同目录", () => {
    const s = axvRuntimeSources("org.foo.bar");
    expect(s[0].path).toBe("src/org/foo/bar/axvlog/AxvRuntimeLog.java");
  });
});

describe("injectAxvLogProvider M286", () => {
  const manifest =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.myapp">\n' +
    "  <application>\n" +
    "    <activity android:name=\".MainActivity\" />\n" +
    "  </application>\n" +
    "</manifest>";

  it("正常插入 <application> 内", () => {
    const r = injectAxvLogProvider(manifest, "com.example.myapp");
    expect(r.injected).toBe(true);
    expect(r.text).toContain("com.example.myapp.axvlog.AxvLogProvider");
    // 必须在 </application> 之前
    const idxProv = r.text.indexOf("<provider");
    const idxEnd = r.text.lastIndexOf("</application>");
    expect(idxProv).toBeGreaterThan(0);
    expect(idxProv).toBeLessThan(idxEnd);
  });

  it("已存在则不重复插", () => {
    const r1 = injectAxvLogProvider(manifest, "com.example.myapp");
    const r2 = injectAxvLogProvider(r1.text, "com.example.myapp");
    expect(r2.injected).toBe(false);
    expect(r2.reason).toBe("already");
    expect(r2.text.split("AxvLogProvider").length - 1).toBe(1);
  });

  it("没有 <application> 时拒绝", () => {
    const r = injectAxvLogProvider("<manifest></manifest>", "a.b");
    expect(r.injected).toBe(false);
    expect(r.reason).toBe("no-application");
  });

  it("空 manifest 拒绝", () => {
    const r = injectAxvLogProvider("", "a.b");
    expect(r.injected).toBe(false);
    expect(r.reason).toBe("empty");
  });

  it("authorities 唯一", () => {
    expect(axvLogAuthorities("com.example")).toBe("com.example.axvlog.provider");
    expect(axvLogProviderFqn("com.example")).toBe("com.example.axvlog.AxvLogProvider");
  });
});
