// test/xml_m202_diag.test.ts — M202：AIDE 式精确错误引导
//
// 覆盖两块：
//   1. lib/xml/diag-deco.ts 的 diagRanges（纯函数）：有 col 画精确范围、没 col 退回整行、
//      越界 / 0 长度范围的处理
//   2. lib/xml/java-lint.ts 现在带 col/len 的规则（brace / rid / import / method）

import { describe, it, expect } from "vitest";
import { diagRanges, type DiagInfo } from "@/lib/xml/diag-deco";
import { lintJava } from "@/lib/xml/java-lint";

/** 造一个 DocLike：给文本，算出 line(n) 的 from/to */
function makeDoc(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const line = (n: number) => {
    const from = starts[n - 1];
    const to = n < starts.length ? starts[n] - 1 : text.length;
    return { from, to };
  };
  return { lines: starts.length, line };
}

describe("diagRanges (M202)", () => {
  it("有 col 时画精确范围（不整行）", () => {
    const text = "int x = 1;\nint y = 2;\n";
    const doc = makeDoc(text);
    const m = new Map<number, DiagInfo>([[1, { line: 1, sev: "error", msg: "m", col: 5, len: 3 }]]);
    const r = diagRanges(doc, m);
    expect(r).toHaveLength(1);
    // 第 1 行 "int x = 1;" col=5 → 偏移 4（0 起）= 'x'，len=3 → 到 "x = "前
    const l1 = doc.line(1);
    expect(r[0].from).toBe(l1.from + 4);
    expect(r[0].full).toBe(false);
  });

  it("没有 col 时退回整行标色", () => {
    const text = "abc\ndef\n";
    const doc = makeDoc(text);
    const m = new Map<number, DiagInfo>([[1, { line: 1, sev: "error", msg: "m" }]]);
    const r = diagRanges(doc, m);
    expect(r).toHaveLength(1);
    expect(r[0].full).toBe(true);
    expect(r[0].from).toBe(0);
    expect(r[0].to).toBe(3);
  });

  it("越界行号被跳过", () => {
    const doc = makeDoc("a\n");
    const m = new Map<number, DiagInfo>([[99, { line: 99, sev: "error", msg: "m" }]]);
    expect(diagRanges(doc, m)).toHaveLength(0);
  });

  it("col=1 视为整行（边界）", () => {
    const text = "hello\n";
    const doc = makeDoc(text);
    const m = new Map<number, DiagInfo>([[1, { line: 1, sev: "warn", msg: "w", col: 1 }]]);
    const r = diagRanges(doc, m);
    expect(r[0].full).toBe(true);
  });

  it("多条按 from 排序", () => {
    const text = "aa\nbb\ncc\n";
    const doc = makeDoc(text);
    const m = new Map<number, DiagInfo>([
      [3, { line: 3, sev: "error", msg: "c" }],
      [1, { line: 1, sev: "error", msg: "a" }],
    ]);
    const r = diagRanges(doc, m);
    expect(r.map((x) => x.msg)).toEqual(["a", "c"]);
  });
});

describe("lintJava col/len (M202)", () => {
  it("多余括号带 col（精确到那个括号）", () => {
    const src = "void f() {\n  if (x) { }\n}\n)";
    const iss = lintJava(src);
    const brace = iss.find((i) => i.code === "brace");
    expect(brace).toBeTruthy();
    expect(brace!.col).toBe(1); // 第 4 行只有 ")"，col=1
    expect(brace!.len).toBe(1);
  });

  it("R.id 拼错带 col/len（圈住整段 R.id.xxx）", () => {
    const src = "v = findViewById(R.id.bnn);\n";
    const iss = lintJava(src, { ids: ["btn"] });
    const rid = iss.find((i) => i.code === "rid");
    expect(rid).toBeTruthy();
    expect(rid!.col).toBeGreaterThan(1);
    expect(rid!.len).toBe("R.id.bnn".length);
    // col 落在 R.id.bnn 起点
    const idx = src.indexOf("R.id.bnn");
    expect(rid!.col).toBe(idx + 1);
  });

  it("缺 import 带 col/len（圈住用法处的类名）", () => {
    const src = "class A {\n  void f() {\n    Intent it = new Intent();\n  }\n}\n";
    const iss = lintJava(src);
    const imp = iss.find((i) => i.code === "import");
    expect(imp).toBeTruthy();
    // 用法处在第一处 Intent 出现的位置（行内列号）
    expect(imp!.col).toBeGreaterThan(0);
    expect(imp!.len).toBe("Intent".length);
  });

  it("方法名拼错带 col/len（圈住方法名）", () => {
    const src = "btn.setTexttt(\"hi\");\n";
    const iss = lintJava(src);
    const m = iss.find((i) => i.code === "method");
    expect(m).toBeTruthy();
    expect(m!.col).toBeGreaterThan(1);
    expect(m!.len).toBeGreaterThan(0);
  });
});
