import { describe, expect, it } from "vitest";
import { formatJava } from "@/lib/xml/java-format";

describe("M209 formatJava", () => {
  it("按深度重排缩进（4 空格）", () => {
    const src = "class A {\nvoid m(){\nint x=1;\n}\n}\n";
    const out = formatJava(src, { indent: 4 });
    const lines = out.split("\n");
    expect(lines[0]).toBe("class A {");
    expect(lines[1]).toBe("    void m(){");
    expect(lines[2]).toBe("        int x=1;");
    expect(lines[3]).toBe("    }");
    expect(lines[4]).toBe("}");
  });

  it("去掉行内行尾空格（保留末尾换行）", () => {
    const out = formatJava("class A{   \n    int x=1;   \n}\n");
    // 每一非空行都不该有行尾空格
    for (const l of out.split("\n")) {
      if (l.trim()) expect(l).not.toMatch(/\s+$/);
    }
  });

  it("折叠连续空行（>3 个压成 2 个以内）", () => {
    const out = formatJava("class A{\n\n\n\n\nvoid m()\n}\n");
    const blanks = out.split("\n").filter((l) => l === "").length;
    expect(blanks).toBeLessThanOrEqual(3);
  });

  it("注释内容不变", () => {
    const out = formatJava("class A{ // hello\nint x;\n}\n");
    expect(out).toContain("// hello");
  });

  it("Kotlin 属性赋值不影响深度", () => {
    const out = formatJava("class B {\n    var n = 0\n}\n");
    expect(out).toContain("var n = 0");
  });
});
