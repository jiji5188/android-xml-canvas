import { lintJava } from "@/lib/xml/java-lint";
import { extractJavaSymbols } from "@/lib/xml/java-symbols";
import { describe, it, expect } from "vitest";

describe("M208b 作用域兜底（全局参数扫描）", () => {
  it("跨行签名里的参数也算已声明", () => {
    const src = `public class A {
    public void doIt(
        Context context,
        String jsonString,
        int pageSize) {
        int n = jsonString.length();
    }
}`;
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("jsonString")).toBe(true);
    expect(sy.declared.has("pageSize")).toBe(true);
    expect(lintJava(src).filter((i) => i.code === "sym")).toHaveLength(0);
  });

  it("匿名内部类里的参数/局部变量不跨方法误判", () => {
    const src = `public class A {
    void f() {
        new Runnable() {
            public void run() {
                int local = 1;
                System.out.println(local);
            }
        }.run();
    }
}`;
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("local")).toBe(true);
    expect(lintJava(src).filter((i) => i.code === "sym")).toHaveLength(0);
  });
});
