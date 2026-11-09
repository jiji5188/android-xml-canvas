// test/xml_m205_java_assign.test.ts — M205：赋值类型不匹配 + import 未使用
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";
import { findAssignMismatches } from "@/lib/xml/java-assign";

describe("findAssignMismatches 纯函数", () => {
  it("int x = \"abc\" 报 String 字面量", () => {
    const r = findAssignMismatches(`int x = "abc";`);
    expect(r).toHaveLength(1);
    expect(r[0].declared).toBe("int");
    expect(r[0].actual).toBe("String 字面量");
  });

  it("int z = 1.5 报浮点字面量", () => {
    const r = findAssignMismatches(`int z = 1.5;`);
    expect(r).toHaveLength(1);
    expect(r[0].actual).toBe("浮点字面量");
  });

  it("double z = 1.5 不报（浮点给 double 正常）", () => {
    expect(findAssignMismatches(`double z = 1.5;`)).toHaveLength(0);
  });

  it("String s = 123 报数字字面量", () => {
    const r = findAssignMismatches(`String s = 123;`);
    expect(r).toHaveLength(1);
    expect(r[0].declared).toBe("String");
  });

  it("int a = 1 不报（正常）", () => {
    expect(findAssignMismatches(`int a = 1;`)).toHaveLength(0);
  });
});

describe("lintJava M205 集成", () => {
  it("int x = \"abc\" 报 assign", () => {
    const iss = lintJava(`void f() { int x = "abc"; }`);
    expect(iss.some((i) => i.code === "assign")).toBe(true);
  });

  it("M205d：不再报 unusedimport（风格建议误报代价太大，已移除）", () => {
    const src = `import android.widget.TextView;
import java.util.List;
class A { void f() { List<String> l = new java.util.ArrayList<>(); } }`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "unusedimport")).toHaveLength(0);
  });

  it("真正用到的 import 当然也不报", () => {
    const src = `import java.util.List;
class A { void f() { List<String> l = null; } }`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "unusedimport")).toHaveLength(0);
  });
});
