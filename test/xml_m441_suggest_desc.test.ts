// @vitest-environment node
// M441：候选说明行 —— 变量显示声明类型 / 方法显示返回类型 / 类显示完整类名
import { describe, expect, it } from "vitest";
import {
  extractDocSymbolTypes,
  varTypeAt,
  retTypeOf,
  fqnOf,
} from "@/lib/xml/doc-symbol-types";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";

/** 文档里用 | 标光标，算出 computeJavaSuggest 要的 { line, col } */
function suggestAt(docWithCaret: string) {
  const idx = docWithCaret.indexOf("|");
  const doc = docWithCaret.slice(0, idx) + docWithCaret.slice(idx + 1);
  const before = doc.slice(0, idx);
  const lines = before.split("\n");
  return { doc, cursor: { line: lines.length, col: lines[lines.length - 1].length + 1 } };
}

/** 取某个候选的说明行（子串） */
function subOf(sug: { items: string[]; subs?: (string | undefined)[] } | null, text: string) {
  if (!sug) return undefined;
  const i = sug.items.indexOf(text);
  if (i < 0) return undefined;
  return sug.subs?.[i];
}

describe("M441 extractDocSymbolTypes：变量类型", () => {
  it("字段声明 → 类型（含修饰符）", () => {
    const t = extractDocSymbolTypes("public class A {\n  private TextView tvTitle;\n}");
    expect(varTypeAt(t, "tvTitle", 999)).toBe("TextView");
  });

  it("局部变量 / 参数 / catch / for-each", () => {
    const src = `
class A {
  void f(String name, int count) {
    TextView tv = findViewById(1);
    try { } catch (Exception e) { }
    for (String s : list) { }
  }
}`;
    const t = extractDocSymbolTypes(src);
    expect(varTypeAt(t, "name", 999)).toBe("String");
    expect(varTypeAt(t, "count", 999)).toBe("int");
    expect(varTypeAt(t, "tv", 999)).toBe("TextView");
    expect(varTypeAt(t, "e", 999)).toBe("Exception");
    expect(varTypeAt(t, "s", 999)).toBe("String");
  });

  it("优先取光标之前最近的声明", () => {
    const src = "class A { void f() {\n  String x = \"a\";\n  int x2 = 1;\n} }";
    const t = extractDocSymbolTypes(src);
    const first = src.indexOf("String x");
    const second = src.indexOf("int x2");
    // 在第二个声明之后查 x → 仍按 x 自己的声明（不同名不影响）；这里直接验 pos 语义
    expect(varTypeAt(t, "x", first + 1)).toBe("String");
    expect(varTypeAt(t, "x", 0)).toBe("String"); // 光标在声明前 → 兜底取第一个
    expect(varTypeAt(t, "x2", second + 1)).toBe("int");
  });

  it("字符串/注释里的假声明不算", () => {
    const src = 'class A { void f() {\n  String s = "TextView fake";\n  // int commentVar = 1;\n} }';
    const t = extractDocSymbolTypes(src);
    expect(t.vars.has("fake")).toBe(false);
    expect(t.vars.has("commentVar")).toBe(false);
    expect(varTypeAt(t, "s", 999)).toBe("String");
  });
});

describe("M441 extractDocSymbolTypes：方法返回类型", () => {
  it("Java 返回值（void 不记）", () => {
    const src = `
class A {
  public String getTitle() { return ""; }
  private int count(int a) { return a; }
  void onClick(View v) { }
}`;
    const t = extractDocSymbolTypes(src);
    expect(retTypeOf(t, "getTitle")).toBe("String");
    expect(retTypeOf(t, "count")).toBe("int");
    expect(retTypeOf(t, "onClick")).toBeUndefined();
  });

  it("Kotlin fun 返回类型（Unit 不记）", () => {
    const src = `
class A {
  fun getTitle(): String = "x"
  fun setName(n: String) { }
  fun list(): List<String> { }
}`;
    const t = extractDocSymbolTypes(src, true);
    expect(retTypeOf(t, "getTitle")).toBe("String");
    expect(retTypeOf(t, "list")).toBe("List");
    expect(retTypeOf(t, "setName")).toBeUndefined();
  });
});

describe("M441 extractDocSymbolTypes：类全限定名", () => {
  it("import 语句 → 全名", () => {
    const t = extractDocSymbolTypes("package com.demo;\nimport android.widget.TextView;\nclass A {}");
    expect(fqnOf(t, "TextView")).toBe("android.widget.TextView");
  });

  it("同包自身类 → package + 简单名", () => {
    const t = extractDocSymbolTypes("package com.demo.app;\npublic class MainActivity {}");
    expect(fqnOf(t, "MainActivity")).toBe("com.demo.app.MainActivity");
  });

  it("通配 import 不收", () => {
    const t = extractDocSymbolTypes("import android.widget.*;\nclass A {}");
    expect(fqnOf(t, "TextView")).toBeUndefined();
  });
});

describe("M441 候选说明行接线", () => {
  const TPL = `
package com.demo;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView titleView;

    public String getLabel() { return "x"; }

    void setup() {
        TextView tv = null;
        int count = 0;
__CARET__
    }
}`;

  /** 在光标行打指定前缀后取候选 */
  const sugWith = (typed: string) => {
    const { doc, cursor } = suggestAt(TPL.replace("__CARET__", "        " + typed + "|"));
    return computeJavaSuggest(doc, cursor);
  };

  it("变量候选显示声明类型", () => {
    const sug = sugWith("t");
    expect(subOf(sug, "titleView")).toBe("TextView");
    expect(subOf(sug, "tv")).toBe("TextView");
    const s2 = sugWith("c");
    expect(subOf(s2, "count")).toBe("int");
  });

  it("方法候选显示返回类型（void 不显示类型）", () => {
    expect(subOf(sugWith("get"), "getLabel")).toBe("String");
    // setup 是 void → 不给返回类型（也无签名可显示）
    expect(subOf(sugWith("set"), "setup")).toBeUndefined();
  });

  it("类候选显示完整类名", () => {
    expect(subOf(sugWith("T"), "TextView")).toBe("android.widget.TextView");
    // 本文件的类（同包）→ package + 简单名
    expect(subOf(sugWith("M"), "MainActivity")).toBe("com.demo.MainActivity");
  });
});
