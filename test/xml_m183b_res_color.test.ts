import { describe, expect, it } from "vitest";
import { androidColorToCss, resolveColorCss, valuePreview } from "@/lib/xml/resource-panel";

describe("androidColorToCss", () => {
  it("#RRGGBB 原样小写", () => {
    expect(androidColorToCss("#0B5FA5")).toBe("#0b5fa5");
  });
  it("#AARRGGBB 换算成 rgba（Android 透明度在前）", () => {
    // 0B = alpha 11/255 ≈ 0.043；5F A5 FF = 95, 165, 255
    expect(androidColorToCss("#0B5FA5FF")).toBe("rgba(95, 165, 255, 0.043)");
  });
  it("全不透明时输出 rgb()", () => {
    expect(androidColorToCss("#FF6200EE")).toBe("rgb(98, 0, 238)");
  });
  it("#RGB 与 #ARGB 展开", () => {
    expect(androidColorToCss("#0af")).toBe("#00aaff");
    expect(androidColorToCss("#80f0")).toBe("rgba(0, 255, 0, 0.533)");
  });
  it("不是颜色返回 null", () => {
    expect(androidColorToCss("16dp")).toBeNull();
    expect(androidColorToCss("@color/primary")).toBeNull();
  });
});

describe("resolveColorCss", () => {
  const map = new Map([
    ["primary", "#6200EE"],
    ["primary_dark", "@color/primary"],
    ["alias", "@color/primary_dark"],
    ["loop_a", "@color/loop_b"],
    ["loop_b", "@color/loop_a"],
  ]);

  it("字面量直接换算", () => {
    expect(resolveColorCss("#6200EE")).toBe("#6200ee");
  });
  it("@color/xxx 顺引用解析", () => {
    expect(resolveColorCss("@color/primary", map)).toBe("#6200ee");
  });
  it("多级引用", () => {
    expect(resolveColorCss("@color/alias", map)).toBe("#6200ee");
  });
  it("环形引用不死循环", () => {
    expect(resolveColorCss("@color/loop_a", map)).toBeNull();
  });
  it("@android:color/white 给近似值", () => {
    expect(resolveColorCss("@android:color/white")).toBe("#ffffff");
    expect(resolveColorCss("@android:color/transparent")).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("valuePreview", () => {
  it("6 位颜色带真实色块", () => {
    expect(valuePreview("#0B5FA5")).toEqual({ text: "#0B5FA5", color: "#0b5fa5" });
  });
  it("8 位 ARGB 给 rgba（不是原样塞给 CSS）", () => {
    expect(valuePreview("#FF0B5FA5").color).toBe("rgb(11, 95, 165)");
  });
  it("长文本截断", () => {
    expect(valuePreview("a".repeat(50)).text.endsWith("…")).toBe(true);
  });
});
