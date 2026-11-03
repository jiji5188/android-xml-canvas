import fs from "node:fs";
import { test, expect, describe, it } from "vitest";

const read = (p: string) => fs.readFileSync(`D:/android-xml-canvas/repo/${p}`, "utf8");

describe("M86 移动端右栏不做抽屉（M88c 改为右悬浮滑面板）", () => {
  const src = read("components/IconCanvasEditor.tsx");
  const css = read("components/xml-canvas.css");

  it("移动端右栏为靠右浮层，不整块隐藏", () => {
    expect(src).not.toContain("resOpen");
    expect(css).not.toContain("axv-cv-res-mask");
    expect(css).not.toContain("axv-cv-res-btn");
    expect(css).toMatch(/@media \(max-width: 840px\)\s*\{[\s\S]*?\.axv-cv-body \{[\s\S]*?flex-direction: column/);
    // M88c：右栏改成靠右悬浮滑面板（仍不是「整块隐藏的抽屉」，宽度 75vw）
    expect(css).toMatch(/\.axv-cv-body \.axv-icon-ed-form\.axv-cv-form \{[\s\S]*?position: absolute/);
    expect(css).toMatch(/\.axv-cv-body \.axv-icon-ed-form\.axv-cv-form \{[\s\S]*?width: 75vw/);
  });

  it("移动端底部样式抽屉默认收起", () => {
    expect(src).toMatch(/window\.matchMedia\("\(max-width: 840px\)"\)\.matches\) setSheetOpen\(false\)/);
  });
});

describe("M86 画布面板加入画布尺寸", () => {
  const src = read("components/IconCanvasEditor.tsx");

  it("有画布尺寸预设与 viewport 等比缩放", () => {
    expect(src).toContain("axv-cv-sizes");
    expect(src).toContain("const resizeViewport = (size: number)");
    expect(src).toContain("[24, 48, 96, 240, 512]");
    // 缩放时深拷贝，防 StrictMode 双跑 updater 二次缩放
    expect(src).toMatch(/setShapes\(\(list\) =>\s*list\.map\(\(s\) =>[\s\S]{0,120}JSON\.parse\(JSON\.stringify\(s\)\)/);
  });

  it("画布面板含网格开关", () => {
    const board = src.slice(src.indexOf('sheetTab === "board"'), src.indexOf('sheetTab === "align"'));
    expect(board).toContain("显示网格");
    expect(board).toContain("showGrid");
  });
});

describe("M86 图层面板移植原页面功能", () => {
  const src = read("components/IconCanvasEditor.tsx");
  const css = read("components/xml-canvas.css");

  it("图层行有 上移/下移 按钮与拖拽手柄", () => {
    expect(src).toContain('title={tt("上移一层")}');
    expect(src).toContain('title={tt("下移一层")}');
    expect(src).toContain("axv-cv-layer-grip");
    expect(src).toContain("const moveLayerOne = (id: string");
    expect(css).toContain(".axv-cv-layer-grip");
    expect(css).toContain(".axv-cv-layer.is-drop");
  });

  it("图层面板有 ➕ 插入图标按钮（M88i 起用 add 图标）", () => {
    expect(src).toMatch(/className="axv-cv-mini" onClick=\{\(\) => setInserting\(true\)\} title=\{tt\("插入图标（追加成新图层）"\)\}>\s*<span className="msr"[^>]*>add<\/span>/);
  });
});

describe("M86 选区锚点缩小", () => {
  const src = read("components/IconCanvasEditor.tsx");

  it("锚点半径随视口换算，不再写死 2.6", () => {
    /* M89b：锚点半径再除以组缩放（组内缩放时手柄大小保持屏幕一致） */
    expect(src).toMatch(/r=\{\s*\(meta\.vw \* 0\.017\) \/\s*Math\.max\(0\.4, zoom\)/);
    expect(src).toContain("vectorEffect=\"non-scaling-stroke\"");
    expect(src).not.toContain("r={2.6 / Math.max(0.4, zoom)}");
  });
});
