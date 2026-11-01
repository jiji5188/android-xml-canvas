// test/xml_m61_java_outline.test.ts — M61：Java/Kotlin 函数大纲
import { describe, expect, it } from "vitest";
import { parseOutline, isJavaLikePath } from "@/lib/xml/java-outline";

describe("M61 java outline", () => {
  it("识别 Java 类 + 方法 + 行号", () => {
    const src = [
      "package com.x;", //                                    1
      "", //                                                  2
      "public class MainActivity extends Activity {", //       3
      "    private int count = 0;", //                          4
      "", //                                                   5
      "    @Override", //                                       6
      "    protected void onCreate(Bundle savedInstanceState) {", // 7
      "        super.onCreate(savedInstanceState);", //         8
      "        if (count > 0) {", //                             9
      "            count--;", //                                10
      "        }", //                                           11
      "    }", //                                               12
      "", //                                                    13
      "    public static String foo(int a, String b) throws Exception {", // 14
      "        return b;", //                                   15
      "    }", //                                               16
      "}", //                                                   17
    ].join("\n");

    const items = parseOutline(src, false);
    const names = items.map((i) => `${i.kind}:${i.name}@${i.line}`);
    expect(names).toEqual([
      "class:MainActivity@3",
      "method:onCreate@7",
      "method:foo@14",
    ]);
    // if 不能被当函数
    expect(items.some((i) => i.name === "if")).toBe(false);
  });

  it("跳过注释和字符串里的花括号（行号不跑偏）", () => {
    const src = [
      "class A {", //                      1
      "  // 注释里有 { 和 }", //            2
      "  String s = \"}{ not code {\";", // 3
      "  /* 块注释", //                     4
      "     { 深层", //                     5
      "  */", //                            6
      "  void run() {", //                  7
      "    log(\"}\");", //                 8
      "  }", //                             9
      "}", //                              10
    ].join("\n");
    const items = parseOutline(src, false);
    expect(items.map((i) => i.name)).toEqual(["A", "run"]);
    expect(items[1].line).toBe(7);
  });

  it("排除匿名类和 lambda 的花括号", () => {
    const src = [
      "class B {", //                                  1
      "  void init() {", //                            2
      "    btn.setOnClickListener(v -> {", //          3
      "      doIt();", //                              4
      "    });", //                                    5
      "    Handler h = new Handler() {", //            6
      "      public void handleMessage(Message m) {", // 7
      "      }", //                                    8
      "    };", //                                     9
      "  }", //                                       10
      "}", //                                         11
    ].join("\n");
    const names = parseOutline(src, false).map((i) => i.name);
    expect(names).toContain("B");
    expect(names).toContain("init");
    // lambda / 匿名类不算方法
    expect(names).not.toContain("setOnClickListener");
  });

  it("Kotlin fun（含表达式体与嵌套缩进）", () => {
    const src = [
      "class Repo {", //                        1
      "    fun load(id: Int): String {", //     2
      "        return \"x\"", //                3
      "    }", //                               4
      "    fun quick(a: Int) = a + 1", //       5
      "}", //                                   6
      "fun topLevel() {", //                    7
      "}", //                                   8
    ].join("\n");
    const items = parseOutline(src, true);
    expect(items.map((i) => i.name)).toEqual(["Repo", "load", "quick", "topLevel"]);
    expect(items.find((i) => i.name === "quick")?.line).toBe(5);
  });

  it("空文件 / 只有注释 → 空数组", () => {
    expect(parseOutline("", false)).toEqual([]);
    expect(parseOutline("// 只有注释\n/* 还是注释 */", false)).toEqual([]);
  });

  it("isJavaLikePath", () => {
    expect(isJavaLikePath("MainActivity.java")).toBe(true);
    expect(isJavaLikePath("res/layout/a.xml")).toBe(false);
    expect(isJavaLikePath("Foo.kt")).toBe(true);
    expect(isJavaLikePath(null)).toBe(false);
  });
});
