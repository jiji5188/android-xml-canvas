// M49：ARGB 颜色工具（解析 / 格式化 / alpha）
import { describe, it, expect } from "vitest";
import {
  parseColor,
  parseColorOr,
  toArgbHex,
  toCssColor,
  toRgbHex,
  withAlpha,
} from "@/lib/xml/color-argb";

describe("M49 parseColor", () => {
  it("#rrggbb → 不透明", () => {
    expect(parseColor("#3FBFA0")).toEqual({ r: 63, g: 191, b: 160, a: 1 });
  });

  it("#rgb 展开", () => {
    expect(parseColor("#f0a")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  it("8 位按 Android ARGB 解释（#AARRGGBB）", () => {
    expect(parseColor("#80FF0000")).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
  });

  it("4 位按 CSS #RGBA 解释", () => {
    const c = parseColor("#0f08")!;
    expect(c.r).toBe(0);
    expect(c.g).toBe(255);
    expect(c.b).toBe(0);
    expect(Math.round(c.a * 255)).toBe(0x88);
  });

  it("rgba() 保留 alpha", () => {
    expect(parseColor("rgba(4, 64, 159, 0.18)")).toEqual({ r: 4, g: 64, b: 159, a: 0.18 });
    expect(parseColor("rgb(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it("transparent / 非法输入", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("not-a-color")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor(null)).toBeNull();
  });

  it("parseColorOr 用 fallback 兜底", () => {
    expect(parseColorOr("bogus", "#00FF00")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColorOr("bogus")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe("M49 格式化", () => {
  const halfRed = { r: 255, g: 0, b: 0, a: 0.5 };

  it("toArgbHex 输出 #AARRGGBB 且大写", () => {
    expect(toArgbHex(halfRed)).toBe("#80FF0000");
    expect(toArgbHex({ r: 63, g: 191, b: 160, a: 1 })).toBe("#FF3FBFA0");
  });

  it("toRgbHex 丢掉 alpha（喂原生取色器）", () => {
    expect(toRgbHex(halfRed)).toBe("#ff0000");
  });

  it("toCssColor 不透明走 hex，半透明走 rgba()", () => {
    expect(toCssColor({ r: 255, g: 0, b: 0, a: 1 })).toBe("#ff0000");
    expect(toCssColor(halfRed)).toBe("rgba(255, 0, 0, 0.5)");
    expect(toCssColor({ r: 1, g: 2, b: 3, a: 0.184 })).toBe("rgba(1, 2, 3, 0.18)");
  });

  it("withAlpha 只改透明度且钳位", () => {
    expect(withAlpha(halfRed, 2).a).toBe(1);
    expect(withAlpha(halfRed, -1).a).toBe(0);
    expect(withAlpha(halfRed, 0.25)).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });
  });

  it("往返：ARGB → 解析 → ARGB 稳定", () => {
    for (const hex of ["#FF3FBFA0", "#80FF0000", "#00000000", "#CC112233"]) {
      expect(toArgbHex(parseColor(hex)!)).toBe(hex);
    }
  });

  it("编辑器默认色都能被解析（不会把 rgba 吞掉）", () => {
    expect(parseColor("rgba(11, 95, 165, 0.08)")).toEqual({ r: 11, g: 95, b: 165, a: 0.08 });
    expect(parseColor("#24292F")).toEqual({ r: 36, g: 41, b: 47, a: 1 });
  });
});
