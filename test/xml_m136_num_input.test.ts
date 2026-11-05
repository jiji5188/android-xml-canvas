// test/xml_m136_num_input.test.ts — 数字输入框过滤/判空（M136）
import { describe, expect, it } from "vitest";
import { filterNumber, parseNumberField } from "../lib/xml/num-input";

describe("M136 filterNumber", () => {
  it("只留数字和小数点", () => {
    expect(filterNumber("1a2b")).toBe("12");
    expect(filterNumber("12dp")).toBe("12");
    expect(filterNumber("a1b.2c.3")).toBe("1.23");
    expect(filterNumber(".5")).toBe(".5");
  });

  it("负号只允许出现在开头", () => {
    expect(filterNumber("-12")).toBe("-12");
    expect(filterNumber("1-2")).toBe("12");
    expect(filterNumber("-12", false)).toBe("12");
  });

  it("删空就是空串（不是 0，让调用方决定兜底）", () => {
    expect(filterNumber("")).toBe("");
    expect(filterNumber("-")).toBe("-");
    expect(filterNumber("abc")).toBe("");
  });
});

describe("M136 parseNumberField", () => {
  it("空串走 fallback —— 偏移按 0，宽高按不设", () => {
    expect(parseNumberField("", 0)).toBe(0);
    expect(parseNumberField("", undefined)).toBe(undefined);
    expect(parseNumberField("-", 0)).toBe(0);
    expect(parseNumberField(".", undefined)).toBe(undefined);
  });

  it("正常值原样解析，脏值被过滤后解析", () => {
    expect(parseNumberField("12", 0)).toBe(12);
    expect(parseNumberField("-3.5", 0)).toBe(-3.5);
    expect(parseNumberField("1a2", 0)).toBe(12);
  });

  it("min/max 夹住（不透明度 0~1）", () => {
    expect(parseNumberField("5", undefined, { min: 0, max: 1 })).toBe(1);
    expect(parseNumberField("-2", undefined, { min: 0, max: 1 })).toBe(0);
    expect(parseNumberField("0.35", undefined, { min: 0, max: 1 })).toBe(0.35);
  });
});
