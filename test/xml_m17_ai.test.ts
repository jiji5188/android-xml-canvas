import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS,
  applyProvider,
  buildRequestBody,
  callAi,
  contextPreamble,
  DEFAULT_AI_CONFIG,
  endpointOf,
  extractCodeBlock,
  extractContent,
  humanizeError,
  loadAiConfig,
  maskKey,
  normalizeBaseUrl,
  validateConfig,
} from "../lib/xml/ai";

describe("M17 ai: 纯逻辑", () => {
  it("baseUrl 归一化：补 https、去尾斜杠、剥掉 /chat/completions", () => {
    expect(normalizeBaseUrl("api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1");
    expect(normalizeBaseUrl("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("")).toBe("");
  });

  it("endpointOf 拼接 chat/completions", () => {
    expect(endpointOf("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("预设切换保留已填 key", () => {
    const base = { ...DEFAULT_AI_CONFIG, apiKey: "sk-test" };
    const qwen = applyProvider(base, "qwen");
    expect(qwen.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(qwen.model).toBe("qwen-plus");
    expect(qwen.apiKey).toBe("sk-test");
  });

  it("validateConfig 缺项报人话", () => {
    const full = { ...DEFAULT_AI_CONFIG, apiKey: "sk-x" };
    expect(validateConfig({ ...full, baseUrl: "" })).toContain("接口地址");
    expect(validateConfig({ ...full, apiKey: "" })).toContain("API Key");
    expect(validateConfig(full)).toBe(null);
  });

  it("loadAiConfig 坏数据回落默认", () => {
    expect(loadAiConfig("not json")).toEqual({ ...DEFAULT_AI_CONFIG, apiKey: "" });
    const ok = loadAiConfig(JSON.stringify({ model: "x", temperature: 0.5 }));
    expect(ok.model).toBe("x");
    expect(ok.temperature).toBe(0.5);
    expect(ok.baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
  });

  it("maskKey 打码", () => {
    // 长度 20：前 4 + 中间 8 个点 + 后 4（"5890"）
    expect(maskKey("sk-abcdefgh1234567890")).toBe("sk-a" + "•".repeat(8) + "7890");
    expect(maskKey("abc")).toBe("•••");
    expect(maskKey("")).toBe("");
  });

  it("buildRequestBody 结构", () => {
    const body = buildRequestBody(DEFAULT_AI_CONFIG, [{ role: "user", content: "hi" }]);
    expect(body.model).toBe(DEFAULT_AI_CONFIG.model);
    expect(body.messages).toHaveLength(1);
    expect(body.max_tokens).toBe(DEFAULT_AI_CONFIG.maxTokens);
    expect(body.stream).toBe(false);
  });

  it("extractContent 兼容字符串 / 数组 / 缺失", () => {
    expect(extractContent({ choices: [{ message: { content: "ok" } }] })).toBe("ok");
    expect(
      extractContent({ choices: [{ message: { content: [{ type: "text", text: "a" }, "b"] } }] }),
    ).toBe("ab");
    expect(extractContent({ choices: [] })).toBe("");
  });

  it("extractCodeBlock 优先 xml 块，兜底裸 XML", () => {
    expect(extractCodeBlock("前言\n```xml\n<View/>\n``` 后语")).toBe("<View/>");
    expect(extractCodeBlock("```python\nprint(1)\n```")).toBe("print(1)");
    expect(extractCodeBlock('<FrameLayout/>\n')).toBe("<FrameLayout/>");
    expect(extractCodeBlock("没有代码块")).toBe(null);
  });

  it("humanizeError：401 / 网络 / 超时", () => {
    expect(humanizeError(null, 401)).toContain("Key 无效");
    expect(humanizeError(new Error("Failed to fetch"))).toContain("跨域");
    expect(humanizeError(new Error("timeout"))).toContain("超时");
  });

  it("callAi：没配 key 直接失败，不发网络", async () => {
    let called = false;
    const res = await callAi({ ...DEFAULT_AI_CONFIG, apiKey: "" }, [{ role: "user", content: "x" }], {
      fetchImpl: (() => {
        called = true;
        throw new Error("should not be called");
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("API Key");
    expect(called).toBe(false);
  });

  it("callAi：HTTP 200 + choices 成功", async () => {
    const json = { choices: [{ message: { content: "```xml\n<Button/>\n```" } }] };
    const res = await callAi({ ...DEFAULT_AI_CONFIG, apiKey: "sk-test" }, [{ role: "user", content: "x" }], {
      fetchImpl: (async () =>
        new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(extractCodeBlock(res.content)).toBe("<Button/>");
  });

  it("callAi：404 转人话", async () => {
    const res = await callAi({ ...DEFAULT_AI_CONFIG, apiKey: "sk-test" }, [{ role: "user", content: "x" }], {
      fetchImpl: (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("404");
  });

  it("contextPreamble 截断超长 XML", () => {
    const long = "<View " + "a".repeat(20000) + "/>";
    const p = contextPreamble({ xml: long, selection: "L > B" }, 100);
    expect(p).toContain("以下省略");
    expect(p).toContain("L > B");
    expect(p.length).toBeLessThan(400);
  });

  it("预设列表覆盖主流服务商", () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["deepseek", "qwen", "zhipu", "moonshot", "openai", "custom"]));
  });
});
