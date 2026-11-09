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

// M207：sym 置信度分级（拼错→error，孤例→warn）+ Kotlin `it` 不报
describe("M207 sym 置信度分级", () => {
  it("有近似声明（拼错）→ error", () => {
    const src = `class A {
    String title; void f() { titel = "x"; }
}`;
    const sym = lintJava(src).filter((i) => i.code === "sym");
    const hit = sym.find((i) => i.msg.includes("titel"));
    expect(hit).toBeTruthy();
    expect(hit!.sev).toBe("error");
  });

  it("孤例未知标识符（猜不到）→ warn", () => {
    const src = `class A {
    void f() {
        qqqzzz = 1;
    }
}`;
    const sym = lintJava(src).filter((i) => i.code === "sym");
    const hit = sym.find((i) => i.msg.includes("qqqzzz"));
    expect(hit).toBeTruthy();
    expect(hit!.sev).toBe("warn");
  });
});

describe("M207 Kotlin lambda 参数 it 不报", () => {
  it("forEach { it } 的 it 不算未声明", () => {
    const src = `class A {
    private var items: List<String> = listOf("a")
    fun show() { items.forEach { it.println() } }
}`;
    const symbols = extractJavaSymbols(src, true);
    expect(symbols.declared.has("it")).toBe(true);
    // 全量 lint（Kotlin）下 it 也不该被报 sym
    const iss = lintJava(src, { isKotlin: true });
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });
});
