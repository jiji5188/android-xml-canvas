// test/xml_m355_lex_candidate_pool.test.ts
// M355：有项目词库时，候选池不能丢旧的宽池子（M285 KNOWN_METHODS / JAVA_METHODS / tok.refs）。
// 回归：M352 M1 之后，computeJavaSuggest 走「词库打分」分支时，曾只带 currentFile+词库，
// 把 setText/findViewById 等全局高频方法、以及本文件引用符号全丢了 → 用户反馈「丢功能」。
import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

// 造一个项目词库：一个类 + 一个方法（让 allMethodNames 非空，触发词库分支）
function makeLex() {
  const src = [
    {
      rel: "MainActivity.java",
      text: `public class MainActivity {
        public void startThing() { }
        int helper;
      }`,
      lang: "java" as const,
    },
  ];
  return buildLexicon(src);
}

describe("M355 有词库时候选池不丢旧宽池", () => {
  it("setText（KNOWN_METHODS 高频白名单）在词库分支仍可见", () => {
    const lex = makeLex();
    // 文档里引用了一个类型（tok.refs），同时打 "setT" 前缀
    const doc = [
      `public class Foo {`,
      `    void f() {`,
      `        String s = "x";`,
      `        setT`, // 光标在 setT 末尾
      `    }`,
      `}`,
    ].join("\n");
    const line = doc.split("\n").findIndex((l) => l.trim() === "setT") + 1;
    const col = doc.split("\n")[line - 1].indexOf("setT") + "setT".length;
    const r = computeJavaSuggest(doc, { line, col }, lex);
    expect(r).not.toBeNull();
    expect(r!.items).toContain("setText");
  });

  it("findViewById（KNOWN_METHODS）在词库分支仍可见", () => {
    const lex = makeLex();
    const doc = [
      `public class Foo {`,
      `    void f() {`,
      `        findV`,
      `    }`,
      `}`,
    ].join("\n");
    const line = 3;
    const col = doc.split("\n")[line - 1].indexOf("findV") + "findV".length;
    const r = computeJavaSuggest(doc, { line, col }, lex);
    expect(r).not.toBeNull();
    expect(r!.items).toContain("findViewById");
  });

  it("本文件引用符号 tok.refs（String）在词库分支仍可见", () => {
    const lex = makeLex();
    const doc = [
      `public class Foo {`,
      `    void f() {`,
      `        Str`, // 光标在 Str 末尾（本文件用过 String）
      `    }`,
      `}`,
    ].join("\n");
    const line = 3;
    const col = doc.split("\n")[line - 1].indexOf("Str") + "Str".length;
    const r = computeJavaSuggest(doc, { line, col }, lex);
    expect(r).not.toBeNull();
    expect(r!.items).toContain("String");
  });
});
