// @vitest-environment node
// M446：块标记线「真 1px」防回归（源级断言）
//
// 背景（用户实测反馈）：M442 初始实现用 `box-shadow: inset Xpx 0 0 -0.5px`
// 想画 1px 竖线，但 inset 阴影的 offset-x 会把「从左到右到 X」整块填色，
// 负 spread 只缩 0.5px → 实际是一条宽 ~X-0.5px 的色带，不是线。
// 正确写法：绝对定位 ::before + width:1px。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(path.join(process.cwd(), "components/CodeEditor.tsx"), "utf8");

/** 取 .axv-bgl 那段主题定义（到下一个顶层 key 为止） */
function bglBlock(): string {
  const i = SRC.indexOf('".axv-bgl"');
  expect(i, "components/CodeEditor.tsx 里找不到 .axv-bgl 主题定义").toBeGreaterThan(-1);
  const rest = SRC.slice(i);
  const end = rest.indexOf("\n  },");
  return rest.slice(0, end > 0 ? end : rest.length);
}

describe("M446 块标记线必须真 1px", () => {
  it("不许再用 box-shadow inset 画竖线", () => {
    const blk = bglBlock();
    expect(/boxShadow/.test(blk), ".axv-bgl 又用回 boxShadow 了 → inset 阴影画不出 1px 线").toBe(false);
  });

  it("用 ::before 绝对定位 + width:1px", () => {
    const blk = bglBlock();
    expect(blk.includes("::before") || blk.includes('"&::before"'), "缺少 ::before").toBe(true);
    expect(/width:\s*"1px"/.test(blk), "::before 必须 width:1px").toBe(true);
    expect(/position:\s*"absolute"/.test(blk)).toBe(true);
  });

  it("::before 位置按列 × 字宽 + 14px 左内边距计算", () => {
    const blk = bglBlock();
    expect(blk.includes("--bgl-c"), "left 必须用 --bgl-c 列号").toBe(true);
    expect(blk.includes("--axv-code-chw"), "left 必须用 --axv-code-chw 字宽").toBe(true);
    expect(/left:\s*"calc\(14px/.test(blk), "left 必须以 14px（cm-line paddingLeft）开头").toBe(true);
  });

  it("装饰层每行带 --bgl-c 变量（样式与数据对齐）", () => {
    expect(SRC.includes("--bgl-c:"), "buildBlockGuidesDeco 必须给每行写 --bgl-c").toBe(true);
  });

  it("M447 线颜色不能太淡（alpha ≥ 0.45；M450 起普通色统一）", () => {
    const blk = bglBlock();
    const m = blk.match(/rgba?\((?:[^)]*?)([0-9.]+)\)/);
    expect(m, ".axv-bgl 找不到 rgba/rgb(...) 颜色").toBeTruthy();
    const alpha = Number((m as RegExpMatchArray)[1]);
    // M450：普通色统一 rgb(11 95 165 / 0.55)（M447 定档），不再按深度递减
    expect(alpha, `普通色 alpha=${alpha} 太淡（M447 用户实测几乎看不见）`).toBeGreaterThanOrEqual(0.45);
  });
});
