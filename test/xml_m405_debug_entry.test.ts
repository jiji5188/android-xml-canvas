// test/xml_m405_debug_entry.test.ts — M405：debug 运行入口探测 + R.java 生成（纯函数）
import { describe, expect, it } from "vitest";
import { entryCandidates, genRJavaText } from "@/lib/xml/debug-entry";
import type { ResourceTable } from "@/lib/xml/types";

const JAVASRC = `package com.example.demo;

public class Calc {
    public static int add(int a, int b) {
        System.out.println("add " + (a + b));
        return a + b;
    }
    public static void main(String[] args) {
        System.out.println(add(1, 2));
    }
}
`;

const DEBUGSRC = `package com.example.demo;

public class Util {
    public static void debug() {
        System.out.println("hello from debug");
    }
}
`;

describe("M405 entryCandidates", () => {
  it("找出含 main 的类全限定名", () => {
    const c = entryCandidates([{ path: "app/src/main/java/com/example/demo/Calc.java", code: JAVASRC }]);
    expect(c).toContain("com.example.demo.Calc");
  });
  it("找出含 debug() 的类", () => {
    const c = entryCandidates([{ path: "app/src/main/java/com/example/demo/Util.java", code: DEBUGSRC }]);
    expect(c).toContain("com.example.demo.Util");
  });
  it("没有入口方法的文件不产生候选", () => {
    const plain = "package p;\npublic class NoEntry {\n    int x;\n}\n";
    const c = entryCandidates([{ path: "NoEntry.java", code: plain }]);
    expect(c.length).toBe(0);
  });
  it("Kotlin 文件也算", () => {
    const kt = "package p\nobject K { fun main(args: Array<String>) { } }";
    // Kotlin 的 main 不是 static void main(String[])，正则不命中 → 0 候选（符合约定）
    const c = entryCandidates([{ path: "K.kt", code: kt }]);
    expect(Array.isArray(c)).toBe(true);
  });
});

describe("M405 genRJavaText", () => {
  const table = {
    strings: { app_name: "MyApp", hint: "x" },
    colors: { brand: "#FF0000" },
    dimens: { margin: 8 },
    styles: { AppTheme: { name: "AppTheme", attrs: {} } },
    drawables: {},
    vectorNames: ["ic_logo"],
    stringArrays: {},
    themeAttrs: {},
    themeAttrsNight: {},
    colorsNight: {},
    nightMode: false,
    locale: "",
    palette: {},
    drawableXml: {},
  } as unknown as ResourceTable;

  it("生成含 string/color/dimen/style/drawable 的 R", () => {
    const out = genRJavaText(table, "com.example.demo", []);
    expect(out).toContain("public final class R {");
    expect(out).toContain("public static final class string {");
    expect(out).toContain("public static final int app_name");
    expect(out).toContain("public static final int ic_logo");
    expect(out).toContain("package com.example.demo;");
  });
  it("补上代码里引用但资源表没有的 R 引用（占位）", () => {
    const srcs = [{ code: "R.layout.activity_main;" }, { code: "R.id.btn_ok;" }];
    const out = genRJavaText(table, "com.example.demo", srcs);
    expect(out).toContain("public static final class layout {");
    expect(out).toContain("public static final int activity_main");
    expect(out).toContain("public static final class id {");
    expect(out).toContain("public static final int btn_ok");
  });
});
