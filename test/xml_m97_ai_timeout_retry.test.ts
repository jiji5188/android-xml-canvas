// test/xml_m97_ai_timeout_retry.test.ts — M97：思考过程 / 首包超时 / 重试
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { defaultTimeoutMs, parseSse, reasoningOfJson, streamChat } from "../lib/xml/ai-transport";
import type { AiConfig } from "../lib/xml/ai";

const cfg: AiConfig = {
  provider: "deepseek",
  baseUrl: "https://api.example.com/v1",
  model: "deepseek-reasoner",
  apiKey: "sk-test",
  temperature: 0.2,
  maxTokens: 4096,
};

describe("M97 思考过程解析", () => {
  it("reasoning_content → 思考增量", () => {
    const p = JSON.stringify({ choices: [{ delta: { reasoning_content: "先看布局" } }] });
    expect(reasoningOfJson(p)).toBe("先看布局");
  });

  it("兼容 reasoning / thinking 两种字段名", () => {
    expect(reasoningOfJson(JSON.stringify({ choices: [{ delta: { reasoning: "想一下" } }] }))).toBe("想一下");
    expect(reasoningOfJson(JSON.stringify({ choices: [{ delta: { thinking: "嗯" } }] }))).toBe("嗯");
  });

  it("非流式 message.reasoning_content 也能取到", () => {
    const p = JSON.stringify({ choices: [{ message: { content: "答案", reasoning_content: "推理" } }] });
    expect(reasoningOfJson(p)).toBe("推理");
  });

  it("正文和思考一起回来时，两边都要拿到", () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"想一想"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n' +
      "data: [DONE]\n\n";
    const r = parseSse(sse);
    expect(r.thoughts).toEqual(["想一想"]);
    expect(r.deltas).toEqual(["答案"]);
    expect(r.done).toBe(true);
  });

  it("没有思考字段时不产生噪声", () => {
    expect(reasoningOfJson(JSON.stringify({ choices: [{ delta: { content: "hi" } }] }))).toBe("");
    expect(parseSse('data: {"choices":[{"delta":{"content":"hi"}}]}\n').thoughts).toEqual([]);
  });
});

describe("M97 总超时默认值", () => {
  it("不填时给推理模型 300s", () => {
    expect(defaultTimeoutMs(cfg)).toBe(300_000);
  });

  it("按配置走，并夹在 10s~1800s", () => {
    expect(defaultTimeoutMs({ ...cfg, timeoutSec: 600 })).toBe(600_000);
    expect(defaultTimeoutMs({ ...cfg, timeoutSec: 5 })).toBe(300_000);
    expect(defaultTimeoutMs({ ...cfg, timeoutSec: 99999 })).toBe(1_800_000);
  });
});

describe("M97 首包超时（看门狗）", () => {
  it("模型一直不吐字 → 到点中断并给可操作提示", async () => {
    // 永远不返回分片的流：模拟「连上了但一直算，没有任何输出」
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {
              /* already closed */
            }
          });
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await streamChat(cfg, [{ role: "user", content: "hi" }], {
      fetchImpl,
      firstByteMs: 60,
      timeoutMs: 5_000,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("没有任何输出");
    expect(res.error).toContain("重试");
  });

  it("思考过程算「有输出」，不会误杀推理模型", async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"推理中"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      "data: [DONE]\n\n";
    const fetchImpl = vi.fn(async () => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          // 先只给思考过程，跨过首包窗口，再给正文
          controller.enqueue(enc.encode(sse.split("\n\n")[0] + "\n\n"));
          await new Promise((r) => setTimeout(r, 120));
          controller.enqueue(enc.encode(sse.split("\n\n").slice(1).join("\n\n")));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const thoughts: string[] = [];
    const res = await streamChat(cfg, [{ role: "user", content: "hi" }], {
      fetchImpl,
      firstByteMs: 60,
      timeoutMs: 5_000,
      onReasoning: (t) => thoughts.push(t),
    });
    expect(res.ok).toBe(true);
    expect(res.content).toBe("好");
    expect(thoughts.join("")).toBe("推理中");
  });
});

describe("M97 面板接线（源码护栏）", () => {
  const src = fs.readFileSync("components/AiPanel.tsx", "utf8");

  it("思考过程单独一个框，不混进气泡正文", () => {
    expect(src).toContain("function AiThink");
    expect(src).toContain("axv-ai-think-body");
    expect(src).toContain("onReasoning:");
  });

  it("失败气泡带「重试」，最后一条回复带「重新生成」", () => {
    expect(src).toContain("rerun");
    expect(src).toContain("tt(\"重试\")");
    expect(src).toContain("tt(\"重新生成\")");
    expect(src).toContain("failed: true");
  });

  it("重跑时不重复压入 user 消息（用 base 前缀重建）", () => {
    expect(src).toContain("baseChat");
    expect(src).toContain("setChat([...baseChat, { role: \"user\", content: q }])");
  });

  it("总超时走配置", () => {
    expect(src).toContain("timeoutMs: defaultTimeoutMs(cfg)");
    expect(src).toContain("timeoutSec");
  });
});
