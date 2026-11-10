import { describe, expect, it } from "vitest";
import {
  collectProjectDex,
  numberDexFiles,
  DEX_MAX_FILES,
  DEX_MAX_ONE,
} from "@/lib/xml/project-dex";
import type { AiFileIo, AiFileEntry } from "@/lib/xml/ai-tools";

function b64(n: number): string {
  // 造一个“dex 魔数 + 填充”的 base64
  const bytes = Buffer.alloc(n);
  bytes[0] = 0x64; bytes[1] = 0x65; bytes[2] = 0x78; // "dex"
  bytes[3] = 0x0a; bytes[4] = 0x30; bytes[5] = 0x33;
  return bytes.toString("base64");
}

function fakeIo(rootLabel: string, files: Record<string, Buffer>): AiFileIo {
  const names = new Map<string, AiFileEntry>();
  for (const p of Object.keys(files)) {
    const seg = p.split("/");
    const parent = seg.slice(0, -1).join("/");
    names.set(parent || "", undefined as never);
  }
  const dirs = new Set<string>([""]);
  for (const p of Object.keys(files)) {
    let acc = "";
    for (const seg of p.split("/")) {
      acc = acc ? `${acc}/${seg}` : seg;
      dirs.add(acc);
    }
  }
  return {
    rootLabel: () => rootLabel,
    canWrite: false,
    async list(rel) {
      const prefix = rel ? rel + "/" : "";
      const out: AiFileEntry[] = [];
      const seen = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        if (seen.has(name)) continue;
        seen.add(name);
        if (slash >= 0) {
          // 可能是目录：如果还有更深的同前缀
          out.push({ name, kind: "dir", rel: prefix + name });
        } else {
          out.push({ name, kind: "file", rel: p });
        }
      }
      return { ok: true, items: out };
    },
    async read() {
      return { ok: false, error: "no text" };
    },
    async readBase64(rel) {
      const b = files[rel];
      if (!b) return { ok: false, error: "ENOENT" };
      return { ok: true, base64: b.toString("base64") };
    },
    async write() {
      return { ok: false, error: "readonly" };
    },
  };
}

describe("M211 项目 dex 收集", () => {
  it("没有 dex → 空数组", async () => {
    const io = fakeIo("x", { "res/layout/a.xml": Buffer.from("<L/>") });
    expect(await collectProjectDex(io)).toEqual([]);
  });

  it("找到 classes.dex / classes2.dex，按路径排序并重新编号 classes2/3 起", async () => {
    const io = fakeIo("x", {
      "app/build/outputs/dex/classes.dex": Buffer.from(b64(1024).length ? b64(4096) : ""),
      "app/build/outputs/dex/other.dex": Buffer.from(b64(2048)),
    });
    const got = await collectProjectDex(io);
    expect(got.length).toBe(2);
    const numbered = numberDexFiles(got);
    // 按 rel 排序：other.dex 在 classes.dex 之前（"other" < "app/..."? 否，rel 是完整路径）
    // rel: app/build/outputs/dex/classes.dex < app/build/outputs/dex/other.dex（classes 在 other 前）
    expect(numbered[0].name).toBe("classes2.dex");
    expect(numbered[1].name).toBe("classes3.dex");
    expect(numbered[0].rel).toBe("app/build/outputs/dex/classes.dex");
  });

  it("超过单文件上限的 dex 被跳过", async () => {
    const io = fakeIo("x", {
      "big.dex": Buffer.from(b64(DEX_MAX_ONE + 1024)),
      "small.dex": Buffer.from(b64(1024)),
    });
    const got = await collectProjectDex(io);
    expect(got.length).toBe(1);
    expect(got[0].rel).toBe("small.dex");
  });

  it("超过文件数上限时只取前 N 个（按路径排序）", async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < DEX_MAX_FILES + 5; i++) {
      files[`d/c${i}.dex`] = Buffer.from(b64(1024));
    }
    const io = fakeIo("x", files);
    const got = await collectProjectDex(io);
    expect(got.length).toBe(DEX_MAX_FILES);
  });

  it("numberDexFiles 从 classes2 起连续编号，稳定顺序", () => {
    const list = [
      { rel: "b.dex", name: "b.dex", base64: "AAAA", bytes: 3 },
      { rel: "a.dex", name: "a.dex", base64: "BBBB", bytes: 3 },
    ];
    const out = numberDexFiles(list as never);
    expect(out.map((d) => d.name)).toEqual(["classes2.dex", "classes3.dex"]);
    expect(out.map((d) => d.rel)).toEqual(["a.dex", "b.dex"]);
  });

  it("总字节上限：超过就不加后面的", async () => {
    const files: Record<string, Buffer> = {};
    // 每个 6MB，maxTotal 设 16MB → 最多收 2 个（6+6=12，第三个 18 超 16）
    files["1.dex"] = Buffer.from(b64(6 * 1024 * 1024));
    files["2.dex"] = Buffer.from(b64(6 * 1024 * 1024));
    files["3.dex"] = Buffer.from(b64(6 * 1024 * 1024));
    const io = fakeIo("x", files);
    const got = await collectProjectDex(io, { maxTotal: 16 * 1024 * 1024, maxFiles: 8, maxOne: 12 * 1024 * 1024 });
    expect(got.length).toBe(2);
  });
});
