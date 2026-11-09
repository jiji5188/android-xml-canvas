// test/xml_m204_java_controlflow.test.ts — M204b：类级字段重复定义
//
// voidret / return 检查已移除（正则取方法体不可靠，误报太多）。
// 这里只保留 dup 的类级字段检查。
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";

describe("lintJava M204b 类级字段重复", () => {
  it("类体两个同名 int 字段 → 报 dup", () => {
    const src = `class A {
    int x;
    int x;
}`;
    const iss = lintJava(src);
    expect(iss.some((i) => i.code === "dup")).toBe(true);
  });

  it("方法体内同名局部变量不报（不是类级字段）", () => {
    const src = `class A {
    void f() {
      int x = 1;
      int x2 = 2;
    }
    int y;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "dup")).toHaveLength(0);
  });

  it("不同名类级字段不报 dup", () => {
    const src = `class A {
    int x;
    String y;
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "dup")).toHaveLength(0);
  });

  it("类级字段真的重复才报", () => {
    const src = `class A {
    int ip;
    int ip;
}`;
    const iss = lintJava(src);
    const hit = iss.find((i) => i.code === "dup");
    expect(hit).toBeTruthy();
    expect(hit!.msg).toContain("ip");
  });
});
