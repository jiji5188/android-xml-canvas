// test/xml_m64g_ai_history.test.ts — M64g（D4）：AI 改动历史 + 整批回滚
import { describe, expect, it } from "vitest";
import { AI_HISTORY_CAP, batchLabel, makeBatch, pushBatch, restoreBatch } from "@/lib/xml/ai-history";
import type { AiFileIo } from "@/lib/xml/ai-tools";

function memIo(files: Record<string, string>) {
  const io: AiFileIo & { files: Record<string, string> } = {
    files,
    rootLabel: () => "/proj",
    canWrite: true,
    list: async () => ({ ok: true, items: [] }),
    read: async (rel) => ({ ok: true, text: files[rel] ?? "" }),
    write: async (rel, text) => {
      files[rel] = text;
      return { ok: true };
    },
  };
  return io;
}

describe("M64g pushBatch", () => {
  it("新批次在最前，超过 20 批丢最旧的", () => {
    let list: ReturnType<typeof makeBatch>[] = [];
    for (let i = 0; i < 25; i++) list = pushBatch(list, makeBatch([{ rel: `f${i}.xml`, before: null }], 1000 + i));
    expect(list).toHaveLength(AI_HISTORY_CAP);
    expect(list[0].at).toBe(1024);
    expect(list[19].at).toBe(1005);
  });

  it("batchLabel：单文件显示路径，多文件显示「等 n 个文件」", () => {
    expect(batchLabel(makeBatch([{ rel: "a.xml", before: "" }], new Date(2026, 10, 1, 9, 5).getTime()))).toBe(
      "09:05 · a.xml",
    );
    const multi = makeBatch(
      [
        { rel: "a.xml", before: "" },
        { rel: "b.xml", before: "" },
        { rel: "c.xml", before: "" },
      ],
      new Date(2026, 10, 1, 9, 5).getTime(),
    );
    expect(batchLabel(multi)).toBe("09:05 · a.xml 等 3 个文件");
  });
});

describe("M64g restoreBatch", () => {
  it("三个文件一次全回滚到 before", async () => {
    const io = memIo({ "a.xml": "A2", "b.xml": "B2", "c.xml": "C2" });
    const batch = makeBatch([
      { rel: "a.xml", before: "A1" },
      { rel: "b.xml", before: "B1" },
      { rel: "c.xml", before: "C1" },
    ]);
    const r = await restoreBatch(io, batch);
    expect(r.ok).toBe(true);
    expect(io.files).toEqual({ "a.xml": "A1", "b.xml": "B1", "c.xml": "C1" });
  });

  it("AI 新建的文件（before=null）回滚为空内容并标 blanked", async () => {
    const io = memIo({ "new.xml": "<x/>" });
    const r = await restoreBatch(io, makeBatch([{ rel: "new.xml", before: null }]));
    expect(io.files["new.xml"]).toBe("");
    expect(r.results[0].blanked).toBe(true);
  });

  it("部分失败：仍尝试写其它文件，返回 ok=false", async () => {
    const files: Record<string, string> = { "a.xml": "A2", "b.xml": "B2" };
    const io: AiFileIo = {
      rootLabel: () => "/p",
      list: async () => ({ ok: true, items: [] }),
      read: async (rel) => ({ ok: true, text: files[rel] }),
      write: async (rel, text) => {
        if (rel === "b.xml") return { ok: false, error: "只读" };
        files[rel] = text;
        return { ok: true };
      },
    };
    const r = await restoreBatch(io, makeBatch([
      { rel: "a.xml", before: "A1" },
      { rel: "b.xml", before: "B1" },
    ]));
    expect(files["a.xml"]).toBe("A1");
    expect(r.ok).toBe(false);
    expect(r.results.find((x) => x.rel === "b.xml")!.error).toBe("只读");
  });
});
