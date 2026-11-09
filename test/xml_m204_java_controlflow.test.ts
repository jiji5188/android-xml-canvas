// test/xml_m204_java_controlflow.test.ts — M204：return 缺失 / void 带 return 值 / 字段重复
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";

describe("lintJava M204 控制流", () => {
  it("非 void 方法没有 return → 报 return", () => {
    const src = `int getFoo() {
    int a = 1;
    a = 2;
}`;
    const iss = lintJava(src);
    expect(iss.some((i) => i.code === "return")).toBe(true);
  });

  it("有 return 的方法不报", () => {
    const src = `int getFoo(int x) {
    return x * 2;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "return")).toHaveLength(0);
  });

  it("非 void 方法有 throw 也不报", () => {
    const src = `int getFoo(int x) {
    if (x < 0) throw new RuntimeException("neg");
    return x;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "return")).toHaveLength(0);
  });

  it("void 方法却 return 值 → 报 voidret", () => {
    const src = `void f() {
    return 1;
}`;
    const iss = lintJava(src);
    expect(iss.some((i) => i.code === "voidret")).toBe(true);
  });

  it("void 方法正常 return; 不报", () => {
    const src = `void f(int x) {
    if (x > 0) return;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "voidret")).toHaveLength(0);
  });

  it("字段重复定义 → 报 dup", () => {
    const src = `class A {
    int x;
    int x;
}`;
    const iss = lintJava(src);
    expect(iss.some((i) => i.code === "dup")).toBe(true);
  });

  it("不同名字段不报 dup", () => {
    const src = `class A {
    int x;
    String y;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "dup")).toHaveLength(0);
  });
});
