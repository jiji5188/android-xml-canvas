// test/xml_sample_projects.test.ts
// 示例项目自检：能解析、能渲染、引用的每个 @drawable/@color/@string 都有定义。
// 价值：以后加示例或改渲染引擎，能立刻发现「示例变红了 / 丢图了」。

import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES, mergeResourceFragment } from "../lib/xml/resources";
import {
  SAMPLE_PROJECTS,
  SAMPLE_BLANKS,
  sampleProjectByKey,
  allSampleDrawables,
} from "../lib/xml/sample-projects";

function resFor(values?: string) {
  return values ? mergeResourceFragment(values) : DEFAULT_RESOURCES;
}

function drawableRefs(xml: string): string[] {
  const out = new Set<string>();
  const re = /@(drawable|mipmap)\/([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.add(m[2]);
  return [...out];
}

describe("示例项目", () => {
  it("至少 4 个完整示例，key 唯一", () => {
    expect(SAMPLE_PROJECTS.length).toBeGreaterThanOrEqual(4);
    const keys = SAMPLE_PROJECTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const p of SAMPLE_PROJECTS) {
    describe(p.name + "（" + p.library + "）", () => {
      it("布局能解析且根节点唯一", () => {
        const { root, issues } = parseLayoutXml(p.layout);
        expect(root).toBeTruthy();
        expect(root!.tag.length).toBeGreaterThan(0);
        expect(issues.filter((i) => i.level === "error")).toEqual([]);
      });

      it("引用的 drawable 全部自带", () => {
        const missing = drawableRefs(p.layout).filter((n) => !p.drawables[n]);
        expect(missing).toEqual([]);
      });

      it("渲染无 error 级问题", () => {
        const { root } = parseLayoutXml(p.layout);
        const model = buildRenderModel(root!, resFor(p.values), 2, {}, { w: 412, h: 892 });
        const errors = model.issues.filter((i) => i.level === "error");
        expect(errors.map((e) => e.nodePath + ": " + e.message)).toEqual([]);
      });

      it("自带的 drawable 都是合法 XML", () => {
        for (const [name, xml] of Object.entries(p.drawables)) {
          expect(xml, name).toContain("<");
          expect(parseLayoutXml(xml).root, name).toBeTruthy();
        }
      });
    });
  }

  it("空白模板能解析", () => {
    for (const b of SAMPLE_BLANKS) {
      expect(parseLayoutXml(b.layout).root, b.name).toBeTruthy();
    }
  });

  it("sampleProjectByKey 命中 / 未命中", () => {
    expect(sampleProjectByKey("login")?.name).toBe("登录页");
    expect(sampleProjectByKey("nope")).toBeUndefined();
  });

  it("allSampleDrawables 汇总所有项目的资源", () => {
    const all = allSampleDrawables();
    expect(all.ic_lock).toBeTruthy();
    expect(all.bg_card).toBeTruthy();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(15);
  });

  it("各项目用了不同的布局技术（不是同一模板复制）", () => {
    const roots = SAMPLE_PROJECTS.map((p) => {
      const m = p.layout.match(/<([A-Za-z.]+)[\s>]/);
      return m ? m[1] : "";
    });
    // 布局根的容器各不相同（目前：CL / 3 个 LinearLayout 但内部结构各异）
    expect(new Set(roots).size).toBeGreaterThanOrEqual(2);
    const libs = SAMPLE_PROJECTS.map((p) => p.library);
    expect(new Set(libs).size).toBe(SAMPLE_PROJECTS.length);
  });
});
