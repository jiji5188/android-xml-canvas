// test/xml_m63c_cf_mask_css.test.ts —— 静态护栏（node 环境；jsdom 里拿不到 node:fs）
// M89d：颜色选择器统一到 ColorPicker（.axv-cp-mask + .axv-cp），旧的 .axv-cf-mask / .axv-cf-pop 已退役。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("components/xml-canvas.css", "utf8");
const src = readFileSync("components/ColorField.tsx", "utf8");

describe("颜色取色器：全屏蒙版 + 居中弹窗", () => {
  it("蒙版 fixed 铺满且居中，层级 5000", () => {
    const i = css.indexOf(".axv-cp-mask {");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 400);
    expect(block).toContain("position: fixed");
    expect(block).toContain("inset: 0");
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).toMatch(/justify-content:\s*center/);
    expect(block).toMatch(/z-index:\s*5000/);
  });

  it("弹窗本体 .axv-cp 宽 380px 且自适应窄屏", () => {
    const i = css.indexOf(".axv-cp {");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 300);
    expect(block).toContain("width: 380px");
    expect(block).toContain("max-width: 100%");
  });

  it("整页/弹窗里用 is-above-page 抬到模态之上", () => {
    expect(css).toMatch(/\.axv-cp-mask\.is-above-page\s*\{[^}]*z-index:\s*20150/);
  });

  it("旧那套 .axv-cf-mask / .axv-cf-pop 已删干净", () => {
    expect(css).not.toContain(".axv-cf-mask");
    expect(css).not.toContain(".axv-cf-pop");
  });

  it("ColorField 用 ColorPicker 渲染，不再引用 HsvPicker", () => {
    expect(src).toContain("ColorPicker");
    expect(src).not.toContain('from "./HsvPicker"');
    expect(src).not.toContain("axv-cf-pop");
    expect(src).not.toContain("getBoundingClientRect");
  });
});
