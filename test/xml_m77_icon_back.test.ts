// test/xml_m77_icon_back.test.ts — 图标编辑器返回按钮（M88 起桌面端 + 移动端统一用左上返回）
//
// M77（2026-11-02 08:31）：返回按钮移动端显示、右上 ✕ 桌面端显示。
// M88（2026-11-02 01:43 用户定）：删掉右上 ✕，两端都用左侧返回按钮；
//   页头撤销/重做（.axv-cv-head-tools）在移动端不再被隐藏。
// 这里守：① .axv-icon-back 是 36×36 方块按钮且默认可见
// ② 页头不再有 ✕ ③ 移动端不再整片隐藏 .axv-icon-btn ④ 两处 head 都用返回按钮
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "components/xml-canvas.css"), "utf8");
const editor = readFileSync(resolve(process.cwd(), "components/IconEditor.tsx"), "utf8");
const cvEditor = readFileSync(resolve(process.cwd(), "components/IconCanvasEditor.tsx"), "utf8");

/** 抓一条规则体（按选择器精确匹配，取到第一个 } 为止） */
function rule(sel: string): string {
  const i = css.indexOf(sel + " {");
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i) + 1);
}

describe("图标编辑器返回按钮（M77 → M88 统一左侧返回）", () => {
  it(".axv-icon-back 是 36×36 / 10px 圆角的方块按钮，默认可见（两端都用它）", () => {
    const r = rule(".axv-icon-back");
    expect(r).toContain("width: 36px");
    expect(r).toContain("height: 36px");
    expect(r).toContain("border-radius: 10px");
    expect(r).toContain("display: grid");
    expect(r).not.toContain("display: none");
  });

  it("触摸命中区扩到 44px（::after inset -4px）", () => {
    const r = rule(".axv-icon-back::after");
    expect(r).toContain("inset: -4px");
    expect(r).toContain("position: absolute");
  });

  it("移动端不再整片隐藏页头按钮（撤销/重做要留着）", () => {
    const re =
      /@media \(max-width: 840px\), \(pointer: coarse\) and \(max-width: 1024px\) \{[\s\S]{0,240}\.axv-icon-page \.axv-icon-back \{ display: grid; \}/;
    expect(css).toMatch(re);
    expect(css).not.toMatch(/\.axv-icon-page \.axv-shape-head \.axv-icon-btn \{ display: none; \}/);
  });

  it("规则只作用于 .axv-icon-page，不误伤自定义形状编辑器", () => {
    expect(css).not.toMatch(/\.axv-shape-page\s+\.axv-icon-btn\s*\{\s*display:\s*none/);
    expect(editor).toContain('className="axv-icon-page"');
  });

  it("IconEditor 两处 head 都用返回按钮，且不再留旧的 axv-shape-back", () => {
    expect(editor.split('className="axv-icon-back"').length - 1).toBe(2);
    expect(editor).not.toContain("axv-shape-back");
    expect(editor).toContain('aria-label="返回编辑器"');
    expect(editor).toContain('title="返回"');
  });

  it("M88：页头右上 ✕ 已删除（旧 IconEditor + 画布式 IconCanvasEditor 都不再有）", () => {
    expect(editor).not.toContain('aria-label="关闭"');
    expect(cvEditor).not.toContain("axv-cv-close");
    // 主 head 的撤销/重做仍在，且返回按钮走 M78 的 close（history.back）
    expect(cvEditor).toContain("axv-cv-head-tools");
    expect(cvEditor).toContain("<button className=\"axv-icon-back\" onClick={close}");
  });
});
