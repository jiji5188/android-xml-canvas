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

const SRC = fs.readFileSync(path.resolve(__dirname, "../components/XmlEditor.tsx"), "utf8");

describe("M142 Java 文件不再套 XML 校验", () => {
  it("XmlEditor 里 Java 分支走 lintJava，而不是 lintCodeDoc / lintXml", () => {
    expect(SRC).toContain('from "@/lib/xml/java-lint"');
    const i = SRC.indexOf("const lints = useMemo");
    expect(i).toBeGreaterThan(0);
    const block = SRC.slice(i, i + 1600);
    expect(block).toContain("if (isJavaFile)");
    expect(block).toContain("lintJava(lintSrc");
    // Java 分支必须在 codeOnly 之前，否则还是会被 XML 检查吃掉
    expect(block.indexOf("if (isJavaFile)")).toBeLessThan(block.indexOf("else if (codeOnly)"));
    // 依赖数组里要有 isJavaFile，否则切文件不重算
    expect(block).toContain("isJavaFile");
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
