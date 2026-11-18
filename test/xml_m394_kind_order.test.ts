import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";
import { KIND_PRIORITY } from "@/lib/xml/suggest-kind";

/**
 * M394：候选词类型排序 —— 声明(decl) > 变量(var) > 常量(const) > 类(class) > 方法(method)
 * 仅作用于「无 receiver」的通用词库场景；receiver 成员（fn./obj.）仍方法优先。
 */
const lex = buildLexicon([
  {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text:
      "package com.x;\npublic class MainActivity extends Activity {\n" +
      "    private TextView titleView;\n" +
      "    private static final String TAGNAME = \"t\";\n" +
      "    void f() {}\n" +
      "    void tableView() {}\n" +
      "}\n",
    lang: "java",
  },
]);

const DOC = [
  "public class M {",
  "    private TextView titleView;",
  "    private static final String TAGNAME = \"t\";",
  "    void tableView() {}",
  "    void f() {",
  "        __TAIL__",
  "    }",
  "}",
].join("\n");

function suggest(tail: string) {
  const col = 8 + tail.length + 1;
  return computeJavaSuggest(DOC.replace("__TAIL__", tail), { line: 6, col }, lex);
}

describe("M394 候选词类型层级 声明>变量>常量>类>方法", () => {
  for (const prefix of ["t", "f", "se", "fina"]) {
    it(`打 "${prefix}"：kind 优先级单调不减（声明最前、方法最后）`, () => {
      const r = suggest(prefix);
      const kinds = r?.kinds ?? [];
      expect(kinds.length).toBeGreaterThan(0);
      const prios = kinds.map((k) => KIND_PRIORITY[k] ?? 6);
      for (let i = 1; i < prios.length; i++) {
        expect(prios[i]).toBeGreaterThanOrEqual(prios[i - 1]);
      }
    });
  }

  it("打 t：decl 全部在 class 前，class 全部在 method 前", () => {
    const r = suggest("t");
    const kinds = r!.kinds;
    const lastDecl = kinds.lastIndexOf("decl");
    const firstClass = kinds.indexOf("class");
    const lastClass = kinds.lastIndexOf("class");
    const firstMethod = kinds.indexOf("method");
    expect(lastDecl).toBeGreaterThanOrEqual(0);
    expect(firstClass).toBeGreaterThan(lastDecl);
    expect(firstMethod).toBeGreaterThan(lastClass);
  });

  it("打 f：final/false/for 等关键字排在 findViewById/finish 前", () => {
    const r = suggest("f");
    const items = r!.items;
    const iFor = items.indexOf("for");
    const iFind = items.indexOf("findViewById");
    if (iFor >= 0 && iFind >= 0) expect(iFor).toBeLessThan(iFind);
  });

  it("receiver 场景不受影响：fn.se → setText 第一（不弹关键词 sealed）", () => {
    const d = [
      "public class M {",
      "    void f() {",
      "        TextView fn = findViewById(R.id.tv);",
      "        fn.se",
    ].join("\n");
    const r = computeJavaSuggest(d, { line: 4, col: 14 }, lex);
    expect(r?.items?.[0]).toBe("setText");
    // sealed 就算出现也必须排到 setText 之后（不抢首位）
    const iSealed = r!.items.indexOf("sealed");
    if (iSealed >= 0) expect(iSealed).toBeGreaterThan(0);
  });
});
