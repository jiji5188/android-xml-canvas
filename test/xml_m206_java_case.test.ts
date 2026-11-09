// test/xml_m206_java_case.test.ts — M206：大小写敏感（string→String / toast→Toast / settext→setText）
import { describe, it, expect } from "vitest";
import { findCaseMismatches } from "@/lib/xml/java-case";
import { lintJava } from "@/lib/xml/java-lint";

describe("findCaseMismatches 纯函数", () => {
  it("string 当类型用 → 建议 String", () => {
    const r = findCaseMismatches(`class A { void f() { string s = "x"; } }`);
    const hit = r.find((x) => x.written === "string");
    expect(hit).toBeTruthy();
    expect(hit!.correct).toBe("String");
    expect(hit!.kind).toBe("type");
  });

  it("Toast 写对不报", () => {
    const r = findCaseMismatches(`class A { void f() { Toast.makeText(c, "x", 0).show(); } }`);
    expect(r.filter((x) => x.written === "Toast")).toHaveLength(0);
  });

  it("Textview 少写大写 → 建议 TextView", () => {
    const r = findCaseMismatches(`class A { void f() { Textview tv = null; } }`);
    const hit = r.find((x) => x.written === "Textview");
    expect(hit).toBeTruthy();
    expect(hit!.correct).toBe("TextView");
  });

  it("settext 小写 → 建议 setText", () => {
    const r = findCaseMismatches(`class A { void f() { tv.settext("x"); } }`);
    const hit = r.find((x) => x.written === "settext");
    expect(hit).toBeTruthy();
    expect(hit!.correct).toBe("setText");
    expect(hit!.kind).toBe("method");
  });

  it("正确写法的整个调用不报", () => {
    const r = findCaseMismatches(`class A { void f() { tv.setText("x"); iv.setImageResource(1); } }`);
    expect(r).toHaveLength(0);
  });

  it("关键字大小写不报（If / For 之类不误报成类型）", () => {
    const r = findCaseMismatches(`class A { void f() { int i = 0; } }`);
    expect(r).toHaveLength(0);
  });

  it("自定义类名不报（declared 传入）", () => {
    const r = findCaseMismatches(`class A { void f() { CustomView v = null; } }`, ["CustomView", "f"]);
    expect(r.filter((x) => x.written === "CustomView")).toHaveLength(0);
  });
});

describe("lintJava M206 集成", () => {
  it("string s = 报 case error", () => {
    const iss = lintJava(`class A { void f() { string s = "x"; } }`);
    const hit = iss.find((i) => i.code === "case");
    expect(hit).toBeTruthy();
    expect(hit!.msg).toContain("String");
  });

  it(".settext( 报 case error", () => {
    const iss = lintJava(`class A { void f() { tv.settext("x"); } }`);
    const hit = iss.find((i) => i.code === "case");
    expect(hit).toBeTruthy();
    expect(hit!.msg).toContain("setText");
  });

  it("正确代码不报 case", () => {
    const iss = lintJava(`class A { void f() { TextView tv = null; tv.setText("x"); } }`);
    expect(iss.filter((i) => i.code === "case")).toHaveLength(0);
  });
});
