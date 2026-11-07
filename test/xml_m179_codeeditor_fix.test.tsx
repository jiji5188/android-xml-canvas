// test/xml_m179_codeeditor_fix.test.tsx
// M179：代码编辑器错误条上的「修复 N 处」按钮（仅当有带 fix 的问题时出现）
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeEditor } from "../components/CodeEditor";
import type { LintIssue } from "../lib/xml/lint";

const base = { line: 3, level: "warn" as const, message: "R.id.titel 在项目布局里不存在" };

function html(errors: LintIssue[], withHandler = true) {
  return renderToStaticMarkup(
    <CodeEditor value={"class A {}"} onChange={() => {}} errors={errors} onFixAll={withHandler ? () => {} : undefined} />,
  );
}

describe("CodeEditor — M179 一键修复按钮", () => {
  it("有 fix 时显示修复按钮 + 数量", () => {
    const out = html([
      { ...base, fix: { from: "R.id.titel", to: "R.id.title", label: "R.id.titel → R.id.title" } },
    ]);
    expect(out).toContain("axv-err-fix");
    expect(out).toContain("修复 1 处");
    // title 属性里带具体改动预览
    expect(out).toContain("R.id.titel");
  });

  it("两处可修时数字是 2", () => {
    const out = html([
      { ...base, fix: { from: "R.id.a", to: "R.id.b", label: "R.id.a → R.id.b" } },
      { ...base, line: 5, fix: { from: "setTxt", to: "setText", label: "setTxt → setText" } },
    ]);
    expect(out).toContain("修复 2 处");
  });

  it("没有 fix 的警告不显示按钮", () => {
    const out = html([base]);
    expect(out).not.toContain("axv-err-fix");
  });

  it("没传 onFixAll 时不显示按钮（只读场景）", () => {
    const out = html(
      [{ ...base, fix: { from: "R.id.a", to: "R.id.b", label: "R.id.a → R.id.b" } }],
      false,
    );
    expect(out).not.toContain("axv-err-fix");
  });

  it("只有 warn 级可修问题时错误条也出现（不依赖 error）", () => {
    const out = html([
      { ...base, fix: { from: "R.id.a", to: "R.id.b", label: "R.id.a → R.id.b" } },
    ]);
    expect(out).toContain("axv-code-errbar");
    expect(out).toContain("有 1 处可自动修复");
  });

  it("有 error 时优先显示错误文案（仍然带修复按钮）", () => {
    const out = html([
      { ...base, level: "error", message: "第 3 行少了一个 }" },
      { ...base, line: 7, fix: { from: "R.id.a", to: "R.id.b", label: "R.id.a → R.id.b" } },
    ]);
    expect(out).toContain("第 3 行");
    expect(out).toContain("axv-err-fix");
  });
});
