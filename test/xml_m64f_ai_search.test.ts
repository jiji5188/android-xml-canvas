// test/xml_m64f_ai_search.test.ts — M64f（B5）：search_files 预算 / 跳过产物目录 / 只匹配前 4KB
import { describe, expect, it } from "vitest";
import { SEARCH_BUDGET, formatSearchResult, searchProject } from "@/lib/xml/ai-search";
import { runTool, type AiFileIo } from "@/lib/xml/ai-tools";

/** 造一棵「宽 200 × 深 5」的假树，每层 200 个 xml */
function wideTree(): AiFileIo & { visits: () => number } {
  let visits = 0;
  const kids = (rel: string) => {
    const depth = rel ? rel.split("/").length : 0;
    const items = [] as { name: string; kind: "file" | "dir"; rel: string }[];
    for (let i = 0; i < 200; i++) items.push({ name: `f${i}.xml`, kind: "file", rel: rel ? `${rel}/f${i}.xml` : `f${i}.xml` });
    if (depth < 5) items.push({ name: `d${depth}`, kind: "dir", rel: rel ? `${rel}/d${depth}` : `d${depth}` });
    return items;
  };
  return {
    rootLabel: () => "/proj",
    canWrite: false,
    visits: () => visits,
    async list(rel) {
      visits++;
      return { ok: true, items: kids(rel) };
    },
    async read() {
      visits++;
      return { ok: true, text: "nothing here" };
    },
    async write() {
      return { ok: false, error: "readonly" };
    },
  };
}

describe("M64f searchProject 预算", () => {
  it("访次有上限，超了标 truncated（不会扫完整棵树）", async () => {
    const io = wideTree();
    const r = await searchProject(io, "zzz");
    expect(r.hits).toEqual([]);
    expect(r.visits).toBeLessThanOrEqual(SEARCH_BUDGET.maxVisits + 1);
    expect(r.truncated).toBe(true);
  });

  it("命中数封顶 40", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) files[`res/values/s${i}.xml`] = "<resources/>";
    const io: AiFileIo = {
      rootLabel: () => "/p",
      list: async (rel) => ({
        ok: true,
        items: Object.keys(files)
          .filter((f) => (rel ? f.startsWith(rel + "/") : true))
          .map((f) => ({ name: f.split("/").pop() as string, kind: "file" as const, rel: f })),
      }),
      read: async () => ({ ok: true, text: "" }),
      write: async () => ({ ok: true }),
    };
    const r = await searchProject(io, ".xml");
    expect(r.hits.length).toBe(SEARCH_BUDGET.maxHits);
    expect(r.truncated).toBe(true);
  });

  it("跳过 build/.gradle/node_modules 等产物目录", async () => {
    let listed: string[] = [];
    const io: AiFileIo = {
      rootLabel: () => "/p",
      list: async (rel) => {
        listed.push(rel);
        if (!rel)
          return {
            ok: true,
            items: [
              { name: "build", kind: "dir", rel: "build" },
              { name: ".git", kind: "dir", rel: ".git" },
              { name: "app", kind: "dir", rel: "app" },
            ],
          };
        return { ok: true, items: [] };
      },
      read: async () => ({ ok: true, text: "" }),
      write: async () => ({ ok: true }),
    };
    await searchProject(io, "x");
    expect(listed).toEqual(["", "app"]);
  });

  it("只匹配前 4KB：命中在 5KB 处不算", async () => {
    const head = "a".repeat(4500);
    const io: AiFileIo = {
      rootLabel: () => "/p",
      list: async (rel) =>
        rel
          ? { ok: true, items: [] }
          : { ok: true, items: [{ name: "big.xml", kind: "file", rel: "big.xml" }] },
      read: async () => ({ ok: true, text: head + "NEEDLE" }),
      write: async () => ({ ok: true }),
    };
    const r = await searchProject(io, "needle");
    expect(r.hits).toEqual([]);
  });

  it("文件名/内容/目录三种命中都能标出来", async () => {
    const files: Record<string, string> = { "login.xml": "<x/>", "res/values/strings.xml": "<string>login</string>" };
    const io: AiFileIo = {
      rootLabel: () => "/p",
      list: async (rel) => {
        if (!rel)
          return {
            ok: true,
            items: [
              { name: "login.xml", kind: "file", rel: "login.xml" },
              { name: "res", kind: "dir", rel: "res" },
            ],
          };
        return { ok: true, items: [{ name: "strings.xml", kind: "file", rel: "res/values/strings.xml" }] };
      },
      read: async (rel) => ({ ok: true, text: files[rel] ?? "" }),
      write: async () => ({ ok: true }),
    };
    const r = await searchProject(io, "login");
    expect(r.hits.map((h) => h.kind).sort()).toEqual(["content", "file"]);
  });

  it("没命中时给出去向提示（带扫了多少处）", () => {
    const txt = formatSearchResult({ hits: [], visits: 12, truncated: false }, "abc");
    expect(txt).toContain("没找到");
    expect(txt).toContain("12");
  });

  it("runTool search_files 走新实现（含预算说明）", async () => {
    const io = wideTree();
    const out = await runTool({ tool: "search_files", query: "zzz" }, io);
    expect(out).toContain("没找到");
    expect(io.visits()).toBeLessThanOrEqual(SEARCH_BUDGET.maxVisits + 2);
  });
});
