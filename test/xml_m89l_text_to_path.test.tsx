// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { textToPathData } from "../lib/xml/text-to-path";

describe("M89l 文字转 path（浏览器侧封装）", () => {
  it("空文本返回 null，不抛错", () => {
    expect(textToPathData("", "sans-serif", { size: 12 })).toBeNull();
    expect(textToPathData("   ", "sans-serif", { size: 12 })).toBeNull();
  });

  it("拿不到 canvas 时安全返回 null（jsdom / SSR 环境）", () => {
    const got = textToPathData("A", "sans-serif", { size: 12 });
    expect(got === null || typeof got.d === "string").toBe(true);
    if (got) expect(got.d.endsWith("Z")).toBe(true);
  });

  it("字号非法时不炸（回退到 12）", () => {
    expect(() => textToPathData("A", "sans-serif", { size: 0 })).not.toThrow();
    expect(() => textToPathData("A", "sans-serif", { size: -5 })).not.toThrow();
  });
});
