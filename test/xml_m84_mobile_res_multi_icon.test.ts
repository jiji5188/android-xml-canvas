// M84 源码护栏：移动端资源抽屉 + 多图标插入 + 路径拖拽不变形
// 用 node 环境读源码（jsdom 里没有 node:fs）
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("M84 移动端资源面板（M86 起改为常规流式，不做抽屉）", () => {
  const src = read("components/IconCanvasEditor.tsx");
  const css = read("components/xml-canvas.css");

  it("不再有抽屉开关 / 遮罩 / 标题栏按钮", () => {
    expect(src).not.toContain("resOpen");
    expect(src).not.toContain("axv-cv-res-btn");
    expect(src).not.toContain("axv-cv-res-mask");
    expect(css).not.toContain("axv-cv-res-btn");
    expect(css).not.toContain("axv-cv-res-mask");
  });

  it("CSS：移动端右栏留在常规流（不 absolute、不 translateX）", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 840px)"));
    const formRule = mobile.slice(mobile.indexOf(".axv-cv-body .axv-icon-ed-form.axv-cv-form"));
    expect(formRule.slice(0, 400)).toContain("position: static");
    expect(mobile.slice(0, 900)).not.toContain("transform: translateX(100%)");
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

describe("M84 pathData 右栏", () => {
  const src = read("components/IconCanvasEditor.tsx");

  it("pathData 只在右侧边栏出现，底部样式表不再有", () => {
    expect(src).toContain("const pathSel = useMemo");
    const formStart = src.indexOf("axv-cv-form");
    const sheetStart = src.indexOf("axv-cv-sheet-body");
    const formPart = src.slice(formStart, sheetStart);
    const sheetPart = src.slice(sheetStart);
    expect(formPart).toContain("axv-icon-ed-pathdata");
    expect(sheetPart).not.toContain("axv-icon-ed-pathdata");
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
