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
import { guideIndexAt, buildBlockGuidesDeco } from "@/components/CodeEditor";
import { pickRenderedGuides, computeBlockGuides } from "@/lib/xml/block-guides";

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

  it("M449：竖线跳过起始行/结束行（top 偏移 1 行，不压到 { 和 } 的文字）", () => {
    const blk = bglBlock();
    expect(/top:\s*"calc\(var\(--bgl-t/.test(blk), "top 必须用 --bgl-t 偏移行数（不能是 0）").toBe(true);
    const deco = SRC.match(/export function buildBlockGuidesDeco[\s\S]{0,1200}/);
    const body = deco![0];
    expect(body.includes("--bgl-t:1"), "装饰必须写 --bgl-t:1（跳起始行）").toBe(true);
    expect(/g\.endLine[^;]*-\s*g\.startLine\s*-\s*1/.test(body), "中间行数 = endLine - startLine - 1").toBe(true);
    expect(body.includes("if (n < 1) continue"), "中间没行（{ } 紧邻）时不能画").toBe(true);
  });

  it("宽度保持 1px（M446 用户明确要求）+ 列位公式不变", () => {
    const blk = bglBlock();
    expect(/width:\s*"1px"/.test(blk), "::before 必须 width:1px").toBe(true);
    expect(blk.includes("--bgl-c") && blk.includes("--axv-code-chw"), "left 必须按列号 × 字宽").toBe(true);
    expect(/left:\s*"calc\(14px/.test(blk), "left 必须以 14px（cm-line paddingLeft）开头").toBe(true);
  });

  it("M450：只要 2 种颜色（普通 + 当前编辑块高亮），不随深度淡化", () => {
    const blk = bglBlock();
    // 普通色统一（不再 --bgl-a/--bgl-d 按深度递减）
    expect(/background:\s*"var\(--axv-code-bgl, rgb\(11 95 165 \/ 0\.55\)\)"/.test(blk), "普通色默认蓝 0.55（M447 定档）").toBe(true);
    expect(blk.includes("--bgl-a"), "M450 起不再按深度写 --bgl-a（用户不要淡化）").toBe(false);
    // 高亮色（光标所在最内层块）
    const SRC = readFileSync(path.join(process.cwd(), "components/CodeEditor.tsx"), "utf8");
    const act = SRC.indexOf('.axv-bgl.axv-bgl-active');
    expect(act, "必须有 .axv-bgl-active 高亮规则").toBeGreaterThan(-1);
    expect(SRC.slice(act, act + 300).includes("--axv-code-bgl-active"), "高亮色必须走 --axv-code-bgl-active 变量（可覆盖）").toBe(true);
    expect(SRC.includes("axv-bgl axv-bgl-active"), "装饰必须给当前块加 axv-bgl-active class").toBe(true);
    expect(SRC.includes("export function guideIndexAt"), "必须有 guideIndexAt（光标行 → 最内层块下标）").toBe(true);
    expect(SRC.includes("guideIndexAt(picked, headLine)"), "装饰必须跟随光标所在块（guideIndexAt 调用）").toBe(true);
  });

  it("装饰只在「块的起始行」（每个块一条，不再每行一条）", () => {
    const deco = SRC.match(/export function buildBlockGuidesDeco[\s\S]{0,900}/);
    expect(deco, "找不到 buildBlockGuidesDeco").toBeTruthy();
    const body = deco![0];
    // 旧写法特征：内层 for (let ln = g.startLine; ... 循环逐行 push → 不允许再出现
    expect(/for\s*\(\s*let\s+ln\s*=/.test(body), "M448 起装饰只放起始行，逐行循环已移除").toBe(false);
    expect(body.includes("doc.line(g.startLine)"), "装饰必须定位在块起始行").toBe(true);
  });

  it("M450 guideIndexAt：光标行 → 最内层块下标（功能验证）", () => {
    const CODE = [
      "public class Demo {", // 1
      "    void run() {", // 2
      "        if (x) {", // 3
      "            a();", // 4
      "        }", // 5
      "    }", // 6
      "}", // 7
    ].join("\n");
    const picked = pickRenderedGuides(computeBlockGuides(CODE), 8, 60);
    // picked: [class(1-7,depth1), run(2-6,depth2), if(3-5,depth3)]
    // 光标在中间行才算（{ 行 / } 行本身不算内层块）
    expect(guideIndexAt(picked, 4)).toBe(2); // 行4 在 if 块内(3-5) → 最内层下标 2
    expect(guideIndexAt(picked, 3)).toBe(1); // 行3 是 if 的 { 行本身 → 不算 if 内层，归 run(2-6) 内 → 下标 1
    expect(guideIndexAt(picked, 1)).toBe(null); // 行1 是 class 的 { 行 → 不算任何中间行
    expect(guideIndexAt(picked, 7)).toBe(null); // 行7 是 } 行
    expect(guideIndexAt(picked, 9)).toBe(null); // 超出范围
  });
});
