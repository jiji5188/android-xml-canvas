import { describe, expect, it, vi } from "vitest";
import { deltaOfJson, parseSse } from "@/lib/xml/ai-transport";
import {
  extractToolCalls,
  safeRel,
  stripToolBlocks,
  runTool,
  type AiFileIo,
} from "@/lib/xml/ai-tools";

describe("parseSse", () => {
  it("抠出增量正文，保留未闭合的尾巴", () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n' +
      'data: {"choices":[{"delta":{"cont';
    const r = parseSse(buf);
    expect(r.deltas).toEqual(["你", "好"]);
    expect(r.rest.startsWith("data: ")).toBe(true);
    expect(r.done).toBe(false);
  });

  it("[DONE] 标记结束，注释行忽略", () => {
    const buf = ': keep-alive\n\ndata: [DONE]\n';
    const r = parseSse(buf);
    expect(r.done).toBe(true);
    expect(r.deltas).toEqual([]);
  });

  it("兼容非流式整包 JSON 与 CRLF", () => {
    const r = parseSse('data: {"choices":[{"message":{"content":"整段"}}]}\r\n');
    expect(r.deltas).toEqual(["整段"]);
  });

  it("坏 JSON 不抛错", () => {
    const r = parseSse("data: {oops\n");
    expect(r.deltas).toEqual([]);
  });
});

describe("deltaOfJson", () => {
  it("content 是数组时拼接", () => {
    expect(deltaOfJson('{"choices":[{"delta":{"content":[{"text":"a"},"b"]}}]}')).toBe("ab");
  });
  it("无 choices 返回空串", () => {
    expect(deltaOfJson('{"error":"x"}')).toBe("");
  });
});

describe("extractToolCalls", () => {
  it("解析工具块，最多 2 个", () => {
    const reply = [
      "先看目录",
      '```axv-tool\n{"tool":"list_files","dir":"app/src/main"}\n```',
      '```axv-tool\n{"tool":"read_file","path":"app/src/main/AndroidManifest.xml"}\n```',
      '```axv-tool\n{"tool":"read_file","path":"x"}\n```',
    ].join("\n");
    const calls = extractToolCalls(reply);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ tool: "list_files", dir: "app/src/main", path: undefined, content: undefined, query: undefined });
    expect(calls[1].path).toBe("app/src/main/AndroidManifest.xml");
  });

  it("未知工具/坏 JSON 忽略", () => {
    expect(extractToolCalls('```axv-tool\n{"tool":"rm_rf"}\n```')).toEqual([]);
    expect(extractToolCalls("```axv-tool\nnot json\n```")).toEqual([]);
  });

  it("stripToolBlocks 去掉块，不留大段空行", () => {
    const reply = '前\n```axv-tool\n{"tool":"list_files"}\n```\n后';
    expect(stripToolBlocks(reply)).toBe("前\n\n后");
  });
});

describe("safeRel", () => {
  it("拒绝对路径与 ..", () => {
    expect(safeRel("/etc/passwd")).toBeNull();
    expect(safeRel("C:/Windows")).toBeNull();
    expect(safeRel("a/../../b")).toBeNull();
  });
  it("去掉 ./ 前缀", () => {
    expect(safeRel("./app/x.xml")).toBe("app/x.xml");
  });
});

function fakeIo(files: Record<string, string>): AiFileIo {
  const dirs = new Set<string>([""]);
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    rootLabel: () => "/root",
    async list(rel) {
      if (!dirs.has(rel)) return { ok: false, error: "不存在" };
      const prefix = rel ? rel + "/" : "";
      const seen = new Set<string>();
      const items = [];
      for (const p of [...Object.keys(files), ...dirs]) {
        if (!p.startsWith(prefix) || p === rel) continue;
        const rest = p.slice(prefix.length);
        const name = rest.split("/")[0];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        items.push({
          name,
          kind: dirs.has(prefix + name) ? ("dir" as const) : ("file" as const),
          rel: prefix + name,
        });
      }
      return { ok: true, items };
    },
    async read(rel) {
      const t = files[rel];
      if (t === undefined) return { ok: false, error: "没有这个文件" };
      return { ok: true, text: t };
    },
    async write(rel, text) {
      files[rel] = text;
      return { ok: true };
    },
  };
}

describe("runTool", () => {
  it("list_files 列出子项", async () => {
    const io = fakeIo({ "app/main.xml": "<a/>", "app/res/x.xml": "<b/>" });
    const out = await runTool({ tool: "list_files", dir: "app" }, io);
    expect(out).toContain("[目录] app/res");
    expect(out).toContain("app/main.xml");
  });

  it("read_file 带行数与正文", async () => {
    const io = fakeIo({ "a.xml": "<LinearLayout/>" });
    const out = await runTool({ tool: "read_file", path: "a.xml" }, io);
    expect(out).toContain("<LinearLayout/>");
    expect(out).toContain("文件 a.xml");
  });

  it("read_file 越界被拦", async () => {
    const io = fakeIo({ "a.xml": "x" });
    expect(await runTool({ tool: "read_file", path: "../secret" }, io)).toContain("路径非法");
  });

  it("write_file 真写进去", async () => {
    const files: Record<string, string> = { "a.xml": "old" };
    const io = fakeIo(files);
    const out = await runTool({ tool: "write_file", path: "a.xml", content: "new" }, io);
    expect(out).toContain("已写入");
    expect(files["a.xml"]).toBe("new");
  });

  it("write_file 缺 content 报错", async () => {
    const io = fakeIo({});
    expect(await runTool({ tool: "write_file", path: "a.xml" }, io)).toContain("缺 content");
  });

  it("search_files 命中文件名和内容", async () => {
    const io = fakeIo({ "res/colors.xml": "<color name=\"brand\"/>", "src/Main.java": "int brand = 1;" });
    const out = await runTool({ tool: "search_files", query: "brand" }, io);
    expect(out).toContain("[内容] res/colors.xml");
    expect(out).toContain("[内容] src/Main.java");
  });

  it("search_files 没命中给人话", async () => {
    const io = fakeIo({ "a.xml": "x" });
    expect(await runTool({ tool: "search_files", query: "zzz" }, io)).toContain("没找到");
  });
});

describe("streamChat 原生路径", () => {
  it("注册回调并累积 chunk", async () => {
    vi.resetModules();
    const w = globalThis as unknown as { window?: unknown };
    const fakeWin: Record<string, unknown> = {
      AxvNative: {
        aiChatStream: (id: string) => {
          // 模拟 Java 侧回调
          setTimeout(() => {
            (fakeWin.__axvAiChunk as (a: string, b: string) => void)(id, "你");
            (fakeWin.__axvAiChunk as (a: string, b: string) => void)(id, "好");
            (fakeWin.__axvAiDone as (a: string, b: number) => void)(id, 200);
          }, 0);
        },
        aiAbort: () => {},
      },
    };
    w.window = fakeWin;
    vi.stubGlobal("window", fakeWin);

    const { streamChat } = await import("@/lib/xml/ai-transport");
    const chunks: string[] = [];
    const res = await streamChat(
      {
        provider: "custom",
        baseUrl: "https://x.test/v1",
        model: "m",
        apiKey: "k",
        maxTokens: 128,
        temperature: 0.2,
        systemPrompt: "",
      } as never,
      [{ role: "user", content: "hi" }],
      { onChunk: (t) => chunks.push(t), timeoutMs: 1000 },
    );
    expect(res.ok).toBe(true);
    expect(res.via).toBe("native");
    expect(res.content).toBe("你好");
    expect(chunks).toEqual(["你", "好"]);

    delete w.window;
    vi.unstubAllGlobals();
  });
});
