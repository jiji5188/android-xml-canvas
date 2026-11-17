// test/xml_m352_sdk_lexicon.test.ts — M2：SDK 预消化索引 → 词库 + 合并规则
import { describe, expect, it, beforeEach } from "vitest";
import { sdkIndexToLexicon, mergeSdkLexicon, resetSdkLexiconCache, loadSdkLexicon, type SdkIndex } from "@/lib/xml/sdk-lexicon";
import { buildLexicon, createEmptyLexicon, type LexSourceFile } from "@/lib/xml/lexicon";
import fs from "node:fs";
import path from "node:path";

const FIXTURE: SdkIndex = {
  v: 1,
  gen: "2026-11-17",
  count: 2,
  classes: {
    TextView: {
      pkg: "android.widget",
      fqn: "android.widget.TextView",
      m: ["setText", "getText", "setTextSize", "setTextAppearance"],
      dm: ["setTextAppearance"],
    },
    View: {
      pkg: "android.view",
      fqn: "android.view.View",
      m: ["setVisibility", "setEnabled", "findViewById"],
    },
  },
};

describe("M352 M2 sdkIndexToLexicon", () => {
  it("类名/包名/方法/废弃标记都建对", () => {
    const lex = sdkIndexToLexicon(FIXTURE);
    expect(lex.classes.get("TextView")?.pkg).toBe("android.widget");
    expect(lex.classes.get("TextView")?.source).toBe("sdk");
    expect(lex.classesByFqn.get("android.view.View")?.name).toBe("View");
    const tv = lex.methods.get("TextView") || [];
    expect(tv.map((m) => m.name).sort()).toEqual(["getText", "setText", "setTextSize", "setTextAppearance"].sort());
    expect(tv.find((m) => m.name === "setTextAppearance")?.isDeprecated).toBe(true);
    expect(tv.find((m) => m.name === "setText")?.isDeprecated).toBeUndefined();
    expect(lex.deprecated.has("setTextAppearance")).toBe(true);
    // 同名方法跨类都进 allMethodNames
    expect(lex.allMethodNames.has("setVisibility")).toBe(true);
    expect(lex.allMethodNames.has("findViewById")).toBe(true);
  });

  it("类本身 @Deprecated 才标 isDeprecated", () => {
    const lex = sdkIndexToLexicon({
      v: 1, gen: "", count: 1,
      classes: { Old: { pkg: "x", fqn: "x.Old", d: 1, m: [] } },
    });
    expect(lex.classes.get("Old")?.isDeprecated).toBe(true);
    const lex2 = sdkIndexToLexicon({ v: 1, gen: "", count: 1, classes: { New: { pkg: "x", fqn: "x.New", m: ["a"] } } });
    expect(lex2.classes.get("New")?.isDeprecated).toBe(false);
  });
});

describe("M352 M2 mergeSdkLexicon", () => {
  const projFiles: LexSourceFile[] = [
    {
      rel: "app/src/main/java/com/demo/MainActivity.java",
      lang: "java",
      text: `package com.demo;
public class MainActivity extends Object {
  void doThing() {}
  // 故意建一个与 SDK 同名的类：项目优先
}`,
    },
    {
      rel: "app/src/main/java/com/demo/View.java",
      lang: "java",
      text: `package com.demo;
public class View { void myOwnMethod() {} }`,
    },
  ];

  it("项目同名类（View）不合并 SDK 方法，SDK 其它类照合", () => {
    const proj = buildLexicon(projFiles);
    const sdk = sdkIndexToLexicon(FIXTURE);
    const merged = mergeSdkLexicon(proj, sdk);
    // 项目的 View 保留自己方法，不掺 SDK 的 findViewById
    const viewMethods = (merged.methods.get("View") || []).map((m) => m.name);
    expect(viewMethods).toContain("myOwnMethod");
    expect(viewMethods).not.toContain("findViewById");
    // SDK 的 TextView 被合并进来
    const tv = (merged.methods.get("TextView") || []).map((m) => m.name);
    expect(tv).toContain("setText");
    expect(merged.classes.get("TextView")?.source).toBe("sdk");
    // 项目类仍在
    expect(merged.classes.get("MainActivity")?.source).toBe("project");
  });

  it("空项目 + SDK → 至少 SDK 方法可用（不再是 null 行为）", () => {
    const empty = createEmptyLexicon();
    const sdk = sdkIndexToLexicon(FIXTURE);
    const merged = mergeSdkLexicon(empty, sdk);
    expect(merged.allMethodNames.size).toBeGreaterThan(0);
    expect(merged.methods.get("TextView")?.length).toBeGreaterThan(0);
  });
});

describe("M352 M2 真实 SDK 索引（若存在）", () => {
  const idxPath = path.join(process.cwd(), "public", "sdk-api-index.json");
  it("真实索引结构可被降级解析（类数>3000，TextView 有 setText）", () => {
    if (!fs.existsSync(idxPath)) {
      // 索引是构建期产物，缺失时不让测试红
      expect(true).toBe(true);
      return;
    }
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8")) as SdkIndex;
    expect(idx.count).toBeGreaterThan(3000);
    const lex = sdkIndexToLexicon(idx);
    expect(lex.classes.get("TextView")?.pkg).toBe("android.widget");
    const tv = (lex.methods.get("TextView") || []).map((m) => m.name);
    expect(tv).toContain("setText");
    // setVisibility 在 View 上（TextView 继承，不自己声明）
    const view = (lex.methods.get("View") || []).map((m) => m.name);
    expect(view).toContain("setVisibility");
    // View 的废弃方法应被标出（给删除线候选）
    expect(lex.deprecated.size).toBeGreaterThan(0);
  });
});

describe("M352 M2 loadSdkLexicon（fetch 注入）", () => {
  beforeEach(() => resetSdkLexiconCache());

  it("fetch 返回索引 → 得到词库并缓存（第二次不再 fetch）", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return { ok: true, json: async () => FIXTURE } as unknown as Response;
    }) as unknown as typeof fetch;
    const a = await loadSdkLexicon(fakeFetch);
    expect(a?.classes.get("TextView")?.pkg).toBe("android.widget");
    const b = await loadSdkLexicon(fakeFetch);
    expect(b).toBe(a); // 缓存命中，同一个对象
    expect(calls).toBe(1);
  });

  it("fetch 失败 → 返回 null 且不抛", async () => {
    const badFetch = (async () => ({ ok: false, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;
    const r = await loadSdkLexicon(badFetch);
    expect(r).toBeNull();
  });
});
