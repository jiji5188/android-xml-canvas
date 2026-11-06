// M163：对齐方式（gravity / layout_gravity）完整组合 + 可输入
import { describe, expect, it } from "vitest";
import { ATTR_CATALOG, GRAVITY_OPTIONS } from "@/components/attr-catalog";
import { GRAVITY_LABELS } from "@/lib/xml/gravity";
import { OFFSET_ATTRS } from "@/lib/xml/drawable-schema";
import { parseGravity } from "@/components/DrawablePreview";

const spec = (n: string) => ATTR_CATALOG.find((a) => a.name === n)!;

describe("M163 gravity 完整组合", () => {
  it("四角中位都能选到（左中/右中/上中/下中）", () => {
    expect(GRAVITY_OPTIONS).toContain("center_vertical|left");
    expect(GRAVITY_OPTIONS).toContain("center_vertical|right");
    expect(GRAVITY_OPTIONS).toContain("top|center_horizontal");
    expect(GRAVITY_OPTIONS).toContain("bottom|center_horizontal");
    expect(GRAVITY_OPTIONS).toContain("center_vertical|start");
    expect(GRAVITY_OPTIONS).toContain("center_vertical|end");
  });

  it("四角组合齐全（3 纵向 × 5 横向，除 center 组合）", () => {
    const v = ["top", "center_vertical", "bottom"];
    const h = ["left", "start", "center_horizontal", "end", "right"];
    const want = v.flatMap((a) => h.map((b) => `${a}|${b}`)).filter((x) => x !== "center_vertical|center_horizontal");
    for (const w of want) expect(GRAVITY_OPTIONS).toContain(w);
  });

  it("两个属性都改成可编辑枚举", () => {
    expect(spec("gravity").editor).toBe("enum_input");
    expect(spec("layout_gravity").editor).toBe("enum_input");
    expect(spec("gravity").options).toBe(GRAVITY_OPTIONS);
  });

  it("无重复项", () => {
    expect(new Set(GRAVITY_OPTIONS).size).toBe(GRAVITY_OPTIONS.length);
  });
});

describe("M163 drawable item 的 android:gravity", () => {
  it("schema 里 item 的 gravity 也用了全组合", () => {
    const def = OFFSET_ATTRS.find((a) => a.name === "gravity")!;
    expect(def.type).toBe("enum");
    expect(def.values).toBe(GRAVITY_OPTIONS);
    expect(def.values).toContain("center_vertical|left");
    expect(def.values).toContain("top|center_horizontal");
  });

  it("组合值的中文标签", () => {
    expect(GRAVITY_LABELS["center_vertical|left"]).toBe("左中");
    expect(GRAVITY_LABELS["top|center_horizontal"]).toBe("上中");
    expect(GRAVITY_LABELS["bottom|center_horizontal"]).toBe("下中");
  });

  it("预览能解析组合值（左中 = 横 0 纵 0.5）", () => {
    expect(parseGravity("center_vertical|left")).toEqual({ hz: 0, vt: 0.5 });
    expect(parseGravity("center_vertical|right")).toEqual({ hz: 1, vt: 0.5 });
    expect(parseGravity("top|center_horizontal")).toEqual({ hz: 0.5, vt: 0 });
    expect(parseGravity("bottom|center_horizontal")).toEqual({ hz: 0.5, vt: 1 });
  });
});
