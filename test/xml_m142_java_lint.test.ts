// M142：.java / .kt 文件不能用 XML 规则校验
//
// 用户反馈：打开 Java 文件，第 530 行报「<1){ 未闭合」。
// 原因：XmlEditor 对非布局文件统一走 lintCodeDoc（XML 结构检查），
// Java 里的 `if (a<1) {` 被当成标签开始，于是整段报未闭合。
// 修法：Java/Kotlin 走 lintJava，别碰 XML 规则。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";

// M366 step11：lints 块已下沉到 components/use-lints.ts（shell 不再含 `const lints = useMemo`）
const SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/use-lints.ts"),
  "utf8",
);

describe("M142 Java 文件不再套 XML 校验", () => {
  it("XmlEditor 里 Java 分支走 lintJava，而不是 lintCodeDoc / lintXml", () => {
    expect(SRC).toContain('from "@/lib/xml/java-lint"');
    const i = SRC.indexOf("const lints = useMemo");
    expect(i).toBeGreaterThan(0);
    const block = SRC.slice(i, i + 2200);
    expect(block).toContain("if (D.isJavaFile)");
    expect(block).toContain("lintJava(lintSrc");
    // Java 分支必须在 codeOnly 之前，否则还是会被 XML 检查吃掉
    expect(block.indexOf("if (D.isJavaFile)")).toBeLessThan(block.indexOf("else if (D.codeOnly)"));
    // 依赖数组里要有 isJavaFile，否则切文件不重算
    expect(block).toContain("D.isJavaFile");
  });

  it("用户那段登录校验代码本身没有结构错误（<1 不该被判成标签）", () => {
    const code = [
      "String use= user_edit.getText().toString().trim();",
      "String pw=pasw_edit.getText().toString().trim();",
      "if(use.isEmpty()||use.length()<1){",
      '    Toast.makeText(v.getContext(),"请输入用户名",0).show();',
      "    user_edit.setFocusable(true);",
      "    user_edit.requestFocus();",
      "    return;",
      "}",
    ].join("\n");
    const issues = lintJava(code);
    const errs = issues.filter((i) => i.sev === "error");
    expect(errs.map((e) => e.msg)).not.toContain("未闭合");
    expect(errs).toHaveLength(0);
  });

  it("真未闭合的大括号仍然会被报出来", () => {
    const issues = lintJava("void f() {\n  if (x < 1) {\n  }\n");
    expect(issues.some((i) => i.sev === "error")).toBe(true);
  });
});

describe("M253 被分号割裂的标识符（extends Activ;ity）要报 error", () => {
  it("用户的真实片段：extends Activ;ity 报 syntax error", () => {
    const code = [
      "package com.myapp;",
      "",
      "import android.os.Bundle;",
      "import android.widget.Button;",
      "import android.view.View;",
      "import android.widget.TextView;",
      "",
      "public class MainActivity extends Activ;ity {",
      "",
      "    @Override",
    ].join("\n");
    const issues = lintJava(code);
    const syntax = issues.filter((i) => i.code === "syntax");
    expect(syntax.length).toBeGreaterThan(0);
    expect(syntax[0].sev).toBe("error");
    // 圈住的是整个坏标识符 Activ;ity，不是只画分号
    expect(syntax[0].msg).toContain("Activ;ity");
    expect(syntax[0].line).toBe(8);
  });

  it("普通合法代码不报 syntax（不误伤）", () => {
    const code = [
      "public class A {",
      "    int x = 1;",
      "    void f() { int y = 2; }",
      "}",
    ].join("\n");
    const issues = lintJava(code);
    expect(issues.filter((i) => i.code === "syntax")).toHaveLength(0);
  });

  it("字符串里的分号割裂不报（mask 已抹掉）", () => {
    const code = ['public class A { String s = "ab;cd"; }'].join("\n");
    const issues = lintJava(code);
    expect(issues.filter((i) => i.code === "syntax")).toHaveLength(0);
  });

  it("M275：for 循环的 `;` 是分隔符，不误报（用户的 for(int io=0;io<hb.length();io++)）", () => {
    const code = [
      "public class A {",
      "    void f(String hb) {",
      "        for(int io=0;io<hb.length();io++){",
      "        }",
      "    }",
      "}",
    ].join("\n");
    const issues = lintJava(code);
    expect(issues.filter((i) => i.code === "syntax")).toHaveLength(0);
  });

  it("M275：紧凑 for(int i=0;i<n;i++) 也不误报（n;i 都是字母但在 for 括号里）", () => {
    const code = [
      "public class A {",
      "    void f(int n) {",
      "        for(int i=0;i<n;i++) { x(); }",
      "    }",
      "}",
    ].join("\n");
    const issues = lintJava(code);
    expect(issues.filter((i) => i.code === "syntax")).toHaveLength(0);
  });

  it("M275：真正的 extends Activ;ity 仍然报（不在 for 括号里）", () => {
    const code = "public class A extends Activ;ity {}";
    const issues = lintJava(code);
    const syntax = issues.filter((i) => i.code === "syntax");
    expect(syntax.length).toBeGreaterThan(0);
    expect(syntax[0].msg).toContain("Activ;ity");
  });
});
