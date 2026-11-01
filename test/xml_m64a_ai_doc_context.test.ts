// test/xml_m64a_ai_doc_context.test.ts — M64a / A1：AI 得知道「当前打开的是哪种文件」
//
// 背景（真 bug）：编辑器把任何文档都塞在同一个 xml state 里，AiPanel 以前一律按
// 「当前布局 XML」发出去，system prompt 还要求只输出布局 XML。打开 MainActivity.java
// 问「这个方法干什么」，模型会回你一段布局代码。这条测试守三件事：
//   ① 文件类型判定（java / kotlin / values / manifest / layout / 其他 xml / 文本）
//   ② 上下文块与 system prompt 跟着类型切换（Java 明确禁止输出布局 XML）
//   ③ 只有布局才允许「替换画布」，其他类型的代码块不能往画布写
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  aiDocContextOf,
  buildAiSystemPrompt,
  docPreamble,
  quickActionsFor,
  resolveAiDocKind,
} from "@/lib/xml/ai-doc-context";
import { AI_QUICK_ACTIONS } from "@/lib/xml/ai";

const LAYOUT_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView android:id="@+id/tv_title" android:layout_width="wrap_content" android:layout_height="wrap_content" />
</LinearLayout>`;

const JAVA_SRC = `package com.example.app;

import android.os.Bundle;

public class MainActivity extends BaseActivity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
    }
}`;

describe("M64a resolveAiDocKind：按路径判文件类型", () => {
  it("java / kt / kts 各归各的", () => {
    expect(resolveAiDocKind("app/src/main/java/com/example/MainActivity.java")).toBe("java");
    expect(resolveAiDocKind("app/src/main/java/com/example/MainActivity.kt")).toBe("kotlin");
    expect(resolveAiDocKind("build.gradle.kts")).toBe("kotlin");
  });

  it("values / manifest / 布局 / 其他 xml 分开", () => {
    expect(resolveAiDocKind("app/src/main/res/values/strings.xml")).toBe("values");
    expect(resolveAiDocKind("app/src/main/AndroidManifest.xml")).toBe("manifest");
    expect(resolveAiDocKind("app/src/main/res/layout/activity_main.xml")).toBe("layout");
    expect(resolveAiDocKind("app/src/main/res/drawable/bg_card.xml")).toBe("xml");
    expect(resolveAiDocKind("app/src/main/res/menu/main.xml")).toBe("xml");
  });

  it("没有路径时按内容根标签兜底", () => {
    expect(resolveAiDocKind(null, LAYOUT_XML)).toBe("layout");
    expect(resolveAiDocKind(null, "<resources><string name=\"a\">b</string></resources>")).toBe("xml");
    // 粘贴一段 Java（无路径）不会误判成布局
    expect(resolveAiDocKind("", JAVA_SRC)).not.toBe("layout");
  });
});

describe("M64a aiDocContextOf：标题 / 代码块语言 / 契约", () => {
  it("java：标题是源码，代码块是 java，禁止输出布局 XML", () => {
    const ctx = aiDocContextOf("app/src/main/java/com/example/MainActivity.java", JAVA_SRC);
    expect(ctx.kind).toBe("java");
    expect(ctx.title).toContain("Java 源码");
    expect(ctx.fence).toBe("java");
    expect(ctx.codeTag).toBe("Java");
    expect(ctx.attachLabel).toBe("带代码");
    expect(ctx.canReplaceCanvas).toBe(false);
    expect(ctx.contract.join("\n")).toContain("不要输出 Android XML 布局");
  });

  it("kotlin：契约要求 Kotlin 惯用写法", () => {
    const ctx = aiDocContextOf("app/src/main/java/com/example/MainActivity.kt", "class A");
    expect(ctx.kind).toBe("kotlin");
    expect(ctx.codeTag).toBe("Kotlin");
    expect(ctx.contract.join("\n")).toContain("Kotlin");
    expect(ctx.contract.join("\n")).toContain("未编译验证");
  });

  it("layout：唯一允许替换画布的类型", () => {
    const ctx = aiDocContextOf("app/src/main/res/layout/activity_main.xml", LAYOUT_XML);
    expect(ctx.kind).toBe("layout");
    expect(ctx.canReplaceCanvas).toBe(true);
    expect(ctx.attachLabel).toBe("带布局");
  });

  it("values / manifest / 其他 xml 都不允许替换画布", () => {
    for (const rel of [
      "app/src/main/res/values/strings.xml",
      "app/src/main/AndroidManifest.xml",
      "app/src/main/res/drawable/bg_card.xml",
    ]) {
      expect(aiDocContextOf(rel).canReplaceCanvas).toBe(false);
    }
  });
});

describe("M64a buildAiSystemPrompt：角色与契约一起切换", () => {
  it("Java 的 prompt 是 Java 助手 + Java 契约，不含布局契约", () => {
    const p = buildAiSystemPrompt(aiDocContextOf("MainActivity.java", JAVA_SRC));
    expect(p).toContain("Android Java 开发助手");
    expect(p).toContain("输出契约（Java）");
    expect(p).not.toContain("输出契约（布局 XML）");
    expect(p).not.toContain("根节点必须带 xmlns:android");
  });

  it("布局的 prompt 仍是布局契约", () => {
    const p = buildAiSystemPrompt(aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT_XML));
    expect(p).toContain("布局助手");
    expect(p).toContain("xmlns:android");
  });
});

describe("M64a docPreamble：上下文块标题/语言按类型切换", () => {
  it("java：标题「当前 Java 源码」，语言 java，带相对路径", () => {
    const ctx = aiDocContextOf("app/src/main/java/com/example/MainActivity.java", JAVA_SRC);
    const p = docPreamble(ctx, JAVA_SRC, { relPath: "app/src/main/java/com/example/MainActivity.java" });
    expect(p).toContain("当前 Java 源码");
    expect(p).toContain("```java");
    expect(p).toContain("MainActivity.java");
    expect(p).not.toContain("当前布局 XML");
  });

  it("layout：带选中路径；非布局类型忽略选中", () => {
    const layout = aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT_XML);
    expect(docPreamble(layout, LAYOUT_XML, { selection: "LinearLayout > TextView#tv_title" })).toContain("当前选中控件路径");
    const java = aiDocContextOf("MainActivity.java", JAVA_SRC);
    expect(docPreamble(java, JAVA_SRC, { selection: "LinearLayout > TextView#tv_title" })).not.toContain("当前选中控件路径");
  });

  it("超长内容截断并标注原长", () => {
    const ctx = aiDocContextOf("A.java", JAVA_SRC);
    const long = "x".repeat(500);
    const p = docPreamble(ctx, long, { maxChars: 100 });
    expect(p).toContain("已截断");
    expect(p).toContain("原长 500");
  });
});

describe("M64a quickActionsFor：快捷指令按类型换", () => {
  it("布局沿用原来的四条", () => {
    const ctx = aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT_XML);
    expect(quickActionsFor(ctx)).toBe(AI_QUICK_ACTIONS);
  });

  it("Java 换成代码类指令，且不再出现 ConstraintLayout / lint 这类布局动作", () => {
    const ctx = aiDocContextOf("MainActivity.java", JAVA_SRC);
    const acts = quickActionsFor(ctx);
    expect(acts.map((a) => a.label)).not.toEqual(AI_QUICK_ACTIONS.map((a) => a.label));
    const all = acts.map((a) => a.prompt).join("\n");
    expect(all).not.toContain("ConstraintLayout");
    expect(all).not.toContain("Android Lint");
    expect(acts.some((a) => a.label.includes("代码"))).toBe(true);
  });

  it("values / manifest 用文件类指令", () => {
    const ctx = aiDocContextOf("app/src/main/res/values/strings.xml");
    expect(quickActionsFor(ctx)[0].label).toContain("文件");
  });
});

describe("M64a 接线护栏（源码级）", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("XmlEditor 把当前文档路径传给 AiPanel", () => {
    const src = read("components/XmlEditor.tsx");
    expect(src).toMatch(/<AiPanel[\s\S]*?docRel=\{/);
  });

  it("AiPanel 用 doc 上下文拼 prompt，且只有可替换时才给替换按钮", () => {
    const src = read("components/AiPanel.tsx");
    expect(src).toContain("buildAiSystemPrompt(doc)");
    expect(src).toContain("docPreamble(doc, xml");
    expect(src).toContain("canReplaceCanvas");
    // 老写法（硬编码「当前布局 XML」）不能再回来
    expect(src).not.toContain("`当前布局 XML：");
  });
});
