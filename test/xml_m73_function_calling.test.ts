// test/xml_m73_function_calling.test.ts — M73（D1）：原生 function calling
//
// 以前工具调用靠模型在正文里手写 {"tool":…,"args":{…}}，少个引号就得重问一轮。
// 现在走 OpenAI tools 协议：请求带 tools，模型回结构化 tool_calls，执行后按 role:"tool" 回喂。
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG } from "@/lib/xml/ai";
import { AI_TOOL_NAMES } from "@/lib/xml/ai-tools";
import {
  AI_TOOL_SPECS,
  finishToolCalls,
  looksLikeToolsRejected,
  mergeToolCalls,
  supportsNativeTools,
  toAiToolCall,
  toHistoryToolCalls,
} from "@/lib/xml/ai-fc";
import { buildRequestBody } from "@/lib/xml/ai";
import { parseSse, streamChat } from "@/lib/xml/ai-transport";

const acc = () => new Map<number, { id?: string; name?: string; args: string }>();

describe("M73 tools 定义", () => {
  it("八个工具全覆盖，名字与 AI_TOOL_NAMES 一致", () => {
    const names = AI_TOOL_SPECS.map((t) => t.function.name).sort();
    expect(names).toEqual([...AI_TOOL_NAMES].sort());
    expect(names.length).toBe(8);
  });

  it("每个工具都是 type=function，parameters 是 object schema", () => {
    for (const t of AI_TOOL_SPECS) {
      expect(t.type).toBe("function");
      expect(t.function.description.length).toBeGreaterThan(8);
      const p = t.function.parameters as { type?: string; properties?: Record<string, unknown> };
      expect(p.type).toBe("object");
      expect(Object.keys(p.properties || {}).length).toBeGreaterThan(0);
    }
  });

  it("必填项合理：read_file 要 path，apply_patch 要 path+edits，list_files 全可选", () => {
    const by = (n: string) => AI_TOOL_SPECS.find((t) => t.function.name === n)!;
    expect((by("read_file").function.parameters as { required?: string[] }).required).toEqual(["path"]);
    expect((by("apply_patch").function.parameters as { required?: string[] }).required).toEqual(["path", "edits"]);
    expect((by("list_files").function.parameters as { required?: string[] }).required).toBeUndefined();
  });

  it("开关能关掉原生 tools", () => {
    expect(supportsNativeTools(DEFAULT_AI_CONFIG)).toBe(true);
    expect(supportsNativeTools({ ...DEFAULT_AI_CONFIG, nativeTools: false })).toBe(false);
  });
});

describe("M73 请求体", () => {
  it("带 tools 时补 tool_choice=auto 且关掉并行调用（保持一轮一串行）", () => {
    const body = buildRequestBody(DEFAULT_AI_CONFIG, [{ role: "user", content: "x" }], true, AI_TOOL_SPECS);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe("auto");
    expect(body.parallel_tool_calls).toBe(false);
  });

  it("不传 tools 时不出现 tools 字段（老协议完全不受影响）", () => {
    const body = buildRequestBody(DEFAULT_AI_CONFIG, [{ role: "user", content: "x" }], true);
    expect("tools" in body).toBe(false);
    expect("tool_choice" in body).toBe(false);
  });

  it("assistant 的 tool_calls 与 tool 消息能原样序列化", () => {
    const body = buildRequestBody(DEFAULT_AI_CONFIG, [
      { role: "user", content: "q" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "结果" },
    ]);
    const msgs = body.messages as { role: string; tool_call_id?: string; tool_calls?: unknown[] }[];
    expect(msgs[1].tool_calls?.length).toBe(1);
    expect(msgs[2]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });
});

describe("M73 流式累加", () => {
  it("分片拼参数：name 也在分片里（少数中转如此）", () => {
    const a = acc();
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_","arguments":"{\\"pa"}}]}}]}', a);
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"th\\":\\"a.xml\\"}"}}]}}]}', a);
    const calls = finishToolCalls(a);
    expect(calls).toEqual([{ id: "call_1", name: "read_file", arguments: '{"path":"a.xml"}' }]);
  });

  it("多个调用按 index 分开，顺序稳定", () => {
    const a = acc();
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"outline","arguments":"{}"}}]}}]}', a);
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"list_files","arguments":"{}"}}]}}]}', a);
    expect(finishToolCalls(a).map((c) => c.name)).toEqual(["list_files", "outline"]);
  });

  it("非流式 message.tool_calls 也认", () => {
    const a = acc();
    const ok = mergeToolCalls('{"choices":[{"message":{"tool_calls":[{"id":"c9","function":{"name":"search_files","arguments":"{\\"query\\":\\"abc\\"}"}}]}}]}', a);
    expect(ok).toBe(true);
    expect(finishToolCalls(a)[0]).toMatchObject({ id: "c9", name: "search_files" });
  });

  it("普通正文 payload 不算工具调用", () => {
    const a = acc();
    expect(mergeToolCalls('{"choices":[{"delta":{"content":"你好"}}]}', a)).toBe(false);
    expect(finishToolCalls(a)).toEqual([]);
  });

  it("没有名字的残片直接丢掉；没有 id 时补一个", () => {
    const a = acc();
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}', a);
    expect(finishToolCalls(a)).toEqual([]);
    const b = acc();
    mergeToolCalls('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"outline","arguments":""}}]}}]}', b);
    expect(finishToolCalls(b)[0]).toMatchObject({ id: "call_0", arguments: "{}" });
  });
});

describe("M73 调用转内部工具", () => {
  it("参数全字段映射（path/dir/content/query/symbol/type/offset/limit/edits）", () => {
    const r = toAiToolCall({
      id: "c1",
      name: "apply_patch",
      arguments: JSON.stringify({ path: "a/b.xml", edits: [{ old: "x", new: "y" }, { old: 1 }] }),
    });
    expect(r.error).toBeUndefined();
    expect(r.call).toMatchObject({ tool: "apply_patch", path: "a/b.xml" });
    expect(r.call?.edits).toEqual([
      { old: "x", new: "y" },
      { old: "", new: "" },
    ]);

    const r2 = toAiToolCall({
      id: "c2",
      name: "read_file",
      arguments: '{"path":"A.java","offset":10,"limit":30}',
    });
    expect(r2.call).toMatchObject({ tool: "read_file", path: "A.java", offset: 10, limit: 30 });

    const r3 = toAiToolCall({ id: "c3", name: "find_usages", arguments: '{"symbol":"@string/app_name"}' });
    expect(r3.call).toMatchObject({ tool: "find_usages", symbol: "@string/app_name" });
  });

  it("参数不是合法 JSON / 不是对象 → 给模型可读的错因", () => {
    expect(toAiToolCall({ id: "c", name: "read_file", arguments: "{path: a}" }).error).toContain("不是合法 JSON");
    expect(toAiToolCall({ id: "c", name: "read_file", arguments: "[1,2]" }).error).toContain("不是对象");
  });

  it("未知工具名直接拒（防模型乱编）", () => {
    expect(toAiToolCall({ id: "c", name: "delete_everything", arguments: "{}" }).error).toContain("未知工具");
  });

  it("空参数按 {} 处理（list_files 之类全可选）", () => {
    const r = toAiToolCall({ id: "c", name: "list_files", arguments: "" });
    expect(r.error).toBeUndefined();
    expect(r.call).toEqual({ tool: "list_files" });
  });

  it("回喂历史时保持 OpenAI 形状", () => {
    expect(toHistoryToolCalls([{ id: "c1", name: "read_file", arguments: "" }])).toEqual([
      { id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ]);
  });
});

describe("M73 降级判定", () => {
  it("400 + 提到 tools/function → 认为不支持，本轮退回文本协议", () => {
    expect(looksLikeToolsRejected("400 model does not support tools")).toBe(true);
    expect(looksLikeToolsRejected("422 Unrecognized request argument: tools")).toBe(true);
    expect(looksLikeToolsRejected("该模型不支持 tool 调用")).toBe(true);
  });

  it("网络/超时/鉴权错误不触发降级（别把别的问题当 tools 背锅）", () => {
    expect(looksLikeToolsRejected("请求超时（120s）")).toBe(false);
    expect(looksLikeToolsRejected("API Key 无效")).toBe(false);
    expect(looksLikeToolsRejected("")).toBe(false);
    expect(looksLikeToolsRejected(undefined)).toBe(false);
  });
});

describe("M73 SSE 解析", () => {
  it("tool_calls 走 raws，不进正文 deltas", () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"我先看看"}}]}\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n' +
      "data: [DONE]\n";
    const r = parseSse(buf);
    expect(r.deltas).toEqual(["我先看看"]);
    expect(r.raws.length).toBe(1);
    expect(r.done).toBe(true);
  });

  it("普通回复没有 raws", () => {
    const r = parseSse('data: {"choices":[{"delta":{"content":"a"}}]}\n');
    expect(r.raws).toEqual([]);
  });
});

describe("M73 streamChat：只有 tool_calls 不算空回复", () => {
  const cfg = { ...DEFAULT_AI_CONFIG, apiKey: "sk-test" };

  it("fetch 流式：返回结构化 toolCalls，content 为空也 ok", async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a"}}]}}]}\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":".xml\\"}"}}]}}]}\n' +
      "data: [DONE]\n";
    const res = await streamChat(cfg, [{ role: "user", content: "x" }], {
      tools: AI_TOOL_SPECS,
      fetchImpl: (async () =>
        new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.content).toBe("");
    expect(res.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: '{"path":"a.xml"}' }]);
  });

  it("fetch 非流式整包 tool_calls 也认", async () => {
    const json = JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: "{}" } }] } }],
    });
    const res = await streamChat(cfg, [{ role: "user", content: "x" }], {
      tools: AI_TOOL_SPECS,
      fetchImpl: (async () =>
        new Response(json + "\n", { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.toolCalls?.[0]).toMatchObject({ id: "c1", name: "list_files" });
  });
});
