// test/xml_m77_icon_back.test.ts — 图标编辑器返回按钮（移动端左上 / 桌面端右上 ✕）
//
// 用户 2026-11-02 08:31 定：返回按钮在移动端显示，右上角 ✕ 在桌面端显示。
// 这里守三件事：① .axv-icon-back 是 36×36 方块按钮且桌面端默认隐藏
// ② 移动端媒体查询里 return 显示、✕ 隐藏 ③ IconEditor 两处 head 都换成了新按钮
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "components/xml-canvas.css"), "utf8");
const editor = readFileSync(resolve(process.cwd(), "components/IconEditor.tsx"), "utf8");

/** 抓一条规则体（按选择器精确匹配，取到第一个 } 为止） */
function rule(sel: string): string {
  const i = css.indexOf(sel + " {");
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i) + 1);
}

describe("图标编辑器返回按钮（M77）", () => {
  it(".axv-icon-back 是 36×36 / 10px 圆角的方块按钮，且桌面端默认隐藏", () => {
    const r = rule(".axv-icon-back");
    expect(r).toContain("width: 36px");
    expect(r).toContain("height: 36px");
    expect(r).toContain("border-radius: 10px");
    expect(r).toContain("display: none");
  });

  it("触摸命中区扩到 44px（::after inset -4px）", () => {
    const r = rule(".axv-icon-back::after");
    expect(r).toContain("inset: -4px");
    expect(r).toContain("position: absolute");
  });

  it("移动端媒体查询：返回按钮显示、页头 ✕ 隐藏", () => {
    const re =
      /@media \(max-width: 840px\), \(pointer: coarse\) and \(max-width: 1024px\) \{[\s\S]{0,240}\.axv-icon-page \.axv-icon-back \{ display: grid; \}[\s\S]{0,200}\.axv-icon-page \.axv-shape-head \.axv-icon-btn \{ display: none; \}/;
    expect(css).toMatch(re);
  });

  it("规则只作用于 .axv-icon-page，不误伤自定义形状编辑器", () => {
    expect(css).not.toMatch(/\.axv-shape-page\s+\.axv-icon-btn\s*\{\s*display:\s*none/);
    expect(editor).toContain('className="axv-icon-page"');
  });

  it("IconEditor 两处 head 都用新按钮，且不再留旧的 axv-shape-back", () => {
    expect(editor.split('className="axv-icon-back"').length - 1).toBe(2);
    expect(editor).not.toContain("axv-shape-back");
    expect(editor).toContain('aria-label="返回编辑器"');
    expect(editor).toContain('title="返回"');
  });

  it("桌面端 ✕ 仍在（两处），且走 M78 的 close（内部 history.back，系统返回键也走同一条路）", () => {
    expect(editor.split('className="axv-icon-btn"').length - 1).toBe(2);
    expect(editor.split('onClick={close} aria-label="关闭"').length - 1).toBe(2);
  });
});
