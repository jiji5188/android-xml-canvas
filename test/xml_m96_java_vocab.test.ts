// test/xml_m96_java_vocab.test.ts — M96：Java 关键字/类/方法候选 + 符号栏
import { describe, expect, it } from "vitest";
import {
  JAVA_KEYWORDS,
  JAVA_METHODS,
  JAVA_SYMBOLS,
  JAVA_TYPES,
  computeJavaSuggest,
} from "../lib/xml/java-vocab";

/** 光标放在文本末尾时的 { line, col } */
function suggest(text: string) {
  const lines = text.split("\n");
  return computeJavaSuggest(text, { line: lines.length, col: lines[lines.length - 1].length + 1 });
}

describe("M96 Java 词汇表", () => {
  it("声明类关键字齐全", () => {
    for (const k of [
      "public",
      "private",
      "protected",
      "class",
      "interface",
      "enum",
      "extends",
      "implements",
      "static",
      "final",
      "abstract",
      "void",
      "new",
      "return",
      "import",
      "package",
    ]) {
      expect(JAVA_KEYWORDS, `缺关键字 ${k}`).toContain(k);
    }
  });

  it("基础类型与常用类都有", () => {
    for (const t of ["int", "long", "double", "boolean", "String", "List", "ArrayList", "Map", "HashMap"]) {
      expect([...JAVA_KEYWORDS, ...JAVA_TYPES], `缺类型 ${t}`).toContain(t);
    }
    for (const t of ["Log", "Toast", "Handler", "Context", "Activity", "RecyclerView", "SharedPreferences"]) {
      expect(JAVA_TYPES, `缺 Android 类 ${t}`).toContain(t);
    }
  });

  it("常用方法都有", () => {
    for (const m of ["toString", "equals", "hashCode", "onCreate", "findViewById", "setText", "runOnUiThread"]) {
      expect(JAVA_METHODS, `缺方法 ${m}`).toContain(m);
    }
  });

  it("三组词汇没有重复项（组内不重复）", () => {
    for (const arr of [JAVA_KEYWORDS, JAVA_TYPES, JAVA_METHODS]) {
      expect(new Set(arr).size).toBe(arr.length);
    }
  });
});

describe("M96 Java 候选计算", () => {
  it("打声明关键字：cl → class", () => {
    const s = suggest("public cl");
    expect(s).not.toBeNull();
    expect(s!.items[0]).toBe("class");
    expect(s!.prefix).toBe("cl");
    expect(s!.kind).toBe("decl"); // M99：kind 从 plain 变成逐条分类后的首条分类
  });

  it("修饰符：pr → private，且能候选到 protected", () => {
    const s = suggest("pr");
    expect(s!.items[0]).toBe("private");
    expect(s!.items).toContain("protected");
  });

  it("类型：Str → String 最前", () => {
    const s = suggest("String name = Str");
    expect(s!.items[0]).toBe("String");
  });

  it("方法：toSt → toString", () => {
    const s = suggest("obj.toSt");
    expect(s!.items[0]).toBe("toString");
    expect(s!.prefix).toBe("toSt");
  });

  it("注解：@Ov → @Override", () => {
    const s = suggest("@Ov");
    expect(s!.items[0]).toBe("@Override");
    expect(s!.prefix).toBe("@Ov");
  });

  it("行注释里不弹", () => {
    expect(suggest("// public cl")).toBeNull();
  });

  it("字符串里不弹", () => {
    expect(suggest('String s = "public cl')).toBeNull();
  });

  it("前缀太短 / 无匹配返回 null", () => {
    expect(suggest("p")).toBeNull();
    expect(suggest("zzzzqqq")).toBeNull();
  });

  it("候选数量有上限", () => {
    const s = suggest("on");
    expect(s!.items.length).toBeLessThanOrEqual(24); // M98：MAX_ITEMS 12→24
  });
});

describe("M96 Java 符号栏", () => {
  it("包含 Java 高频符号", () => {
    const labels = JAVA_SYMBOLS.map((s) => s.label);
    for (const l of ["{}", "()", "[]", "<>", ";", "->", "::", "==", "!=", "&&", "||", "@Override", "TODO"]) {
      expect(labels, `符号栏缺 ${l}`).toContain(l);
    }
  });

  it("成对符号光标落中间（back = 1）", () => {
    for (const pair of ["{}", "()", "[]", "<>", '""']) {
      const s = JAVA_SYMBOLS.find((x) => x.label === pair);
      expect(s, `缺 ${pair}`).toBeTruthy();
      expect(s!.insert).toBe(pair);
      expect(s!.back).toBe(1);
    }
  });

  it("每条符号都有插入文本", () => {
    for (const s of JAVA_SYMBOLS) {
      expect(s.insert.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
