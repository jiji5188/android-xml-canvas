// M383：设备端 classpath「0 个库」事故回归
//  根因：M380 的 ioHandled 只要 io “list 成功”就跳过原生补扫——哪怕 io 列到的是空数组
//  （SAF 树根不是项目根时 app/src/main/libs 会返回 ok:true, items:[]）→ 项目库 + 共享库全空
//  修：只有 io 真收到库的目录才跳过原生；并给两路收集加 notes 明细写进构建日志
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectProjectLibs, collectSharedLibs } from "../lib/xml/project-libs";
import type { AiFileIo } from "../lib/xml/ai-tools";

type FakeNative = {
  listDir?: (p: string) => string | null;
  readBase64?: (p: string) => string | null;
  saveFile?: () => void;
};

const setBridge = (b: FakeNative | undefined) => {
  (window as unknown as { AxvNative?: FakeNative }).AxvNative = b;
};

const nativeWith = (files: Record<string, string>): FakeNative => ({
  saveFile() {},
  listDir: (p) =>
    JSON.stringify({
      ok: true,
      items: Object.keys(files)
        .filter((f) => f.startsWith(p + "/"))
        .map((f) => ({ name: f.split("/").pop(), kind: "file", path: f })),
    }),
  readBase64: (p) => files[p] ?? null,
});

describe("M383 io 列到空 → 必须落回原生通道", () => {
  beforeEach(() => setBridge(undefined));
  afterEach(() => setBridge(undefined));

  it("io 返回 ok:true, items:[] 时，原生仍能收到库（旧实现这里 0 个）", async () => {
    setBridge(nativeWith({ "/root/app/src/main/libs/jxl-2.6.12.jar": "SldM" }));
    const emptyIo = {
      list: async () => ({ ok: true as const, items: [] as { name: string; kind: string }[] }),
      readBase64: async () => ({ ok: false as const }),
    } as unknown as AiFileIo;
    const r = await collectProjectLibs(emptyIo, "/root", null, null);
    expect(r.libs.map((l) => l.rel)).toEqual(["app/src/main/libs/jxl-2.6.12.jar"]);
    // 明细里要看得出「io 收 0 个」这件事
    expect(r.notes?.join("\n")).toContain("收 0 个库");
    expect(r.notes?.join("\n")).toContain("native app/src/main/libs");
  });

  it("io 真收到库的目录就不再重复跑原生（不产生重复条目）", async () => {
    setBridge(nativeWith({ "/root/app/src/main/libs/a.jar": "QUE=" }));
    const io = {
      list: async () => ({ ok: true as const, items: [{ name: "a.jar", kind: "file" }] }),
      readBase64: async () => ({ ok: true as const, base64: "QUE=" }),
    } as unknown as AiFileIo;
    const r = await collectProjectLibs(io, "/root", null, null);
    expect(r.libs.map((l) => l.rel)).toEqual(["app/src/main/libs/a.jar"]);
    expect(r.notes?.join("\n")).not.toContain("native app/src/main/libs");
  });

  it("io list 失败 → 落回原生", async () => {
    setBridge(nativeWith({ "/root/app/src/main/libs/b.aar": "QkI=" }));
    const badIo = {
      list: async () => ({ ok: false as const, items: [] }),
      readBase64: async () => ({ ok: false as const }),
    } as unknown as AiFileIo;
    const r = await collectProjectLibs(badIo, "/root", null, null);
    expect(r.libs.map((l) => l.rel)).toEqual(["app/src/main/libs/b.aar"]);
    expect(r.notes?.join("\n")).toContain("list 失败");
  });
});

describe("M383 共享库收集明细", () => {
  afterEach(() => setBridge(undefined));

  it("桥不可用 → 空 + 明细写明原因", async () => {
    setBridge(undefined);
    const notes: string[] = [];
    const libs = await collectSharedLibs(notes);
    expect(libs).toEqual([]);
    expect(notes.join("\n")).toContain("原生桥不可用");
  });

  it("列到 jar 就收，明细记数量；读失败单独计数", async () => {
    setBridge({
      saveFile() {},
      listDir: () =>
        JSON.stringify({
          ok: true,
          items: [
            { name: "jxl-2.6.12.jar", kind: "file", path: "/AndroidUIIDE/libs/jxl-2.6.12.jar" },
            { name: "broken.jar", kind: "file", path: "/AndroidUIIDE/libs/broken.jar" },
            { name: "sub", kind: "dir", path: "/AndroidUIIDE/libs/sub" },
          ],
        }),
      readBase64: (p) => (p.endsWith("jxl-2.6.12.jar") ? "SldM" : null),
    });
    const notes: string[] = [];
    const libs = await collectSharedLibs(notes);
    expect(libs.map((l) => l.rel)).toEqual(["shared/jxl-2.6.12.jar"]);
    const txt = notes.join("\n");
    expect(txt).toContain("收 1 个");
    expect(txt).toContain("读失败 1");
  });
});
