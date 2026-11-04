// M123：drawable 预设
//
// 预设最容易出的问题是「生成出来的 XML 编辑器自己打不开」——所以这里对每个预设都跑
// parse → build → parse，确认能被解析、能原样写回、且不产生 error 级校验问题。

import { describe, expect, it } from "vitest";
import { DRAWABLE_PRESETS, presetById } from "@/lib/xml/drawable-presets";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { validateDrawable } from "@/lib/xml/drawable-schema";

describe("M123 drawable 预设", () => {
  it("每个预设都能被 parseDrawable 解析", () => {
    for (const p of DRAWABLE_PRESETS) {
      const doc = parseDrawable(p.xml);
      expect(doc, `${p.id} 解析失败`).toBeTruthy();
    }
  });

  it("每个预设都没有 error 级问题（warn 允许，比如兜底项顺序）", () => {
    for (const p of DRAWABLE_PRESETS) {
      const doc = parseDrawable(p.xml)!;
      const errors = validateDrawable(doc).filter((x) => x.level === "error");
      expect(errors, `${p.id} 有 error: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it("build(parse(xml)) 与原 XML 语义一致：再解析一次结构相同", () => {
    for (const p of DRAWABLE_PRESETS) {
      const once = parseDrawable(p.xml)!;
      const text = buildDrawable(once);
      const twice = parseDrawable(text)!;
      expect(twice, `${p.id} 往返后结构变了`).toEqual(once);
    }
  });

  it("build 出来的文本稳定：第二次 build 与第一次完全相同", () => {
    for (const p of DRAWABLE_PRESETS) {
      const a = buildDrawable(parseDrawable(p.xml)!);
      const b = buildDrawable(parseDrawable(a)!);
      expect(b, `${p.id} 输出不稳定`).toBe(a);
    }
  });

  it("预设覆盖了常见的四种容器", () => {
    const tags = DRAWABLE_PRESETS.map((p) => p.xml.match(/<([\w-]+)[\s>]/)?.[1]);
    expect(tags).toContain("shape");
    expect(tags).toContain("selector");
    expect(tags).toContain("ripple");
    expect(tags).toContain("layer-list");
  });

  it("id 唯一，且 presetById 能取回", () => {
    const ids = DRAWABLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(presetById(id)?.id).toBe(id);
    expect(presetById("nope")).toBeUndefined();
  });

  it("selector 预设的兜底项在最后（Android 的匹配规则是从上往下取第一个全匹配）", () => {
    for (const p of DRAWABLE_PRESETS) {
      const doc = parseDrawable(p.xml)!;
      if (doc.t !== "selector") continue;
      const last = doc.items[doc.items.length - 1];
      expect(Object.keys(last.states), `${p.id} 最后一项不该带 state_*`).toEqual([]);
    }
  });
});
