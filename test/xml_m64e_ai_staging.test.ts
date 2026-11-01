// test/xml_m64e_ai_staging.test.ts — M64e（B3）：AI 写操作先暂存，应用时才落盘+备份
import { describe, expect, it } from "vitest";
import { createStagingIo, flushStaged } from "@/lib/xml/ai-staging";
import { runTool, type AiFileIo } from "@/lib/xml/ai-tools";

function memIo(files: Record<string, string>): AiFileIo & { files: Record<string, string> } {
  return {
    files,
    rootLabel: () => "/proj",
    canWrite: true,
    list: async (rel) => {
      const prefix = rel ? `${rel}/` : "";
      const items = Object.keys(files)
        .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
        .map((f) => ({ name: f.slice(prefix.length), kind: "file" as const, rel: f }));
      return { ok: true, items };
    },
    read: async (rel) => (files[rel] !== undefined ? { ok: true, text: files[rel] } : { ok: false, error: "不存在" }),
    write: async (rel, text) => {
      files[rel] = text;
      return { ok: true };
    },
  };
}

describe("M64e staging：写不落盘", () => {
  it("write 只暂存，base 文件一个字节都没动", async () => {
    const base = memIo({ "res/layout/a.xml": "old" });
    const st = createStagingIo(base);
    const r = await st.write("res/layout/a.xml", "new");
    expect(r.ok).toBe(true);
    expect(base.files["res/layout/a.xml"]).toBe("old");
    expect(st.staged()).toHaveLength(1);
    expect(st.staged()[0].before).toBe("old");
    expect(st.staged()[0].after).toBe("new");
  });

  it("暂存后 read 读到的是暂存内容（同一轮 patch 能继续改）", async () => {
    const base = memIo({ "a.xml": "one" });
    const st = createStagingIo(base);
    await st.write("a.xml", "two");
    expect((await st.read("a.xml")).text).toBe("two");
  });

  it("同一文件多次写：before 保持最初的原文", async () => {
    const base = memIo({ "a.xml": "orig" });
    const st = createStagingIo(base);
    await st.write("a.xml", "v1");
    await st.write("a.xml", "v2");
    expect(st.staged()).toHaveLength(1);
    expect(st.staged()[0]).toMatchObject({ before: "orig", after: "v2" });
  });

  it("新建文件：before 为 null，list 里能看见", async () => {
    const base = memIo({});
    const st = createStagingIo(base);
    await st.write("res/values/colors.xml", "<resources/>");
    expect(st.staged()[0].before).toBeNull();
    const ls = await st.list("res/values");
    expect(ls.items!.map((i) => i.name)).toContain("colors.xml");
  });

  it("clear 丢弃全部暂存", async () => {
    const base = memIo({ "a.xml": "x" });
    const st = createStagingIo(base);
    await st.write("a.xml", "y");
    st.clear();
    expect(st.staged()).toHaveLength(0);
    expect((await st.read("a.xml")).text).toBe("x");
  });

  it("runTool 走暂存时文案是「已暂存」而不是「已写入」", async () => {
    const base = memIo({ "res/layout/a.xml": "old" });
    const st = createStagingIo(base);
    const out = await runTool({ tool: "apply_patch", path: "res/layout/a.xml", edits: [{ old: "old", new: "new" }] }, st);
    expect(out).toContain("已暂存");
    expect(base.files["res/layout/a.xml"]).toBe("old");
  });
});

describe("M64e flushStaged：应用时备份原文", () => {
  it("改已有文件 → 先写 .axv_backup/ 备份原文，再落盘", async () => {
    const base = memIo({ "res/layout/a.xml": "old" });
    const st = createStagingIo(base);
    await st.write("res/layout/a.xml", "new");
    const r = await flushStaged(base, st.staged());
    expect(r.ok).toBe(true);
    expect(base.files["res/layout/a.xml"]).toBe("new");
    const backupKey = Object.keys(base.files).find((k) => k.startsWith(".axv_backup/res/layout/a.xml."));
    expect(backupKey).toBeTruthy();
    expect(base.files[backupKey as string]).toBe("old");
  });

  it("新建文件不产生备份（没有原文可备）", async () => {
    const base = memIo({});
    const st = createStagingIo(base);
    await st.write("res/values/new.xml", "<resources/>");
    const r = await flushStaged(base, st.staged());
    expect(r.ok).toBe(true);
    expect(r.results[0].backup).toBeUndefined();
    expect(Object.keys(base.files)).toEqual(["res/values/new.xml"]);
  });

  it("写入失败时结果里带 error，且不阻塞其它文件", async () => {
    const base = memIo({ "a.xml": "1", "b.xml": "2" });
    const failing: AiFileIo = {
      ...base,
      write: async (rel, text) => {
        if (rel === "b.xml") return { ok: false, error: "磁盘满" };
        base.files[rel] = text;
        return { ok: true };
      },
    };
    const st = createStagingIo(base);
    await st.write("a.xml", "1x");
    await st.write("b.xml", "2x");
    const r = await flushStaged(failing, st.staged());
    expect(r.ok).toBe(false);
    expect(r.results.find((x) => x.rel === "a.xml")!.ok).toBe(true);
    expect(r.results.find((x) => x.rel === "b.xml")!.error).toBe("磁盘满");
  });
});
