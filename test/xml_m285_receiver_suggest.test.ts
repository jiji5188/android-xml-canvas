import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "../lib/xml/java-vocab";

function lastLineSuggest(code: string) {
  const lines = code.split("\n");
  const li = lines.length;
  return computeJavaSuggest(code, { line: li, col: 1 }) || computeJavaSuggest(code, { line: li, col: 10 });
}

describe("computeJavaSuggest M285（接收者类型感知）", () => {
  it("TextView. 后优先出 setText", () => {
    const code = "public void f() {\n" +
      "TextView tv = findViewById(R.id.tv);\n" +
      'tv.se';
    const s = computeJavaSuggest(code, { line: 4, col: 6 });
    expect(s).not.toBeNull();
    expect(s!.items).toContain("setText");
  });

  it("Button. 后出 setOnClickListener", () => {
    const code = "public void f() {\n" +
      "Button b = new Button(ctx);\n" +
      "b.s";
    const s = computeJavaSuggest(code, { line: 4, col: 4 });
    // 前缀 "s" 太短（<2 字符）不弹 → 用 b.set 验证
    const code2 = "public void f() {\nButton b = new Button(ctx);\nb.s";
    const s2 = computeJavaSuggest(code2 + "e", { line: 4, col: 5 });
    expect(s2!.items).toContain("setOnClickListener");
  });

  it("Cursor. 后出 moveToNext", () => {
    const code = "void g() {\n" +
      "Cursor c = db.query(t, p);\n" +
      "c.m";
    const s = computeJavaSuggest(code + "o", { line: 4, col: 5 });
    expect(s!.items).toContain("moveToNext");
  });

  it("无接收者时仍给全局方法", () => {
    const s = computeJavaSuggest("class A { void f(){ startAct", { line: 1, col: 26 });
    expect(s!.items).toContain("startActivity");
  });

  it("接收者方法比无关全局方法更靠前", () => {
    // tv.se → TextView 的 setText 应比全局表里不相关的 se 方法靠前
    const code = "public void f() {\n" +
      "TextView tv = findViewById(R.id.tv);\n" +
      'tv.se';
    const s = computeJavaSuggest(code, { line: 4, col: 6 });
    const top5 = s!.items.slice(0, 5);
    expect(top5).toContain("setText");
  });
});
