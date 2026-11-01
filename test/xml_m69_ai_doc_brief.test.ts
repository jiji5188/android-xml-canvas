// test/xml_m69_ai_doc_brief.test.ts — M69（A3）：文档进 system 前缀 + 大文件只给结构摘要
//
// 以前每轮把整份文档塞进 user 消息：文档一变（甚至只是追加一轮提问）前缀就变，
// prompt cache 一次都不中，命中/不命中成本差两倍。现在：
//   1) 文档挪进 system，顺序固定（角色/契约 → 项目事实 → 工具说明 → 文档）
//   2) 超过 DOC_INLINE_MAX 的文档只给结构摘要，让模型自己 outline/read_file 取细节
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiDocContextOf, docBrief, DOC_INLINE_MAX } from "@/lib/xml/ai-doc-context";

const ctxOf = (rel: string) => aiDocContextOf(rel, "");

function bigLayout(n: number): string {
  const rows = Array.from(
    { length: n },
    (_, i) => `    <TextView android:id="@+id/tv_${i}" android:text="@string/s_${i}" android:textSize="14sp" />`,
  ).join("\n");
  return `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">\n${rows}\n</LinearLayout>`;
}

describe("M69 docBrief：小文件整份给", () => {
  it("小于阈值时内容原样进 prompt，truncated=false", () => {
    const xml = `<LinearLayout><Button android:id="@+id/ok" android:text="确定" /></LinearLayout>`;
    const r = docBrief(ctxOf("app/src/main/res/layout/a.xml"), xml);
    expect(r.truncated).toBe(false);
    expect(r.chars).toBe(xml.length);
    expect(r.text).toContain('android:text="确定"');
  });
});

describe("M69 docBrief：大文件只给结构摘要", () => {
  it("大布局给根标签 / 控件统计 / id 列表，不整份贴", () => {
    const xml = bigLayout(240);
    expect(xml.length).toBeGreaterThan(DOC_INLINE_MAX);
    const r = docBrief(ctxOf("app/src/main/res/layout/big.xml"), xml);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("太长没有整份贴出");
    expect(r.text).toContain("根标签：<LinearLayout>");
    expect(r.text).toContain("TextView×240");
    expect(r.text).toContain("tv_0");
    expect(r.text).toContain("read_file {offset,limit}");
    // 摘要必须比原文小一个量级
    expect(r.text.length).toBeLessThan(xml.length / 4);
  });

  it("大 Java 文件给 package + 类/方法行号，提示先 outline", () => {
    const methods = Array.from(
      { length: 400 },
      (_, i) => `    private void doWork${i}() {\n        counter += ${i};\n    }`,
    ).join("\n");
    const src = `package com.demo.big;\n\npublic class BigActivity {\n    int counter;\n${methods}\n}\n`;
    const r = docBrief(aiDocContextOf("app/src/main/java/com/demo/big/BigActivity.java", ""), src);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("package：com.demo.big");
    expect(r.text).toContain("doWork0");
    expect(r.text).toMatch(/L\d+ /);
    expect(r.text).toContain("先调 outline");
    expect(r.text).not.toContain("counter += 399");
  });

  it("大 values 文件给条目统计与前几个名字", () => {
    const items = Array.from({ length: 900 }, (_, i) => `    <string name="k_${i}">v</string>`).join("\n");
    const src = `<resources>\n${items}\n</resources>`;
    const r = docBrief(aiDocContextOf("app/src/main/res/values/strings.xml", ""), src);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("string×900");
    expect(r.text).toContain("k_0");
  });

  it("大 manifest 给权限与组件摘要", () => {
    const perms = Array.from(
      { length: 60 },
      (_, i) => `    <uses-permission android:name="android.permission.P${i}" />`,
    ).join("\n");
    const src = `<manifest>\n${perms}\n    <application>\n        <activity android:name=".MainActivity" />\n    </application>\n</manifest>`;
    const r = docBrief(aiDocContextOf("app/src/main/AndroidManifest.xml", ""), src, { maxChars: 400 });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("权限：");
    expect(r.text).toContain("activity .MainActivity");
  });

  it("纯文本大文件只给开头 1200 字符", () => {
    const src = "x".repeat(DOC_INLINE_MAX + 500);
    const r = docBrief(ctxOf("notes.txt"), src);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("开头 1200 字符");
    expect(r.text.length).toBeLessThan(2000);
  });
});

describe("M69 AiPanel：文档在 system、易变内容在 user", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/AiPanel.tsx"), "utf8");

  it("system 里含文档块（docBrief），且顺序在工具说明之后", () => {
    expect(src).toContain("docBrief(doc, xml");
    const toolIdx = src.indexOf("AI_TOOL_PROMPT");
    const docIdx = src.indexOf("docBlock,");
    expect(toolIdx).toBeGreaterThan(0);
    expect(docIdx).toBeGreaterThan(toolIdx);
  });

  it("user 消息里不再拼整份文档（只有选中/资源/工具记忆 + 问题）", () => {
    expect(src).not.toContain("docPreamble(");
    expect(src).toContain("const volatile: string[] = [];");
    expect(src).toContain("当前选中控件路径：");
  });

  it("工具记忆不再进 system（否则每轮都在变，前缀失效）", () => {
    const sysBlock = src.slice(src.indexOf("const sys = ["), src.indexOf("].filter(Boolean).join"));
    expect(sysBlock).not.toContain("mem,");
  });
});
