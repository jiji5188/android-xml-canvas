// test/xml_m207_diag_hints.test.ts — M207：问题卡片「为什么/怎么改」提示 + 防误报分级
import { describe, it, expect } from "vitest";
import { codeHint } from "@/lib/xml/diag-hints";

describe("M207 codeHint", () => {
  it("method 提示带判定逻辑 + 怎么改", () => {
    const h = codeHint(
      "method",
      "没有 hash() 这个方法,是不是想写 has()?",
    );
    expect(h).toBeTruthy();
    expect(h!.why).toMatch(/白名单/);
    expect(h!.how).toMatch(/改成/);
    expect(h!.fix).toEqual({ from: "hash", to: "has" });
  });

  it("case 提示带大小写规则说明", () => {
    const h = codeHint("case", "大小写写错了：settext → setText（方法名应为驼峰）");
    expect(h).toBeTruthy();
    expect(h!.why).toMatch(/区分大小写/);
    expect(h!.fix).toEqual({ from: "settext", to: "setText" });
  });

  it("assign 提示解释类型不兼容", () => {
    const h = codeHint(
      "assign",
      "左边声明为 int，右边是 \"abc\"（String），类型不匹配",
    );
    expect(h).toBeTruthy();
    expect(h!.why).toMatch(/incompatible types/);
    expect(h!.fix).toBeUndefined();
  });

  it("sym 提示说明置信度（拼错=错误，孤例=注意）", () => {
    const h = codeHint("sym", "用了 qqqzzz 但本类没声明（打错字？还是忘声明？）");
    expect(h).toBeTruthy();
    expect(h!.why).toMatch(/盲区/);
    expect(h!.how).toMatch(/误判/);
  });

  it("brace / quote / import / rid / override / dup 都有提示", () => {
    for (const c of ["brace", "quote", "import", "rid", "override", "dup"]) {
      const h = codeHint(c, "msg");
      expect(h, c).toBeTruthy();
      expect(h!.why.length).toBeGreaterThan(0);
      expect(h!.how.length).toBeGreaterThan(0);
    }
  });

  it("未知 code 返回 null（不瞎说）", () => {
    expect(codeHint(undefined, "msg")).toBeNull();
    expect(codeHint("nonexistentcode", "msg")).toBeNull();
  });

  it("msg 不匹配模式时返回 null（不瞎说）", () => {
    // method 但 msg 里没有「没有 X()」模式
    expect(codeHint("method", "随便什么")).toBeNull();
  });
});
