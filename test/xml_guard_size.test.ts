// test/xml_guard_size.test.ts — M408 方案 0：主组件行数护栏
//
// 规矩（写进这里，别只记在脑子里）：
//   1. 阈值只许往下调，不许往上调。
//   2. 撞红 = 你在往主组件里塞新东西。二选一：
//      a) 把新功能拆成独立文件，主文件只留 ≤5 行挂载；
//      b) 先做「状态归位」把主文件瘦下来，再调低阈值。
//   3. 每瘦身成功一档，就把下面的数字改小一档。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function countLines(rel: string): number {
  return readFileSync(path.join(ROOT, rel), "utf8").split("\n").length;
}

// 当前水位（2026-11-19 M405b 时点）。
// 历史：早期峰值 6001 → M366 系列拆到 2559 → 之后平稳（2536~2583）。
const LIMITS: Record<string, number> = {
  "components/XmlEditor.tsx": 2650,
};

describe("M408 行数护栏：主组件不许再暴涨", () => {
  for (const [rel, limit] of Object.entries(LIMITS)) {
    it(`${rel} 必须 < ${limit} 行`, () => {
      const n = countLines(rel);
      expect(
        n,
        `${rel} 已 ${n} 行，超过护栏 ${limit} 行。\n` +
          `请把新功能拆成独立文件（主文件只留挂载），\n` +
          `或先做「状态归位」瘦身再调低阈值。\n` +
          `⚠️ 不许为了过测试直接调高 LIMITS。`,
      ).toBeLessThan(limit);
    });
  }
});
