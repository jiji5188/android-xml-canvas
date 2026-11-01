// test/xml_m64k_ai_tool_memory.test.ts — M64k（A7）：工具结果要记住
import { describe, expect, it } from "vitest";
import {
  TOOL_MEMORY,
  formatToolMemory,
  memoryEntryFromTool,
  pushToolMemory,
  toolMemoryOneLine,
  type ToolMemoryEntry,
} from "@/lib/xml/ai-tool-memory";

const entry = (target: string, text: string, tool = "read_file", at = 1): ToolMemoryEntry => ({
  tool,
  target,
  text,
  at,
  lines: tool === "read_file" ? text.split("\n").length : undefined,
});

describe("M64k pushToolMemory", () => {
  it("同一文件重复读只留最新一条（不占满记忆）", () => {
    let list = pushToolMemory([], entry("a.xml", "v1"));
    list = pushToolMemory(list, entry("b.xml", "b"));
    list = pushToolMemory(list, entry("a.xml", "v2"));
    expect(list.map((e) => `${e.target}:${e.text}`)).toEqual(["b.xml:b", "a.xml:v2"]);
  });

  it("超过上限丢最旧的", () => {
    let list: ToolMemoryEntry[] = [];
    for (let i = 0; i < TOOL_MEMORY.max + 3; i++) list = pushToolMemory(list, entry(`f${i}.xml`, `x${i}`));
    expect(list).toHaveLength(TOOL_MEMORY.max);
    expect(list[0].target).toBe(`f3.xml`);
  });
});

describe("M64k toolMemoryOneLine", () => {
  it("read 带行数、search 带命中数", () => {
    expect(toolMemoryOneLine(entry("a.xml", "l1\nl2\nl3"))).toBe("read a.xml（3 行）");
    expect(toolMemoryOneLine(entry("foo", "共 5 处\n…", "search_files"))).toBe("search foo → 5 处");
  });
});

describe("M64k formatToolMemory", () => {
  it("最近 2 条给全文，更早的压成一行", () => {
    const list = [
      entry("old1.xml", "OLD1"),
      entry("old2.xml", "OLD2"),
      entry("mid.xml", "MID"),
      entry("new.xml", "NEW"),
    ];
    const txt = formatToolMemory(list);
    expect(txt).toContain("不用再读一遍");
    expect(txt).toContain("- read old1.xml");
    expect(txt).toContain("【read new.xml");
    expect(txt).toContain("NEW");
    // 更早的只有摘要，不带正文
    expect(txt.split("OLD1").length - 1).toBe(0);
  });

  it("超长正文截断，避免 prompt 爆炸", () => {
    const big = "x".repeat(TOOL_MEMORY.maxChars + 500);
    const txt = formatToolMemory([entry("big.xml", big)]);
    expect(txt).toContain("已截断");
    expect(txt.length).toBeLessThan(TOOL_MEMORY.maxChars + 200);
  });

  it("空记忆返回空串（不往 prompt 塞空壳）", () => {
    expect(formatToolMemory([])).toBe("");
  });

  it("摘要只列最近几条，太老的直接不提", () => {
    const list: ToolMemoryEntry[] = [];
    for (let i = 0; i < 12; i++) list.push(entry(`f${i}.xml`, `x${i}`, "read_file", i));
    const txt = formatToolMemory(list);
    expect(txt).not.toContain("f0.xml");
    expect(txt.split("\n- read ").length - 1).toBeLessThanOrEqual(TOOL_MEMORY.maxOlder);
  });
});

describe("M64k memoryEntryFromTool", () => {
  it("read 自动带行数", () => {
    const e = memoryEntryFromTool("read_file", "a.xml", "1\n2\n3\n4");
    expect(e.lines).toBe(4);
    expect(e.target).toBe("a.xml");
  });
});
