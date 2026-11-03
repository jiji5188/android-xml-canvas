// test/xml_m99_suggest_kinds.test.ts — M99：候选词分类角标（声/类/方/变/常/引/属）
import { describe, expect, it } from "vitest";
import { KIND_LABEL, KIND_NAME, classifyJavaWord, classifyXmlItem, extractJavaTokens } from "@/lib/xml/suggest-kind";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { computeSuggest } from "@/lib/xml/keyword-suggest";

const JAVA_DOC = [
  "package com.demo;",
  "import android.widget.TextView;",
  "public class MainActivity extends AppCompatActivity {",
  "    private static final int MAX_COUNT = 10;",
  "    private TextView titleView;",
  "    protected void onCreate(Bundle savedInstanceState) {",
  "        super.onCreate(savedInstanceState);",
  '        String userName = getIntent().getStringExtra("n");',
  "        titleView.setText(userName);",
  "        for (int i = 0; i < MAX_COUNT; i++) { }",
  "    }",
  "}",
].join("\n");

/** 在文档末尾追加一行再取光标（行号/列都按追加后的算） */
function javaSuggest(tail: string) {
  const doc = JAVA_DOC + "\n        " + tail;
  const lines = doc.split("\n");
  return computeJavaSuggest(doc, { line: lines.length, col: lines[lines.length - 1].length + 1 });
}

const XML_DOC = [
  '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '    android:layout_width="match_parent"',
  '    android:layout_height="wrap_content">',
  '    <TextView android:id="@+id/title_view" android:text="Hello" />',
  "</LinearLayout>",
].join("\n");

function xmlSuggest(tail: string, res?: string[]) {
  const doc = XML_DOC + "\n" + tail;
  const lines = doc.split("\n");
  return computeSuggest(doc, { line: lines.length, col: lines[lines.length - 1].length + 1 }, res);
}

describe("M99 分类标签", () => {
  it("7 个分类 + plain，单字标签对齐", () => {
    expect(KIND_LABEL.decl).toBe("声");
    expect(KIND_LABEL.class).toBe("类");
    expect(KIND_LABEL.method).toBe("方");
    expect(KIND_LABEL.var).toBe("变");
    expect(KIND_LABEL.const).toBe("常");
    expect(KIND_LABEL.ref).toBe("引");
    expect(KIND_LABEL.prop).toBe("属");
    // 每个都有中文全称，供 title 提示
    for (const k of ["decl", "class", "method", "var", "const", "ref", "prop"] as const) {
      expect(KIND_NAME[k].length).toBeGreaterThan(1);
    }
  });

  it("形状兜底：@ 引用 / # 颜色 / ns:name / 大驼峰 / 全大写 / 小写", () => {
    expect(classifyXmlItem("@drawable/ic_x", "plain")).toBe("ref");
    expect(classifyXmlItem("#ff0000", "plain")).toBe("const");
    expect(classifyXmlItem("android:text", "plain")).toBe("prop");
    expect(classifyXmlItem("TextView", "plain")).toBe("class");
    expect(classifyXmlItem("MAX_COUNT", "plain")).toBe("const");
    expect(classifyXmlItem("title_view", "plain")).toBe("var");
    expect(classifyJavaWord("@Override")).toBe("ref");
    expect(classifyJavaWord("MAX_COUNT")).toBe("const");
    expect(classifyJavaWord("TextView")).toBe("class");
    expect(classifyJavaWord("setText")).toBe("method");
  });
});

describe("M99 XML 候选分类", () => {
  it("标签名 → 类", () => {
    const s = xmlSuggest("    <Text");
    expect(s).not.toBeNull();
    expect(s!.items).toContain("TextView");
    expect(s!.kinds!.every((k) => k === "class")).toBe(true);
  });

  it("属性名 → 属", () => {
    const s = xmlSuggest("    <TextView android:te");
    expect(s!.items).toContain("android:text");
    expect(s!.kinds!.every((k) => k === "prop")).toBe(true);
  });

  it("枚举值 → 常", () => {
    const s = xmlSuggest('    <TextView android:layout_width="match_');
    expect(s!.items).toContain("match_parent");
    expect(s!.kinds![s!.items.indexOf("match_parent")]).toBe("const");
  });

  it("资源引用 → 引", () => {
    const s = xmlSuggest('    <TextView android:background="@draw', ["ic_logo", "ic_launcher"]);
    expect(s!.items).toContain("@drawable/");
    expect(s!.kinds!.every((k) => k === "ref")).toBe(true);

    // 打完命名空间再给资源名
    const s2 = xmlSuggest('    <TextView android:background="@drawable/ic', ["ic_logo", "ic_launcher"]);
    expect(s2!.items).toContain("@drawable/ic_logo");
    expect(s2!.kinds!.every((k) => k === "ref")).toBe(true);
  });

  it("正在打的词本身不进候选（文档 token 会把它扫进来）", () => {
    expect(xmlSuggest("    <Text")!.items).not.toContain("Text");
    expect(javaSuggest("Stri")!.items).not.toContain("Stri");
    expect(javaSuggest("MAX")!.items).not.toContain("MAX");
  });

  it("kinds 与 items 等长，且每条都在 7 类里", () => {    for (const tail of ["    <Text", "    <TextView android:te", '    <TextView android:layout_width="match_']) {
      const s = xmlSuggest(tail)!;
      expect(s.kinds!.length).toBe(s.items.length);
      for (const k of s.kinds!) expect(KIND_LABEL[k]).toBeTruthy();
    }
  });
});

describe("M99 Java 候选分类", () => {
  it("关键字 → 声", () => {
    const s = javaSuggest("pub");
    expect(s!.items[0]).toBe("public");
    expect(s!.kinds![0]).toBe("decl");
  });

  it("类型 → 类", () => {
    const s = javaSuggest("Stri");
    expect(s!.items[0]).toBe("String");
    expect(s!.kinds![0]).toBe("class");
  });

  it("已知 API 方法 → 方", () => {
    const s = javaSuggest("onCr");
    expect(s!.items).toContain("onCreate");
    expect(s!.kinds![s!.items.indexOf("onCreate")]).toBe("method");
  });

  it("本文件里的变量 → 变（排在词表前面）", () => {
    const s = javaSuggest("user");
    expect(s!.items[0]).toBe("userName");
    expect(s!.kinds![0]).toBe("var");
  });

  it("本文件里的常量 → 常", () => {
    const s = javaSuggest("MAX");
    expect(s!.items[0]).toBe("MAX_COUNT");
    expect(s!.kinds![0]).toBe("const");
  });

  it("注解 → 引", () => {
    const s = javaSuggest("@Ov");
    expect(s!.items[0]).toBe("@Override");
    expect(s!.kinds![0]).toBe("ref");
  });

  it("字段/形参/for 变量都能抠出来", () => {
    const t = extractJavaTokens(JAVA_DOC);
    expect(t.vars).toContain("userName");
    expect(t.vars).toContain("titleView");
    expect(t.vars).toContain("savedInstanceState");
    expect(t.consts).toContain("MAX_COUNT");
    expect(t.methods).toContain("setText");
    expect(t.types).toContain("TextView");
  });
});
