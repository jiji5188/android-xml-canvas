import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

const lex = buildLexicon([
  {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text: "package com.x;\npublic class MainActivity extends Activity {\n    void f() {}\n}\n",
    lang: "java",
  },
]);

describe("M393 Object 作为 receiver 默认类型", () => {
  it("Object obj = ...; obj.to → toString", () => {
    const d = [
      "public class M {",
      "    void f() {",
      "        Object obj = someData();",
      "        obj.to",
    ].join("\n");
    const r = computeJavaSuggest(d, { line: 4, col: 15 }, lex);
    console.log("[obj.to] items=", r?.items?.slice(0, 8));
    expect(r?.items?.includes("toString")).toBe(true);
    expect(r?.items?.[0]).toBe("toString");
  });
  it("obj.（空前缀）→ 列 Object 成员（toString 在前）", () => {
    const d = [
      "public class M {",
      "    void f() {",
      "        Object obj = someData();",
      "        obj.",
    ].join("\n");
    const r = computeJavaSuggest(d, { line: 4, col: 13 }, lex);
    console.log("[obj.] items=", r?.items?.slice(0, 8));
    expect(r?.items?.[0]).toBe("toString");
  });
});
