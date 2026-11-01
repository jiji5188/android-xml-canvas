// test/xml_m71_language_rules.test.ts — M71（C6）：Java / Kotlin 各一套语言规则块
//
// 以前 .kt 和 .java 收到同一份「Android XML 规则 + Java 契约」，
// 于是 Kotlin 文件里被塞 Java 写法（分号、匿名内部类、!!）也不奇怪。
import { describe, expect, it } from "vitest";
import { aiDocContextOf, buildAiSystemPrompt } from "@/lib/xml/ai-doc-context";

const promptOf = (rel: string) => buildAiSystemPrompt(aiDocContextOf(rel, ""), { canWrite: true });

describe("M71 按扩展名注入语言规则", () => {
  it(".java 收到 Java 规则，不出现 Kotlin 规则", () => {
    const p = promptOf("app/src/main/java/com/demo/MainActivity.java");
    expect(p).toContain("语言规则（Java / Android）");
    expect(p).toContain("匿名内部类");
    expect(p).not.toContain("语言规则（Kotlin / Android）");
    expect(p).not.toContain("by lazy");
  });

  it(".kt 收到 Kotlin 规则，不出现 Java 规则", () => {
    const p = promptOf("app/src/main/java/com/demo/MainActivity.kt");
    expect(p).toContain("语言规则（Kotlin / Android）");
    expect(p).toContain("by lazy");
    expect(p).toContain("setOnClickListener {");
    expect(p).not.toContain("语言规则（Java / Android）");
    expect(p).not.toContain("匿名内部类");
  });

  it(".kts（脚本）也按 Kotlin 处理", () => {
    expect(promptOf("app/build.gradle.kts")).toContain("语言规则（Kotlin / Android）");
  });

  it("布局/values/manifest 不注入语言规则（避免噪音）", () => {
    for (const rel of [
      "app/src/main/res/layout/a.xml",
      "app/src/main/res/values/strings.xml",
      "app/src/main/AndroidManifest.xml",
      "notes.txt",
    ]) {
      const p = promptOf(rel);
      expect(p).not.toContain("语言规则（Java");
      expect(p).not.toContain("语言规则（Kotlin");
    }
  });
});

describe("M71 规则内容要点", () => {
  it("Kotlin：禁止 !!、要求 lambda 监听器、协程用 lifecycleScope", () => {
    const p = promptOf("A.kt");
    expect(p).toContain("禁止 !!");
    expect(p).toContain("requireNotNull");
    expect(p).toContain("lifecycleScope");
    expect(p).toContain("repeatOnLifecycle");
    expect(p).toContain("GlobalScope");
    expect(p).toContain("data class");
  });

  it("Java：apply() 不用 commit()、try-with-resources、@IntDef", () => {
    const p = promptOf("A.java");
    expect(p).toContain("apply()");
    expect(p).toContain("commit()");
    expect(p).toContain("try-with-resources");
    expect(p).toContain("@IntDef");
    expect(p).toContain("4 空格");
  });

  it("两套都要求保持原语言、不改写、不引未声明依赖", () => {
    const j = promptOf("A.java");
    const k = promptOf("A.kt");
    expect(j).toContain("不要改写为 Kotlin");
    expect(k).toContain("不要改写成 Java");
    expect(j).toContain("未在 build.gradle 里声明的依赖");
    expect(k).toContain("不要引入未声明的依赖");
  });

  it("语言规则排在输出契约之后（先定契约再谈写法）", () => {
    const p = promptOf("A.kt");
    expect(p.indexOf("输出契约（Kotlin）")).toBeLessThan(p.indexOf("语言规则（Kotlin / Android）"));
  });

  it("只读项目（canWrite=false）也不会教模型用写工具", () => {
    const p = buildAiSystemPrompt(aiDocContextOf("A.kt", ""), { canWrite: false });
    expect(p).toContain("没有写权限");
  });
});
