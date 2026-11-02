// M84 源码护栏：移动端资源抽屉 + 多图标插入 + 路径拖拽不变形
// 用 node 环境读源码（jsdom 里没有 node:fs）
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("M84 移动端资源面板", () => {
  const src = read("components/IconCanvasEditor.tsx");
  const css = read("components/xml-canvas.css");

  it("有抽屉开关状态与触发按钮", () => {
    expect(src).toContain("const [resOpen, setResOpen]");
    expect(src).toContain("axv-cv-res-btn");
    expect(src).toContain("axv-cv-res-mask");
    expect(src).toContain("axv-cv-res-head");
  });

  it("右栏按 resOpen 加 is-open，并有遮罩层", () => {
    expect(src).toMatch(/axv-cv-form[\s\S]*is-open/);
    expect(src).toContain('className="axv-cv-res-mask"');
  });

  it("CSS：移动端右栏 absolute + 滑出，桌面端按钮隐藏", () => {
    expect(css).toMatch(/\.axv-cv-res-btn\s*\{\s*display:\s*none/);
    const mobile = css.slice(css.indexOf("@media (max-width: 840px)"));
    const formRule = mobile.slice(mobile.indexOf(".axv-cv-body .axv-icon-ed-form.axv-cv-form"));
    expect(formRule.slice(0, 400)).toContain("position: absolute");
    expect(mobile).toContain("transform: translateX(100%)");
    // is-open 的权重必须压过上面的定位规则，否则展开无效
    expect(css).toContain(".axv-cv-body .axv-icon-ed-form.axv-cv-form.is-open { transform: none; }");
  });
});

describe("M84 多图标插入", () => {
  const src = read("components/IconCanvasEditor.tsx");

  it("插入图标走 IconPickerPanel 且不替换现有图形", () => {
    expect(src).toContain("const [inserting, setInserting]");
    expect(src).toContain("const insertIcon = (vectorXml: string)");
    expect(src).toMatch(/setShapes\(\(list\) => \[\.\.\.list, \.\.\.add\]\)/);
  });

  it("插入时按视口等比缩放并居中", () => {
    const body = src.slice(src.indexOf("const insertIcon"));
    expect(body).toContain("Math.min(meta.vw / Math.max(0.001, src.vw)");
    expect(body).toContain("scalePath(copy.d, scale, scale, 0, 0)");
    expect(body).toContain("translateShape(copy, ox, oy)");
  });
});

describe("M84 拖拽不变形", () => {
  it("translatePath 会平移所有绝对命令（H/V/L/C/A）", () => {
    const lib = read("lib/xml/canvas-shapes.ts");
    const body = lib.slice(lib.indexOf("export function translatePath"));
    for (const cmd of ['case "H"', 'case "V"', 'case "C"', 'case "A"']) {
      expect(body).toContain(cmd);
    }
  });
});
