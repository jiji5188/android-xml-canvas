// @vitest-environment node
// M453：候选主行显示 `方法名(参数)` + 弹窗宽度自适应（上限 420、随内容增长）
import { describe, expect, it } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";
import { estimateSuggestSize, SUG_MAX_W, SUG_MIN_W } from "@/lib/xml/suggest-position";
import sdkIndex from "../public/sdk-api-index.json";

describe("M453 SDK 索引带参数表（p）", () => {
  const C = (sdkIndex as { classes: Record<string, { p?: Record<string, string>; r?: Record<string, string> }> })
    .classes;
  it("Handler.post → Runnable；postDelayed → Runnable, long；无参 → 空串", () => {
    expect(C["Handler"].p?.post).toBe("Runnable");
    expect(C["Handler"].p?.postDelayed).toBe("Runnable, long");
    expect(C["Handler"].p?.obtainMessage).toBe("");
  });
  it("TextView.getText → 无参；setText → CharSequence", () => {
    expect(C["TextView"].p?.getText).toBe("");
    expect(C["TextView"].p?.setText).toBe("CharSequence");
    expect(C["TextView"].r?.getText).toBe("CharSequence");
  });
  it("数组/基本类型混排（View.draw → Canvas）", () => {
    expect(C["View"].p?.draw).toBe("Canvas");
  });
});

describe("M453 主行参数（sigs）", () => {
  const PROJECT = {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text:
      "package com.x;\n" +
      "public class MainActivity {\n" +
      "    public int calc(int a, int b) { return a+b; }\n" +
      "    public void load() {}\n" +
      "}\n",
    lang: "java" as const,
  };
  const lex = buildLexicon([PROJECT]);

  const suggest = (lines: string[], line: number) => {
    const col = lines[line - 1].length + 1;
    return computeJavaSuggest(lines.join("\n"), { line, col }, lex);
  };

  it("项目方法：calc → sigs='int a, int b'；load → sigs=''（显示 ()）", () => {
    const r = suggest(["public class M {", "    void f() {", "        cal", "    }", "}"], 3);
    const i = r!.items.indexOf("calc");
    expect(r!.sigs?.[i]).toBe("int a, int b");
    const r2 = suggest(["public class M {", "    void f() {", "        loa", "    }", "}"], 3);
    const j = r2!.items.indexOf("load");
    expect(r2!.sigs?.[j]).toBe("");
  });

  it("无签名信息（关键词/变量/类）→ sigs 为 undefined，主行不带括号", () => {
    const r = suggest(["public class M {", "    void f() {", "        fin", "    }", "}"], 3);
    const i = r!.items.indexOf("final");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r!.sigs?.[i]).toBeUndefined();
  });
});

describe("M453 弹窗宽度自适应", () => {
  it("按显示串（名+参数）估算：带长参数的宽度 > 纯名宽度，且 ≤ SUG_MAX_W", () => {
    const plain = estimateSuggestSize(["post"]);
    const withArgs = estimateSuggestSize(["post(Runnable, long, int, Message)"]);
    expect(withArgs.width).toBeGreaterThan(plain.width);
    expect(withArgs.width).toBeLessThanOrEqual(SUG_MAX_W);
  });

  it("上限 SUG_MAX_W=420，下限 SUG_MIN_W=180", () => {
    expect(SUG_MAX_W).toBe(420);
    const s = estimateSuggestSize([]);
    expect(s.width).toBe(SUG_MIN_W);
    const huge = estimateSuggestSize(["x".repeat(200)]);
    expect(huge.width).toBe(SUG_MAX_W);
  });
});
