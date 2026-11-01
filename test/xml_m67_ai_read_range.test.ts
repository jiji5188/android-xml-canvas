// test/xml_m67_ai_read_range.test.ts — M67（C4）：read_file 行段 + outline 大纲
//
// Java 文件动辄上千行，整份读既烧 token 又看不清结构。现在模型可以：
//   1) outline 先拿「类 / 方法 + 行号」
//   2) read_file 带 offset/limit 只读目标那几十行（返回带行号）
import { describe, expect, it } from "vitest";
import { parseToolReply, runTool, validateToolCall, AI_TOOL_NAMES } from "@/lib/xml/ai-tools";
import type { AiFileIo } from "@/lib/xml/ai-tools";

const JAVA = `package com.demo;

import android.os.Bundle;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
    }

    private void refreshList() {
        adapter.notifyDataSetChanged();
    }

    static class Holder {
        void bind() {
        }
    }
}
`;

const files: Record<string, string> = {
  "app/src/main/java/com/demo/MainActivity.java": JAVA,
  "app/src/main/res/layout/activity_main.xml": `<LinearLayout>\n</LinearLayout>\n`,
};

const io: AiFileIo = {
  rootLabel: () => "/proj",
  async list(rel) {
    return { ok: true, items: [{ kind: "file", name: "MainActivity.java", rel: "x" }] };
  },
  async read(rel) {
    const t = files[rel];
    return t === undefined ? { ok: false, error: "没有这个文件" } : { ok: true, text: t };
  },
  async write() {
    return { ok: true };
  },
};

describe("M67 read_file 行段", () => {
  it("offset/limit 只返回该段，且每行带行号", async () => {
    const out = await runTool(
      { tool: "read_file", path: "app/src/main/java/com/demo/MainActivity.java", offset: 5, limit: 4 },
      io,
    );
    expect(out).toContain("第 5-8 行");
    expect(out).toContain("5| public class MainActivity extends Activity {");
    expect(out).toContain("6|     @Override");
    expect(out).not.toContain("notifyDataSetChanged");
    expect(out).toContain("续读用 {offset:9");
  });

  it("offset 超出总行数时收敛到最后一行，不炸", async () => {
    const out = await runTool(
      { tool: "read_file", path: "app/src/main/java/com/demo/MainActivity.java", offset: 9999, limit: 5 },
      io,
    );
    expect(out).not.toContain("错误");
    expect(out).toMatch(/共 \d+ 行/);
    expect(out).toContain("21| ");
  });

  it("不传 offset/limit 时行为不变（整份读）", async () => {
    const out = await runTool({ tool: "read_file", path: "app/src/main/res/layout/activity_main.xml" }, io);
    expect(out).toContain("文件 app/src/main/res/layout/activity_main.xml");
    expect(out).not.toContain("| <LinearLayout>");
  });

  it("超过 400 行的文件会提示先看大纲", async () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    const ioBig: AiFileIo = { ...io, read: async () => ({ ok: true, text: big }) };
    const out = await runTool({ tool: "read_file", path: "a.java" }, ioBig);
    expect(out).toContain("建议先用 outline");
  });

  it("limit 超过 400 被判非法", () => {
    expect(validateToolCall({ tool: "read_file", path: "a.java", limit: 500 })).toContain("最多 400");
    expect(validateToolCall({ tool: "read_file", path: "a.java", limit: 200 })).toBeNull();
  });

  it("offset 必须从 1 开始", () => {
    expect(validateToolCall({ tool: "read_file", path: "a.java", offset: 0 })).toContain("offset");
  });
});

describe("M67 outline 大纲", () => {
  it("列出类与方法及行号", async () => {
    const out = await runTool({ tool: "outline", path: "app/src/main/java/com/demo/MainActivity.java" }, io);
    expect(out).toContain("L5 class MainActivity");
    expect(out).toContain("onCreate");
    expect(out).toContain("refreshList");
    expect(out).toContain("MainActivity.java 大纲");
  });

  it("非 Java/Kotlin 文件被拒", async () => {
    const out = await runTool({ tool: "outline", path: "app/src/main/res/layout/activity_main.xml" }, io);
    expect(out).toContain("只支持 .java/.kt");
  });

  it("outline 已进可用工具列表与提示词", () => {
    expect(AI_TOOL_NAMES).toContain("outline");
  });

  it("parseToolReply 能解析 outline 与带 offset 的 read_file", () => {
    const reply = [
      "先看看结构",
      "```axv-tool",
      '{"tool":"outline","args":{"path":"a.java"}}',
      "```",
      "```axv-tool",
      '{"tool":"read_file","args":{"path":"a.java","offset":10,"limit":30}}',
      "```",
    ].join("\n");
    const r = parseToolReply(reply);
    expect(r.errors).toEqual([]);
    expect(r.calls.map((c) => c.tool)).toEqual(["outline", "read_file"]);
    expect(r.calls[1].offset).toBe(10);
    expect(r.calls[1].limit).toBe(30);
  });
});
