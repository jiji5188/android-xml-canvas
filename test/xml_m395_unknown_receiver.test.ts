import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

/**
 * M395：receiver 类型解析不到 → 不弹候选。
 * 用户实测：j 未声明时打 `j.` / `j.my` 会弹一堆「本类方法」——那是通用池泄漏，不是 j 的成员。
 * 规则：
 *  - receiver 解析不到类型、又不是 this/super → return null（不误导）
 *  - receiver 是已知类名（大写开头/词库有/有方法表）→ 按静态访问列该类成员（Toast.makeText）
 *  - 方法参数 `Type x,` / `Type x)` / 增强 for `Type x :` 也能解析出类型（M395 扩展）
 *  - 泛型 `List<String> list;` → List
 */
const lex = buildLexicon([
  {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text:
      "package com.x;\npublic class MainActivity extends Activity {\n" +
      "    private TextView titleView;\n" +
      "    void myMethod() {}\n}\n",
    lang: "java",
  },
]);

function suggest(lines: string[], line: number) {
  const col = lines[line - 1].length + 1;
  return computeJavaSuggest(lines.join("\n"), { line, col }, lex);
}

describe("M395 未声明 receiver 不弹 + 静态类/参数/泛型解析", () => {
  it("j. 未声明 → null", () => {
    expect(suggest(["public class M {", "    void f() {", "        j.", "    }", "}"], 3)).toBeNull();
  });
  it("j.my 未声明 → null（不再弹本类 myMethod）", () => {
    expect(suggest(["public class M {", "    void myMethod() {}", "    void f() {", "        j.my", "    }", "}"], 4)).toBeNull();
  });
  it("声明的 receiver 正常：j. → TextView 成员", () => {
    const r = suggest(["public class M {", "    void f() {", "        TextView j = findViewById(R.id.x);", "        j.", "    }", "}"], 4);
    expect(r?.items?.[0]).toBe("setText");
  });
  it("this./super. 保留（仍走本类）", () => {
    const r = suggest(["public class M {", "    void myMethod() {}", "    void f() {", "        super.my", "    }", "}"], 4);
    expect(r).not.toBeNull();
    expect(r?.items).toContain("myMethod");
  });
  it("静态类访问：Toast. → makeText 第一；Toast.ma → makeText", () => {
    const r1 = suggest(["public class M {", "    void f() {", "        Toast.", "    }", "}"], 3);
    expect(r1?.items?.[0]).toBe("makeText");
    const r2 = suggest(["public class M {", "    void f() {", "        Toast.ma", "    }", "}"], 3);
    expect(r2?.items?.[0]).toBe("makeText");
  });
  it("方法参数也能解析类型：tv.se → setText（M395 终止符扩展）", () => {
    const r = suggest(["public class M {", "    void f(TextView tv) {", "        tv.se", "    }", "}"], 3);
    expect(r?.items?.[0]).toBe("setText");
  });
  it("泛型字段：List<String> list; list. → add/size…", () => {
    const r = suggest(["public class M {", "    private List<String> list;", "    void f() {", "        list.", "    }", "}"], 4);
    expect(r?.items).toContain("add");
    expect(r?.items).toContain("size");
  });
});
