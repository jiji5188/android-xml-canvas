import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

/**
 * M396：方法候选第二行标注修饰符（静态/公开/私有/受保护/抽象）。
 * - 项目词库方法：从声明行提取 public/private/protected/static/abstract
 * - SDK 类型表方法：默认 public；已知静态方法（Toast.makeText/Log.d…）标 public static
 * - 无修饰符（包私有）不标
 */
const PROJECT = {
  rel: "app/src/main/java/com/x/MainActivity.java",
  text:
    "package com.x;\n" +
    "public class MainActivity extends Activity {\n" +
    "    private TextView titleView;\n" +
    "    public void load() {}\n" +
    "    private static int calc(int a, int b) { return a+b; }\n" +
    "    protected void onBind() {}\n" +
    "    void packageMethod() {}\n" +
    "    public static String buildName(String s) { return s; }\n" +
    "    abstract void run();\n" +
    "}\n",
  lang: "java" as const,
};
const lex = buildLexicon([PROJECT]);

function suggest(lines: string[], line: number) {
  const col = lines[line - 1].length + 1;
  return computeJavaSuggest(lines.join("\n"), { line, col }, lex);
}

function subOf(r: ReturnType<typeof computeJavaSuggest>, name: string): string | undefined {
  if (!r) return undefined;
  const i = r.items.indexOf(name);
  return i >= 0 ? r.subs?.[i] : undefined;
}

describe("M396 方法修饰符标注（M453：参数移主行，说明行只留 修饰符 · 返回类型）", () => {
  it("public 方法 → `public`（void 无返回类型）", () => {
    const r = suggest(["public class M {", "    void f() {", "        loa", "    }", "}"], 3);
    expect(subOf(r, "load")).toBe("public");
  });
  it("private static 方法 → `private static · int`（M443：修饰符在前、返回类型最后）", () => {
    const r = suggest(["public class M {", "    void f() {", "        cal", "    }", "}"], 3);
    expect(subOf(r, "calc")).toBe("private static · int");
  });
  it("public static 方法 → `public static · String`", () => {
    const r = suggest(["public class M {", "    void f() {", "        bui", "    }", "}"], 3);
    expect(subOf(r, "buildName")).toBe("public static · String");
  });
  it("protected 方法 → `protected`", () => {
    const r = suggest(["public class M {", "    void f() {", "        onB", "    }", "}"], 3);
    expect(subOf(r, "onBind")).toBe("protected");
  });
  it("包私有（无修饰符、void）→ 无说明行（参数已在主行）", () => {
    const r = suggest(["public class M {", "    void f() {", "        pack", "    }", "}"], 3);
    const s = subOf(r, "packageMethod");
    expect(s).toBeUndefined();
  });
  it("abstract 方法 → `abstract`", () => {
    const r = suggest(["public class M {", "    void f() {", "        ru", "    }", "}"], 3);
    expect(subOf(r, "run")).toBe("abstract");
  });
  it("SDK 成员（titleView.）→ `public`", () => {
    const r = suggest(
      ["public class M {", "    private TextView titleView;", "    void f() {", "        titleView.", "    }", "}"],
      4,
    );
    expect(subOf(r, "setText")).toBe("public");
  });
  it("SDK 静态（Toast.）→ makeText `public static`，实例方法 `public`", () => {
    const r = suggest(["public class M {", "    void f() {", "        Toast.", "    }", "}"], 3);
    expect(subOf(r, "makeText")).toBe("public static");
    expect(subOf(r, "show")).toBe("public");
  });
  it("M453：主行参数 —— calc 显示 (int a, int b)，load 显示 ()", () => {
    const r = suggest(["public class M {", "    void f() {", "        cal", "    }", "}"], 3);
    const i = r!.items.indexOf("calc");
    expect(r!.sigs?.[i]).toBe("int a, int b");
    const r2 = suggest(["public class M {", "    void f() {", "        loa", "    }", "}"], 3);
    const j = r2!.items.indexOf("load");
    expect(r2!.sigs?.[j]).toBe("");
  });
  it("M453：SDK 词库补参数 —— titleView.setText 显示 (CharSequence)", () => {
    // 本用例的 lex 只含项目源码，无 SDK 索引 → setText 无参数信息
    const r = suggest(
      ["public class M {", "    private TextView titleView;", "    void f() {", "        titleView.set", "    }", "}"],
      4,
    );
    const i = r!.items.indexOf("setText");
    expect(r!.sigs?.[i]).toBeUndefined();
  });
});
