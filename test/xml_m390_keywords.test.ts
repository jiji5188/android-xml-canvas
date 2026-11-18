import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

const lex = buildLexicon([
  {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text: "package com.x;\npublic class MainActivity extends Activity {\n    void onCreate() {}\n    void onClick() {}\n}\n",
    lang: "java",
  },
]);

function probe(word: string) {
  const doc = "public class A {\n    void f() {\n        " + word;
  return computeJavaSuggest(doc, { line: 3, col: 9 + word.length }, lex);
}

describe("M390 关键词完整词可达", () => {
  it("打满 2 字符的 if / do 现在能弹自己", () => {
    const rIf = probe("if");
    expect(rIf?.items?.[0]).toBe("if");
    const rDo = probe("do");
    expect(rDo?.items?.[0]).toBe("do");
  });
  it("打满 3+ 字符的关键词也在第一位", () => {
    for (const w of ["for", "else", "while", "new", "try", "int", "switch"]) {
      const r = probe(w);
      expect(r?.items?.[0]).toBe(w);
    }
  });
  it("M392：普通词 1 字母就弹（之前要 2 字母）", () => {
    const r1 = probe("p");
    expect(r1).not.toBeNull();
    expect(r1?.items?.length).toBeGreaterThan(0);
    const rA = probe("a");
    expect(rA).not.toBeNull();
    // 类名/变量/方法里有 a 开头的才会出现
  });
  it("M392：receiver 点号后空前缀仍列成员（fn.）", () => {
    const d = "public class A {\n    void f() {\n        TextView fn = findViewById(R.id.tv);\n        fn.";
    const lines = d.split("\n");
    const r = computeJavaSuggest(d, { line: 4, col: 12 }, undefined);
    expect(r?.items?.includes("setText")).toBe(true);
  });
  it("变量/方法的自我跳过规则不变（半截词不弹自己）", () => {
    // 打了半截 titleVi：文档扫描会把 titleVi 当 var 扫进来，但弹窗里不能有 titleVi 这个半截词
    const doc = "class A {\n    TextView titleView;\n    void f() {\n        titleVi";
    const r = probe("titleVi");
    // 没有词库时走 tok 分支 —— titleVi 不应出现在候选里
    const doc2 = "public class A {\n    void f() {\n        " + "titleVi";
    const r2 = computeJavaSuggest(doc2, { line: 3, col: 9 + "titleVi".length }, lex);
    if (r2) expect(r2.items).not.toContain("titleVi");
    void doc; void r;
  });
});
