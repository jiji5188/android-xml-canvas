// M53：单个颜色值的 Android(ARGB) → CSS(RGBA) 适配
// 背景：Android 写死的 8 位 hex 是 #AARRGGBB，浏览器按 #RRGGBBAA 解释 —— 不转就一定错色。
import { describe, it, expect } from "vitest";
import { androidColorToCss } from "@/lib/xml/color-argb";
import { resolveColor } from "@/lib/xml/resolve";
import { vectorToSvg } from "@/lib/xml/vector-svg";
import { specToCss, argbColorsForPreview, type ShapeSpec } from "@/lib/xml/shape-gen";
import type { ResourceTable } from "@/lib/xml/types";

const emptyRes: ResourceTable = {
  strings: {},
  dimens: {},
  colors: {},
} as unknown as ResourceTable;

describe("M53 androidColorToCss：单个颜色值转换", () => {
  it("8 位不透明（#FF212121）→ 6 位 #212121", () => {
    expect(androidColorToCss("#FF212121")).toBe("#212121");
    expect(androidColorToCss("#ff212121")).toBe("#212121");
  });

  it("8 位带 alpha（#80FF0000）→ rgba，alpha 用前两位", () => {
    // 0x80 = 128 → 128/255 ≈ 0.5
    expect(androidColorToCss("#80FF0000")).toBe("rgba(255, 0, 0, 0.5)");
    // 如果是按 CSS 的 RRGGBBAA 解释会变成 #80FF00 + alpha 00（全透明）——这里必须不是
    expect(androidColorToCss("#80FF0000")).not.toBe("transparent");
  });

  it("alpha=00 → transparent", () => {
    expect(androidColorToCss("#00123456")).toBe("transparent");
  });

  it("8 位全 F alpha 但颜色全黑（#FF000000）→ #000000，不丢成透明", () => {
    expect(androidColorToCss("#FF000000")).toBe("#000000");
  });

  it("4 位按 Android 的 #ARGB 解释（不是 CSS 的 #RGBA）", () => {
    // #8F00 = alpha 0x88(≈0.53) + #FF0000 → 红
    expect(androidColorToCss("#8F00")).toMatch(/^rgba\(255, 0, 0, 0\.5/);
  });

  it("3 位 #RGB 展开成 6 位", () => {
    expect(androidColorToCss("#f00")).toBe("#ff0000");
  });

  it("8 位字母大小写保持原样（不改写用户写法）", () => {
    expect(androidColorToCss("#FF00C853")).toBe("#00C853");
  });

  it("6 位 / 非 hex 值原样返回（@color/x、?attr/x、命名色）", () => {
    expect(androidColorToCss("#FF0000")).toBe("#FF0000");    expect(androidColorToCss("@color/primary")).toBe("@color/primary");
    expect(androidColorToCss("?attr/colorPrimary")).toBe("?attr/colorPrimary");
    expect(androidColorToCss("transparent")).toBe("transparent");
  });
});

describe("M53 画布解析：resolveColor 走同一套转换", () => {
  it("textColor=#80FF0000 → rgba", () => {
    expect(resolveColor("#80FF0000", emptyRes, [], "n", "textColor")).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("@color/x 里存的 #AARRGGBB 也转", () => {
    const res = { ...emptyRes, colors: { half: "#8000FF00" } } as unknown as ResourceTable;
    expect(resolveColor("@color/half", res, [], "n", "background")).toBe("rgba(0, 255, 0, 0.5)");
  });
});

describe("M53 vector drawable 的 fillColor 也要转", () => {
  const vec = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0h24v24h-24z" android:fillColor="#800000FF"/>
    </vector>`;

  it("SVG fill 不是原始 8 位 hex", () => {
    const svg = vectorToSvg(vec);
    expect(svg).toBeTruthy();
    expect(svg).not.toContain("#800000FF");
    expect(svg).toContain("rgba(0, 0, 255, 0.5)");
  });
});

describe("M53 形状预览（specToCss）也要转", () => {
  const spec: ShapeSpec = {
    kind: "rectangle",
    solid: "#80FF0000",
    stroke: { width: 2, color: "#FF00FF00" },
  };

  it("solid 带 alpha → rgba；stroke 不透明 → 6 位", () => {
    const css = specToCss(argbColorsForPreview(spec));
    expect(css.background).toBe("rgba(255, 0, 0, 0.5)");
    expect((css.border ?? "").toLowerCase()).toContain("#00ff00");
  });

  it("不过转换就一定错（对照：直接传给 specToCss 会炸出 #80FF0000）", () => {
    const raw = specToCss(spec);
    expect(raw.background).toBe("#80FF0000");
    expect(argbColorsForPreview(spec).solid).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("梯度 stops 也逐值转换", () => {
    const g: ShapeSpec = {
      kind: "rectangle",
      gradient: { type: "linear", start: "#80000000", end: "#FF0000FF" },
    };
    const css = specToCss(argbColorsForPreview(g));
    expect(css.background).toContain("rgba(0, 0, 0, 0.5)");
    expect((css.background ?? "").toLowerCase()).toContain("#0000ff");
  });
});
