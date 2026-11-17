// M367：mergeProjectExtras 对旧缓存/缺字段的 ResourceExtras 要安全（vectorNames/sourceFiles/drawables/styles/counts 缺失不炸）
import { describe, it, expect } from "vitest";
import { mergeProjectExtras } from "@/lib/xml/project-res";

// 模拟「旧版本缓存」缺 vectorNames/sourceFiles/drawables 等字段的残缺 extras
const oldCached = {
  valuesXml: "<resources><string name=\"a\">A</string></resources>",
  ids: ["@+id/title"],
  counts: { images: 0, vectors: 0, values: 1, styles: 0, shapes: 0 },
} as any;

const full = {
  valuesXml: "<resources><string name=\"b\">B</string></resources>",
  drawables: { ic: "<vector/>" },
  drawableXml: {},
  layouts: {},
  ids: ["@+id/ok"],
  styles: {},
  vectorNames: ["ic"],
  sourceFiles: ["values/strings.xml"],
  counts: { images: 1, vectors: 1, values: 1, styles: 0, shapes: 0 },
  themeAttrs: {},
} as any;

describe("mergeProjectExtras（M367 缺字段安全）", () => {
  it("残缺 a（旧缓存）与完整 b 合并不抛 a is not iterable", () => {
    expect(() => mergeProjectExtras(oldCached, full)).not.toThrow();
    const r = mergeProjectExtras(oldCached, full)!;
    expect(r.vectorNames).toContain("ic");
    expect(r.ids).toEqual(expect.arrayContaining(["@+id/title", "@+id/ok"]));
    expect(r.sourceFiles).toContain("values/strings.xml");
  });
  it("两边都缺 vectorNames/sourceFiles 也不炸（counts 有 ?? 0 兜底）", () => {
    const a = { valuesXml: "", ids: [] } as any;
    const b = { valuesXml: "", ids: [] } as any;
    expect(() => mergeProjectExtras(a, b)).not.toThrow();
    const r = mergeProjectExtras(a, b)!;
    expect(r.vectorNames).toEqual([]);
    expect(r.sourceFiles).toEqual([]);
    expect(r.counts.vectors).toBe(0);
    expect(r.counts.shapes).toBe(0);
  });
  it("a=null / b=null 直接返回另一边（旧行为保持）", () => {
    expect(mergeProjectExtras(null, full)).toBe(full);
    expect(mergeProjectExtras(full, null)).toBe(full);
  });
});
