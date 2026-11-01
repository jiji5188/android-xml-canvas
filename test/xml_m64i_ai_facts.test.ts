// test/xml_m64i_ai_facts.test.ts — M64i（A6）：项目事实注入
import { describe, expect, it } from "vitest";
import { FACTS_BUDGET, WIDGET_WHITELIST, collectProjectFacts, formatProjectFacts } from "@/lib/xml/ai-facts";
import type { AiFileIo } from "@/lib/xml/ai-tools";

interface Tree {
  [rel: string]: string[] | string;
}

function treeIo(tree: Tree, opts: { canWrite?: boolean } = {}): AiFileIo & { ops: string[] } {
  const ops: string[] = [];
  return {
    ops,
    rootLabel: () => "/proj/MyApp",
    canWrite: opts.canWrite ?? true,
    list: async (rel) => {
      ops.push(`list ${rel}`);
      const v = tree[rel];
      if (!Array.isArray(v)) return { ok: false, error: "不是目录" };
      return {
        ok: true,
        items: v.map((name) => ({
          name,
          kind: name.includes(".") ? ("file" as const) : ("dir" as const),
          rel: rel ? `${rel}/${name}` : name,
        })),
      };
    },
    read: async (rel) => {
      ops.push(`read ${rel}`);
      const v = tree[rel];
      return typeof v === "string" ? { ok: true, text: v } : { ok: false, error: "不是文件" };
    },
    write: async () => ({ ok: true }),
  };
}

const BASE: Tree = {
  "app/src/main/res": ["drawable", "values", "layout"],
  "app/src/main/res/drawable": ["bg_card.xml", "ic_add.xml", "logo.9.png", "notes.txt"],
  "app/src/main/res/values": ["strings.xml", "colors.xml"],
  "app/src/main/res/layout": ["activity_main.xml"],
  "app/src/main/res/values/strings.xml":
    '<resources><string name="app_name">MyApp</string><string name="btn_ok">OK</string></resources>',
  "app/src/main/res/values/colors.xml":
    '<resources><color name="colorPrimary">#6200EE</color><color name="black">#000</color><dimen name="gap">8dp</dimen></resources>',
  "app/build.gradle": "dependencies { implementation 'androidx.appcompat:appcompat:1.6.1' }",
};

describe("M64i collectProjectFacts", () => {
  it("按 docRel 找到 res，收齐 drawable / color / string / dimen", async () => {
    const io = treeIo(BASE);
    const f = await collectProjectFacts(io, "app/src/main/res/layout/activity_main.xml");
    expect(f.resRel).toBe("app/src/main/res");
    expect(f.drawables.sort()).toEqual(["bg_card", "ic_add", "logo"]);
    expect(f.colors).toEqual(["colorPrimary", "black"]);
    expect(f.strings).toEqual(["app_name", "btn_ok"]);
    expect(f.dimens).toEqual(["gap"]);
    expect(f.lib).toBe("androidx");
    expect(f.truncated).toBe(false);
  });

  it("docRel 推不出 res 时按约定回退", async () => {
    const io = treeIo(BASE);
    const f = await collectProjectFacts(io, "MainActivity.java");
    expect(f.resRel).toBe("app/src/main/res");
  });

  it("预算上限：最多 40 次操作，超了标 truncated", async () => {
    const dirs = Array.from({ length: 60 }, (_, i) => `drawable${i}`);
    const tree: Tree = { res: dirs, "app/build.gradle": "" };
    for (const d of dirs) tree[`res/${d}`] = [`a${d}.xml`];
    const io = treeIo(tree);
    const f = await collectProjectFacts(io, null);
    expect(io.ops.length).toBeLessThanOrEqual(FACTS_BUDGET.maxOps);
    expect(f.truncated).toBe(true);
  });

  it("没有 io：返回空事实，不报错", async () => {
    const f = await collectProjectFacts(null);
    expect(f.rootLabel).toBe("");
    expect(f.drawables).toEqual([]);
  });

  it("support 库会被识别（不要混用 androidx）", async () => {
    const io = treeIo({ ...BASE, "app/build.gradle": "implementation 'com.android.support:appcompat-v7:28.0.0'" });
    const f = await collectProjectFacts(io, "app/src/main/res/layout/a.xml");
    expect(f.lib).toBe("support");
  });
});

describe("M64i formatProjectFacts", () => {
  it("列出真实名单，并强调「没列出的就当不存在」", async () => {
    const f = await collectProjectFacts(treeIo(BASE), "app/src/main/res/layout/a.xml");
    const txt = formatProjectFacts(f);
    expect(txt).toContain("项目事实");
    expect(txt).toContain("@drawable / @mipmap：bg_card, ic_add, logo");
    expect(txt).toContain("@color：colorPrimary, black");
    expect(txt).toContain("没列出的就当不存在");
    expect(txt).toContain("androidx");
    expect(txt).toContain(WIDGET_WHITELIST[0]);
  });

  it("拿不到 res：明确禁止引用 @ 资源", () => {
    const txt = formatProjectFacts({
      rootLabel: "/p",
      resRel: "",
      resDirs: [],
      drawables: [],
      colors: [],
      strings: [],
      dimens: [],
      lib: "unknown",
      ops: 0,
      truncated: false,
    });
    expect(txt).toContain("禁止");
    expect(txt).toContain("@drawable");
  });

  it("某个名单为空时写「一个都没有（不要引用）」", async () => {
    const tree: Tree = { "res": ["drawable"], "res/drawable": ["a.xml"], "res/drawable/a.xml": "" };
    const f = await collectProjectFacts(treeIo(tree));
    const txt = formatProjectFacts(f);
    expect(txt).toContain("@color：**一个都没有**");
  });

  it("没有项目根 → 返回空串（不往 prompt 里塞空壳）", () => {
    expect(formatProjectFacts({
      rootLabel: "",
      resRel: "",
      resDirs: [],
      drawables: [],
      colors: [],
      strings: [],
      dimens: [],
      lib: "unknown",
      ops: 0,
      truncated: false,
    })).toBe("");
  });
});
