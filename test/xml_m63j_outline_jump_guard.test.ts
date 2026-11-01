// test/xml_m63j_outline_jump_guard.test.ts — 静态护栏（node 环境；jsdom 里 readFileSync 不可用）
// M63j：右侧函数列表跳行 → 移动端必须收起右侧面板
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("components/XmlEditor.tsx", "utf8");

describe("M63j 函数列表跳行的移动端收面板", () => {
  it("jumpToCodeLine 里有 isMobile → setRightOpen(false)", () => {
    const i = src.indexOf("const jumpToCodeLine");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 600);
    expect(body).toMatch(/if\s*\(\s*isMobile\s*\)\s*setRightOpen\(false\)/);
  });

  it("手机上还会先切到「代码」tab", () => {
    const body = src.slice(src.indexOf("const jumpToCodeLine"), src.indexOf("const jumpToCodeLine") + 600);
    expect(body).toMatch(/mobileTab\s*!==\s*"xml"/);
    expect(body).toContain('setMobileTab("xml")');
  });

  it("跳行仍然走 requestAnimationFrame（等编辑器挂载）", () => {
    const body = src.slice(src.indexOf("const jumpToCodeLine"), src.indexOf("const jumpToCodeLine") + 600);
    expect(body).toContain("requestAnimationFrame");
  });
});
