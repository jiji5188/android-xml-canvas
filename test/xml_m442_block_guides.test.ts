// @vitest-environment node
// M442：代码块花括号纵向标记线（纯逻辑）
import { describe, expect, it } from "vitest";
import { computeBlockGuides, pickRenderedGuides } from "@/lib/xml/block-guides";

describe("M442 computeBlockGuides", () => {
  it("多行 if 体 → 一条 guide（起止行 + 缩进列 + 深度）", () => {
    const code = [
      "void f() {",
      "  if (x) {",
      "    a();",
      "    b();",
      "  }",
      "}",
    ].join("\n");
    const g = computeBlockGuides(code);
    // f() 块（跨行）+ if 块（跨行）
    expect(g.some((x) => x.startLine === 1 && x.endLine === 6 && x.col === 0 && x.depth === 1)).toBe(true);
    expect(g.some((x) => x.startLine === 2 && x.endLine === 5 && x.col === 2 && x.depth === 2)).toBe(true);
  });

  it("单行 {} 不画线", () => {
    const code = "void f() {\n  if (x) { a(); }\n  if (y) { b(); }\n}";
    const g = computeBlockGuides(code);
    // 只有最外层 f() 块跨行（单行 {} 不画线）
    expect(g.length).toBe(1);
    expect(g[0].startLine).toBe(1);
    expect(g[0].endLine).toBe(4);
  });

  it("字符串/注释里的花括号不算", () => {
    const code = 'void f() {\n  String s = "{ }";\n  // if (x) { fake }\n  g();\n}';
    const g = computeBlockGuides(code);
    expect(g.length).toBe(1); // 只有 f() 块
    expect(g[0].startLine).toBe(1);
  });

  it("未闭合块不收（结尾悬空 { 不算 guide）", () => {
    const code = "void f() {\n  if (x) {";
    const g = computeBlockGuides(code);
    expect(g.length).toBe(0);
  });

  it("pickRenderedGuides 按深度 + 数量截断", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ startLine: i, endLine: i + 2, col: 0, depth: i + 1 }));
    const picked = pickRenderedGuides(many, 3, 5);
    // 只留深度 ≤3（前 3 条）且数量 ≤5
    expect(picked.length).toBe(3);
    expect(picked.every((g) => g.depth <= 3)).toBe(true);
  });
});
