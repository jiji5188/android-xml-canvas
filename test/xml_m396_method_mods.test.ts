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
  lang: "java",
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

describe("M396 方法修饰符标注", () => {
  it("public 方法 → `() · public`", () => {
    const r = suggest(["public class M {", "    void f() {", "        loa", "    }", "}"], 3);
    expect(subOf(r, "load")).toBe("() · public");
  });
  it("private static 方法 → `(int a, int b) · private static`", () => {
    const r = suggest(["public class M {", "    void f() {", "        cal", "    }", "}"], 3);
    expect(subOf(r, "calc")).toBe("(int a, int b) · private static");
  });
  it("public static 方法 → `(String s) · public static`", () => {
    const r = suggest(["public class M {", "    void f() {", "        bui", "    }", "}"], 3);
    expect(subOf(r, "buildName")).toBe("(String s) · public static");
  });
  it("protected 方法 → `· protected`", () => {
    const r = suggest(["public class M {", "    void f() {", "        onB", "    }", "}"], 3);
    expect(subOf(r, "onBind")).toBe("() · protected");
  });
  it("包私有（无修饰符）不标", () => {
    const r = suggest(["public class M {", "    void f() {", "        pack", "    }", "}"], 3);
    const s = subOf(r, "packageMethod");
    expect(s).toBe("()"); // 签名在，但没有 " · " 后缀
  });
  it("abstract 方法 → `· abstract`", () => {
    const r = suggest(["public class M {", "    void f() {", "        ru", "    }", "}"], 3);
    expect(subOf(r, "run")).toBe("() · abstract");
  });
  it("SDK 成员（titleView.）→ `· public`", () => {
    const r = suggest(
      ["public class M {", "    private TextView titleView;", "    void f() {", "        titleView.", "    }", "}"],
      4,
    );
    expect(subOf(r, "setText")).toBe("() · public");
  });
  it("SDK 静态（Toast.）→ makeText `· public static`，实例方法 `· public`", () => {
    const r = suggest(["public class M {", "    void f() {", "        Toast.", "    }", "}"], 3);
    expect(subOf(r, "makeText")).toBe("() · public static");
    expect(subOf(r, "show")).toBe("() · public");
  });
});
