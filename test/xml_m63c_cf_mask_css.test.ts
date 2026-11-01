// test/xml_m63c_cf_mask_css.test.ts — 静态护栏（node 环境；jsdom 里拿不到 node:fs）
// 取色器改成「全屏蒙版 + 居中弹层」：不许再按锚点算 x/y，弹层 max-width 300px。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("components/xml-canvas.css", "utf8");
const src = readFileSync("components/ColorField.tsx", "utf8");

describe("颜色取色器：蒙版 + 居中", () => {
  it("蒙版是全屏 fixed 且内容居中", () => {
    const i = css.indexOf(".axv-cf-mask {");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 400);
    expect(block).toContain("position: fixed");
    expect(block).toContain("inset: 0");
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).toMatch(/justify-content:\s*center/);
  });

  it("弹层 max-width 300px 且不再写死 236px", () => {
    const i = css.lastIndexOf(".axv-cf-pop {");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 400);
    expect(block).toContain("max-width: 300px");
    expect(block).toContain("position: relative");
    expect(block).not.toContain("width: 236px");
  });

  it("弹窗内使用时层级要盖过模态遮罩", () => {
    expect(css).toContain(".axv-cf-mask.is-above-modal");
    expect(css).toMatch(/\.axv-cf-mask\.is-above-modal\s*\{[^}]*z-index:\s*20100/);
  });

  it("组件用蒙版渲染，不再用 getBoundingClientRect 算坐标", () => {
    expect(src).toContain("axv-cf-mask");
    expect(src).not.toContain("getBoundingClientRect");
    expect(src).not.toContain("POP_W");
  });
});
