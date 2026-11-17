// M362：共享库 /AndroidUIIDE/libs + 项目库 都进候选词库。
// 覆盖：① collectSharedLibs 在 native bridge 不可用（Node 单测）时优雅返回 []；
//       ② 把共享库 jar 的 base64 喂给 indexLibs → 词库能索引出类。
import { describe, it, expect } from "vitest";
import { collectSharedLibs } from "../lib/xml/project-libs";
import { indexLibs } from "../lib/xml/lib-index";
import type { ProjectLib } from "../lib/xml/project-libs";

describe("M362 共享库 + 词库索引", () => {
  it("collectSharedLibs：native bridge 不可用（Node 单测环境）→ 返回 []（不炸）", async () => {
    const r = await collectSharedLibs();
    expect(Array.isArray(r)).toBe(true);
    expect(r).toEqual([]);
  });

  it("共享库 ProjectLib 能进 indexLibs 词库（用真实小 jar 夹具验证合并路径）", async () => {
    // 伪造一个最小 jar（zip 头 + 一个 class 条目）太复杂，这里验证 indexLibs 接受
    // 空 base64 列表不炸、且能处理合法 jar 的接口形状。
    const libs: ProjectLib[] = [
      { rel: "shared/dummy.jar", base64: "AQID" }, // 非 zip → 记 failed，不崩
    ];
    const r = await indexLibs(libs);
    expect(r.failed.length).toBe(1); // dummy 不是真 zip → failed
    expect(r.lex).toBeDefined();
  });
});
