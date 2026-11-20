// @vitest-environment node
// M448：块标记线「一块一条、{ 到 } 不断开」防回归（源级断言）
//
// 背景（用户实测反馈，2026-11-20 两张截图 + 文字）：
// 旧 M442/M446/M447 写法是「块内每行一段 ::before（top:0;bottom:0）」，行与行之间的
// 亚像素缝隙在手机上放大后变成肉眼可见的「断线」。
// 用户要求：别人家编辑器是「开始到结束是一对一对的」—— 每条线从 { 那行一直连到
// 对应 } 那行，一条完整竖线；且不同嵌套层级可以用不同透明度/颜色区分。
// 修法：装饰只放在「块的起始行」，::before 高度 = 行数 × 行高（--bgl-l × --axv-code-lh），
// 一条元素贯穿整块；深度 --bgl-d → 透明度 --bgl-a（blockGuideAlpha：外层 0.55、内层递减、
// 最低 0.18）。
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

describe("M448 块标记线 = 每块一条贯穿线（{ 到 } 不断开）", () => {
  it("不许再用 box-shadow inset 画竖线（M446 防回归保留）", () => {
    expect(/boxShadow/.test(bglBlock()), ".axv-bgl 又用回 boxShadow 了").toBe(false);
  });

  it("::before 高度 = 行数 × 行高（一条贯穿整块，不再每行一段）", () => {
    const blk = bglBlock();
    expect(blk.includes('"&::before"') || blk.includes("::before"), "缺少 ::before").toBe(true);
    expect(/height:\s*"calc\(var\(--bgl-l[^)]*\)/.test(blk), "必须用 --bgl-l × 行高做整块高度").toBe(true);
    expect(blk.includes("--axv-code-lh"), "高度基准必须用 --axv-code-lh（与 .cm-scroller 行高一致）").toBe(true);
    expect(blk.includes("bottom"), "M448 起不再需要 bottom:0（高度已贯穿到块尾）").toBe(false);
  });

  it("宽度保持 1px（M446 用户明确要求）+ 列位公式不变", () => {
    const blk = bglBlock();
    expect(/width:\s*"1px"/.test(blk), "::before 必须 width:1px").toBe(true);
    expect(blk.includes("--bgl-c") && blk.includes("--axv-code-chw"), "left 必须按列号 × 字宽").toBe(true);
    expect(/left:\s*"calc\(14px/.test(blk), "left 必须以 14px（cm-line paddingLeft）开头").toBe(true);
  });

  it("按深度区分透明度：--bgl-d 数据 + 最低 0.18 + 外层最深", () => {
    expect(SRC.includes("--bgl-d:"), "buildBlockGuidesDeco 必须写 --bgl-d（深度）").toBe(true);
    const fn = SRC.match(/export function blockGuideAlpha[\s\S]{0,200}/);
    expect(fn, "找不到 blockGuideAlpha 函数").toBeTruthy();
    const body = fn![0];
    expect(body.includes("0.18"), "透明度下限 0.18（最内层也看得见）").toBe(true);
    expect(body.includes("0.55"), "最外层 0.55（M447 定档，灰底主题清晰）").toBe(true);
  });

  it("装饰只在「块的起始行」（每个块一条，不再每行一条）", () => {
    const deco = SRC.match(/export function buildBlockGuidesDeco[\s\S]{0,900}/);
    expect(deco, "找不到 buildBlockGuidesDeco").toBeTruthy();
    const body = deco![0];
    // 旧写法特征：内层 for (let ln = g.startLine; ... 循环逐行 push → 不允许再出现
    expect(/for\s*\(\s*let\s+ln\s*=/.test(body), "M448 起装饰只放起始行，逐行循环已移除").toBe(false);
    expect(body.includes("doc.line(g.startLine)"), "装饰必须定位在块起始行").toBe(true);
  });
});
