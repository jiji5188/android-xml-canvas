// test/xml_m203_java_symbols.test.ts — M203：Java 符号表 + 未声明标识符
import { describe, it, expect } from "vitest";
import { extractJavaSymbols, findUnknownSymbols } from "@/lib/xml/java-symbols";

function starts(text: string): number[] {
  const s = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") s.push(i + 1);
  return s;
}

describe("extractJavaSymbols", () => {
  it("抓字段 + 构造参数 + 方法参数 + 局部变量 + 方法名", () => {
    const src = `
class A {
  private int x;
  public String title;
  static final int N = 3;

  A(int a, String b, int c) { x = a; }

  void f(int p, String q) { int local = 0; }
  int getFoo() { return N; }
}`;
    const sy = extractJavaSymbols(src);
    // 字段
    expect(sy.declared.has("x")).toBe(true);
    expect(sy.declared.has("title")).toBe(true);
    expect(sy.declared.has("N")).toBe(true);
    // 构造参数
    expect(sy.declared.has("a")).toBe(true);
    expect(sy.declared.has("b")).toBe(true);
    expect(sy.declared.has("c")).toBe(true);
    // 方法参数
    expect(sy.declared.has("p")).toBe(true);
    expect(sy.declared.has("q")).toBe(true);
    // 局部变量
    expect(sy.declared.has("local")).toBe(true);
    // 方法名
    expect(sy.methods.has("f")).toBe(true);
    expect(sy.methods.has("getFoo")).toBe(true);
  });

  it("Kotlin：val/var 属性 + fun 参数", () => {
    const src = `class B {
  val name: String = "x"
  var count: Int = 0
  fun go(a: Int, b: String) { val t = a }
}`;
    const sy = extractJavaSymbols(src, true);
    expect(sy.declared.has("name")).toBe(true);
    expect(sy.declared.has("count")).toBe(true);
    expect(sy.declared.has("a")).toBe(true);
    expect(sy.declared.has("b")).toBe(true);
    expect(sy.declared.has("t")).toBe(true);
    expect(sy.methods.has("go")).toBe(true);
  });
});

describe("findUnknownSymbols", () => {
  it("构造器里凭空冒出来的 dsdxvbb / lhh4 被抓", () => {
    const src = `public SubmitData(String title, String action, List<String> data, boolean isRt){
    this.title=title;
    this.action=action;
    this.isResult=isRt;
    dsdxvbb==lhh4;
    this.listArr=data;
}`;
    const sy = extractJavaSymbols(src);
    const masked = src; // 没字符串/注释，masked≈src
    const startsArr = starts(masked);
    const unknowns = findUnknownSymbols(masked, sy, new Set(), startsArr);
    const names = unknowns.map((u) => u.name).sort();
    expect(names).toContain("dsdxvbb");
    expect(names).toContain("lhh4");
    // this.title / this.action / this.isResult / this.listArr / title / action / data / isRt 都不算未知
    expect(names).not.toContain("title");
    expect(names).not.toContain("action");
    expect(names).not.toContain("data");
    expect(names).not.toContain("isRt");
  });

  it("正常构造器无未知标识符", () => {
    const src = `public SubmitData(String title, String action){
    this.title=title;
    this.action=action;
}`;
    const sy = extractJavaSymbols(src);
    const unknowns = findUnknownSymbols(src, sy, new Set(), starts(src));
    expect(unknowns).toHaveLength(0);
  });
});
