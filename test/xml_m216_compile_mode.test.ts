// test/xml_m216_compile_mode.test.ts — M216：打包结果里的编译模式解析
// 背景：M213 引入设备端真编译后，「编译失败」被 catch 掉静默退化成布局壳，
// 用户拿到一个能装但逻辑不生效的 APK 却不知道。现在失败会中止打包，成功也必须标清楚模式。
import { describe, it, expect } from "vitest";
import { compileModeOf } from "@/lib/xml/native-apk";

describe("M216 compileModeOf", () => {
  it("java:N → 真编译模式，类数取 classes 字段", () => {
    expect(compileModeOf({ ok: true, compileMode: "java:2", classes: 2 })).toEqual({ mode: "java", classes: 2 });
  });

  it("java:N 但缺 classes 字段时从字符串里兜底解析", () => {
    expect(compileModeOf({ ok: true, compileMode: "java:3" })).toEqual({ mode: "java", classes: 3 });
  });

  it("none → 布局壳模式（要明确提示用户不会跑逻辑）", () => {
    expect(compileModeOf({ ok: true, compileMode: "none" })).toEqual({ mode: "shell", classes: 0 });
  });

  it("兼容 shell 别名", () => {
    expect(compileModeOf({ ok: true, compileMode: "shell" })).toEqual({ mode: "shell", classes: 0 });
  });

  it("老版本 APK 不带字段 → unknown（不能断言是壳）", () => {
    expect(compileModeOf({ ok: true })).toEqual({ mode: "unknown", classes: 0 });
    expect(compileModeOf(null)).toEqual({ mode: "unknown", classes: 0 });
    expect(compileModeOf(undefined)).toEqual({ mode: "unknown", classes: 0 });
  });

  it("坏数据不抛（java:abc / 空串）", () => {
    expect(compileModeOf({ ok: true, compileMode: "java:abc" })).toEqual({ mode: "java", classes: 0 });
    expect(compileModeOf({ ok: true, compileMode: "" })).toEqual({ mode: "unknown", classes: 0 });
  });

  it("失败结果不会被误判成 java", () => {
    expect(compileModeOf({ ok: false, step: "compile", log: "ECJ: ..." })).toEqual({ mode: "unknown", classes: 0 });
  });
});
