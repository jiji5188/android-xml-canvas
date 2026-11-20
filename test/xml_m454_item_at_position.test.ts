import { describe, it, expect } from "vitest";
import { findMethodTypos, suggestMethod, KNOWN_METHODS } from "@/lib/xml/java-methods";
import { lintJava } from "@/lib/xml/java-lint";

describe("M454 AdapterView 真方法不误报", () => {
  it("getItemAtPosition 在白名单里", () => {
    expect(KNOWN_METHODS).toContain("getItemAtPosition");
  });

  it("list.getItemAtPosition(0) 不报拼写错（以前误报 getItemPosition）", () => {
    const code = "public class A { void f(ListView list) { Object o = list.getItemAtPosition(0); } }";
    const typos = findMethodTypos(code);
    expect(typos.map((t) => t.name)).not.toContain("getItemAtPosition");
  });

  it("其它 AdapterView 家族方法也不报", () => {
    const code = [
      "public class A {",
      "  void f(ListView list) {",
      "    int p = list.getPositionForView(null);",
      "    int q = list.pointToPosition(1, 2);",
      "    int r = list.getSelectedItemPosition();",
      "    long s = list.getSelectedItemId();",
      "    list.setSelection(3);",
      "    list.setSelectionFromTop(1, 0);",
      "    int c = list.getCount();",
      "  }",
      "}",
    ].join("\n");
    expect(findMethodTypos(code)).toEqual([]);
  });

  it("真拼错仍然报（getItemAtPositon → getItemAtPosition）", () => {
    const code = "public class A { void f(ListView list) { Object o = list.getItemAtPositon(0); } }";
    const typos = findMethodTypos(code);
    expect(typos.map((t) => t.name)).toContain("getItemAtPositon");
    expect(typos[0].suggestion).toBe("getItemAtPosition");
  });

  it("sdkMethods 传入后，词库里的真方法（白名单外的）也不报", () => {
    // 造一个不在 KNOWN_METHODS 里的）

    const code = "public class A { void f(Foo foo) { foo.someDeepSdkMethod(1); } }";
    const withSdk = findMethodTypos(code, { sdkMethods: new Set(["someDeepSdkMethod"]) });
    expect(withSdk).toEqual([]);
    // 不传时按未知名字处理（不会挂）
    expect(Array.isArray(findMethodTypos(code))).toBe(true);
  });

  it("lintJava 端到端：getItemAtPosition 不出 method 类问题", () => {
    const src = [
      "package com.x;",
      "import android.widget.ListView;",
      "public class A extends android.app.Activity {",
      "  void f(ListView list) {",
      "    Object o = list.getItemAtPosition(0);",
      "  }",
      "}",
    ].join("\n");
    const issues = lintJava(src);
    expect(issues.filter((i) => i.code === "method" && i.msg.includes("getItemAtPosition"))).toEqual([]);
  });
});
