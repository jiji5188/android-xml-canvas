// test/xml_m205d_literal_hash.test.ts — M205d：字面量不当标识符 + hash() 不误报 + 不再报 unusedimport
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";
import { extractJavaSymbols, findUnknownSymbols } from "@/lib/xml/java-symbols";
import { findMethodTypos } from "@/lib/xml/java-methods";

describe("M205d 字面量 null/true/false 不算未声明标识符", () => {
  it("null 不报 sym", () => {
    const src = `class A {
    String f(String s) {
        if (s == null) return null;
        return s;
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });

  it("true / false 不报 sym", () => {
    const src = `class A {
    boolean f(int x) {
        boolean a = true;
        boolean b = false;
        return a && b;
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });

  it("纯符号层：null/true/false 直接过滤", () => {
    const src = `class A { void f() { Object o = null; boolean t = true; boolean b = false; } }`;
    const sy = extractJavaSymbols(src);
    const unk = findUnknownSymbols(src, sy, new Set<string>(), [0]);
    expect(unk).toHaveLength(0);
  });
});

describe("M205d hash() 不误报成 has()", () => {
  it("Objects.hash 风格不报拼写错", () => {
    const code = `class A {
    int f() {
        return java.util.Objects.hash("a", "b");
    }
}`;
    expect(findMethodTypos(code).filter((t) => t.name === "hash")).toHaveLength(0);
  });

  it("自己类里声明的 hash() 不报", () => {
    const code = `class A {
    private int hash(String s) { return s.length(); }
    int f() { return hash("x"); }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("lintJava 整段不报 method", () => {
    const src = `class A {
    void f() {
        int h = java.util.Objects.hash("x", null);
        if (h > 0 && true) { }
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "method")).toHaveLength(0);
  });
});

describe("M205d unsedimport 已移除", () => {
  it("import 了但没用到的类不再提示", () => {
    const src = `import org.json.JSONObject;
import org.json.JSONException;
class A { void f(String s) { JSONObject o = new JSONObject(s); } }`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "unusedimport")).toHaveLength(0);
  });
});
