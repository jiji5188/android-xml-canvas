// test/xml_m98_symbol_match_scroll.test.ts — M98：符号匹配防误报 + 候选列表可滚动、按下不算点击
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { lintJava } from "@/lib/xml/java-lint";

const braceIssues = (src: string, opts = {}) => lintJava(src, opts).filter((i) => i.code === "brace" || i.code === "quote");

describe("M98 符号匹配不再误报", () => {
  it("Java 文本块里的花括号不当结构", () => {
    const src = [
      "public class A {",
      "    String json = \"\"\"",
      "        { \"a\": [1,2], \"b\": { \"c\": 3 } }",
      "        \"\"\";",
      "    void f() { }",
      "}",
    ].join("\n");
    expect(braceIssues(src)).toEqual([]);
  });

  it("Kotlin 原始字符串装 JSON（内容里有引号）也不误报", () => {
    const src = ["fun f() {", '    val s = """{"a":1,"b":[2,3]}"""', "  }"].join("\n");
    expect(braceIssues(src, { isKotlin: true })).toEqual([]);
  });

  it("Kotlin 字符串模板里嵌套字符串和方括号", () => {
    const src = ["fun f() {", '    val s = "${map["k"]} and ${list[0]}"', "  }"].join("\n");
    expect(braceIssues(src, { isKotlin: true })).toEqual([]);
  });

  it("文件末尾正好是闭合的字符串，不再误报「没有闭合」", () => {
    expect(braceIssues('public class A { String s = "abc"; }')).toEqual([]);
    // 连分号都没有、字符串在最后
    expect(braceIssues('String s = "abc"')).toEqual([]);
    expect(braceIssues('char c = \'{\'')).toEqual([]);
  });

  it("真的没闭合仍然报，且行号指向开引号那行", () => {
    const issues = braceIssues('public class A {\n    String s = "abc;\n}');
    expect(issues.length).toBe(1);
    expect(issues[0].code).toBe("quote");
    expect(issues[0].line).toBe(2);
  });

  it("一个错只报一次（不配对之后不再补「没闭合」）", () => {
    const issues = braceIssues("public class A { void f(] { } }");
    expect(issues.filter((i) => i.code === "brace").length).toBe(1);
  });

  it("真正的括号不平衡还是要报", () => {
    expect(braceIssues("public class A { void f() { }").some((i) => i.msg.includes("没有闭合"))).toBe(true);
    expect(braceIssues("public class A { void f() { } } }").some((i) => i.msg.includes("多余"))).toBe(true);
  });

  it("字符串里的转义引号不会提前结束字面量", () => {
    const src = 'public class A { String s = "他说\\"好\\" {"; void f() { } }';
    expect(braceIssues(src)).toEqual([]);
  });
});

describe("M98 候选弹窗：可滚动 + 按下不算点击", () => {
  const src = fs.readFileSync("components/CodeEditor.tsx", "utf8");
  const css = fs.readFileSync("components/xml-canvas.css", "utf8");

  it("pointerdown 只记录，不再直接确认", () => {
    expect(src).toContain("onSugDown");
    expect(src).toContain("onSugUp");
    // 老写法：pointerdown 里 preventDefault + acceptSuggest
    expect(/onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);\s*acceptSuggest/.test(src)).toBe(false);
  });

  it("抬起要同一项、位移小、没滚动过才确认", () => {
    expect(src).toContain("moved > 10");
    expect(src).toContain("press.i !== i");
    expect(src).toContain("list.scrollTop");
  });

  it("列表能滚：滚动/取消都清掉按下状态", () => {
    expect(src).toContain("onScroll={cancelPress}");
    expect(src).toContain("onPointerCancel={cancelPress}");
    expect(css).toMatch(/\.axv-sug \{[\s\S]*?touch-action: pan-y/);
    expect(css).toMatch(/\.axv-sug \{[\s\S]*?overscroll-behavior: contain/);
  });

  it("按住弹窗时编辑器的 blur 不关弹窗", () => {
    expect(src).toContain("if (pressRef.current) return false;");
  });

  it("触屏按下不 preventDefault（否则手势滑动被吃掉）", () => {
    expect(src).toContain('e.pointerType === "mouse"');
  });
});
