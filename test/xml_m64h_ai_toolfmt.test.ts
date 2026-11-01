// test/xml_m64h_ai_toolfmt.test.ts — M64h（A4）：工具调用格式容错（重问一次 + 严格校验）
import { describe, expect, it } from "vitest";
import { AI_TOOL_PROMPT, parseToolReply, stripToolBlocks, validateToolCall } from "@/lib/xml/ai-tools";
import { aiDocContextOf, buildAiSystemPrompt } from "@/lib/xml/ai-doc-context";

const block = (body: string) => "先说明一下。\n```axv-tool\n" + body + "\n```\n后记。";

describe("M64h parseToolReply：合法调用", () => {
  it("新格式 {tool,args} 能解析", () => {
    const r = parseToolReply(block('{"tool":"read_file","args":{"path":"app/src/main/res/layout/a.xml"}}'));
    expect(r.errors).toEqual([]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ tool: "read_file", path: "app/src/main/res/layout/a.xml" });
  });

  it("旧扁平格式仍兼容（模型会退回去）", () => {
    const r = parseToolReply(block('{"tool":"read_file","path":"a.xml"}'));
    expect(r.calls[0].path).toBe("a.xml");
  });

  it("apply_patch 的 edits 正常取出", () => {
    const r = parseToolReply(
      block('{"tool":"apply_patch","args":{"path":"a.xml","edits":[{"old":"A","new":"B"},{"old":"C","new":"D"}]}}'),
    );
    expect(r.calls[0].edits).toEqual([
      { old: "A", new: "B" },
      { old: "C", new: "D" },
    ]);
  });

  it("一次最多取 2 个调用", () => {
    const body = ['{"tool":"list_files","args":{}}', '{"tool":"read_file","args":{"path":"a"}}', '{"tool":"read_file","args":{"path":"b"}}'].join(
      "\n```\n```axv-tool\n",
    );
    expect(parseToolReply(block(body)).calls).toHaveLength(2);
  });
});

describe("M64h parseToolReply：坏格式必须有错可喂（以前静默丢弃）", () => {
  it("JSON 语法错 → 报「不是合法 JSON」", () => {
    const r = parseToolReply(block('{"tool":"read_file","args":{"path":"a.xml",}}'));
    expect(r.calls).toEqual([]);
    expect(r.errors[0]).toContain("不是合法 JSON");
    expect(r.blocks).toBe(1);
  });

  it("跨行 JSON 仍能执行（解析器不靠行数猜）", () => {
    const r = parseToolReply(block('{\n  "tool": "read_file",\n  "args": { "path": "a.xml" }\n}'));
    expect(r.calls).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it("未知工具 → 列出可用工具名", () => {
    const r = parseToolReply(block('{"tool":"delete_file","args":{"path":"a"}}'));
    expect(r.calls).toEqual([]);
    expect(r.errors[0]).toContain("delete_file");
    expect(r.errors[0]).toContain("apply_patch");
  });

  it("缺必需参数 → 指出缺哪个字段", () => {
    expect(parseToolReply(block('{"tool":"read_file","args":{}}')).errors[0]).toContain("args.path");
    expect(parseToolReply(block('{"tool":"search_files","args":{}}')).errors[0]).toContain("args.query");
    expect(parseToolReply(block('{"tool":"write_file","args":{"path":"a.xml"}}')).errors[0]).toContain("args.content");
    expect(parseToolReply(block('{"tool":"apply_patch","args":{"path":"a.xml","edits":[]}}')).errors[0]).toContain("args.edits");
  });

  it("空块 / 非对象 / 超 20 处 edits 都有明确原因", () => {
    expect(parseToolReply(block("   ")).errors[0]).toContain("空");
    expect(parseToolReply(block("[1,2,3]")).errors[0]).toContain("JSON 对象");
    const many = Array.from({ length: 21 }, () => ({ old: "a", new: "b" }));
    const r = parseToolReply(block(JSON.stringify({ tool: "apply_patch", args: { path: "a.xml", edits: many } })));
    expect(r.errors[0]).toContain("20");
  });

  it("坏块不会污染好块：一个坏一个好 → 执行好的，同时报坏的原因", () => {
    const reply = "```axv-tool\n{bad json}\n```\n\n```axv-tool\n{\"tool\":\"list_files\",\"args\":{}}\n```";
    const r = parseToolReply(reply);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].tool).toBe("list_files");
    expect(r.errors).toHaveLength(1);
  });

  it("工具块全部从展示正文里去掉（含坏块）", () => {
    const shown = stripToolBlocks(block('{"tool":"read_file","args":{"path":"a.xml"}}'));
    expect(shown).toBe("先说明一下。\n\n后记。");
  });
});

describe("M64h validateToolCall 直测", () => {
  it("list_files 无参数也合法", () => {
    expect(validateToolCall({ tool: "list_files" })).toBeNull();
  });
  it("write_file 必须有 content（空串也算有）", () => {
    expect(validateToolCall({ tool: "write_file", path: "a.xml", content: "" })).toBeNull();
    expect(validateToolCall({ tool: "write_file", path: "a.xml" })).toContain("content");
  });
});

describe("M64h prompt：协议教的是 {tool,args} 单行", () => {
  it("AI_TOOL_PROMPT 里示例带 args，并写清单行要求", () => {
    expect(AI_TOOL_PROMPT).toContain('"args":{');
    expect(AI_TOOL_PROMPT).toContain("一行");
    expect(AI_TOOL_PROMPT).not.toContain('{"tool":"list_files","dir"');
  });
});

describe("M64h A2：system prompt 不再自相矛盾", () => {
  const layout = aiDocContextOf("app/src/main/res/layout/a.xml", "<LinearLayout/>");

  it("默认（auto）教它「先判断意图」，改文件走 patch", () => {
    const p = buildAiSystemPrompt(layout, { canWrite: true });
    expect(p).toContain("先判断我这句话要什么");
    expect(p).toContain("apply_patch");
    expect(p).toContain("只有我明确说");
    expect(p).toContain("禁止项");
  });

  it("只读项目：明确说不能写，不教 apply_patch", () => {
    const p = buildAiSystemPrompt(layout, { canWrite: false });
    expect(p).toContain("没有写权限");
    expect(p).not.toContain("用 axv-tool 的 apply_patch");
  });

  it("intent=xml（用户明确要整份）才要求输出完整代码块", () => {
    const p = buildAiSystemPrompt(layout, { intent: "xml" });
    expect(p).toContain("本次我明确要完整文件");
    expect(p).toContain("```xml");
    expect(p).not.toContain("不要整份重贴");
  });

  it("禁止项里点名「不要编造资源、引用前先确认」", () => {
    const p = buildAiSystemPrompt(layout);
    expect(p).toContain("不要编造项目里不存在的资源");
    expect(p).toContain("search_files");
  });
});
