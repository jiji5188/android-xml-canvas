// test/xml_m63h_layers_css.test.ts — 静态护栏（node 环境；jsdom 里 readFileSync 不可用）
// M63h：形状页 / 图标页 z-index 收到 3000；形状底栏改 space-evenly + wrap + gap 8
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("components/xml-canvas.css", "utf8");

function block(selector: string): string {
  const i = css.indexOf(selector);
  expect(i, `没找到 ${selector}`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

describe("M63h 层级与底栏样式", () => {
  it("形状页 z-index 3000", () => {
    expect(block(".axv-shape-page {")).toMatch(/z-index:\s*3000/);
  });

  it("图标页 z-index 3000", () => {
    expect(block(".axv-icon-page {")).toMatch(/z-index:\s*3000/);
  });

  it("形状底栏 flex + space-evenly + center + wrap + gap 8", () => {
    const b = block(".axv-shape-foot {");
    expect(b).toMatch(/display:\s*flex/);
    expect(b).toMatch(/justify-content:\s*space-evenly/);
    expect(b).toMatch(/align-items:\s*center/);
    expect(b).toMatch(/flex-wrap:\s*wrap/);
    expect(b).toMatch(/gap:\s*8px/);
  });

  it("取色器蒙版（4000）仍然盖得住这两页", () => {
    expect(block(".axv-cf-mask {")).toMatch(/z-index:\s*4000/);
  });
});
