// test/xml_m64b_ai_fs.test.ts — M64b（B2）：AI 的文件通道从「当前项目」来，不再拼 默认目录 + 项目名
//
// 真 bug：createNativeIo(projectName) 的根 = getDefaultWorkspace() + "/" + 项目名。
// 用「打开项目目录」授权的自定义目录 / SAF 目录时这个路径根本不存在，list/read 全失败。
// 现在：优先用 ProjectSource（它自己知道根），其次绝对根路径，都没有才不可用。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ioForProject, ioFromProjectSource } from "@/lib/xml/ai-fs";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";
import type { AiFileIo } from "@/lib/xml/ai-tools";

function fakeSource(over: Partial<ProjectSource> = {}): ProjectSource {
  return {
    name: "Demo",
    listChildren: async (rel): Promise<BrowseEntry[]> => {
      if (rel === "") return [
        { kind: "dir", name: "res", rel: "res" },
        { kind: "file", name: "settings.gradle", rel: "settings.gradle" },
      ];
      if (rel === "res") return [{ kind: "file", name: "a.xml", rel: "res/a.xml" }];
      return [];
    },
    readText: async (rel) => (rel === "res/a.xml" ? "<resources/>" : null),
    ...over,
  };
}

describe("M64b ioFromProjectSource", () => {
  it("source 为 null → 不可用", () => {
    expect(ioFromProjectSource(null)).toBeNull();
  });

  it("list/read 走项目自己的实现", async () => {
    const io = ioFromProjectSource(fakeSource())!;
    const l = await io.list("");
    expect(l.ok).toBe(true);
    expect(l.items?.map((i) => i.rel)).toEqual(["res", "settings.gradle"]);
    const r = await io.read("res/a.xml");
    expect(r).toEqual({ ok: true, text: "<resources/>" });
    expect((await io.read("nope.xml")).ok).toBe(false);
  });

  it("rootLabel 优先用 rootPath，没有就用项目名", () => {
    expect(ioFromProjectSource(fakeSource())!.rootLabel()).toBe("Demo");
    expect(ioFromProjectSource(fakeSource({ rootPath: "/storage/emulated/0/myproj/" }))!.rootLabel()).toBe(
      "/storage/emulated/0/myproj",
    );
  });

  it("没有 rootPath 时 write 给的人话错误，而不是硬写", async () => {
    const io = ioFromProjectSource(fakeSource())!;
    const w = await io.write("res/a.xml", "x");
    expect(w.ok).toBe(false);
    expect((w as { error?: string }).error).toContain("没有可写根路径");
  });
});

describe("M64b ioForProject：选路顺序", () => {
  it("有 source 就用 source（即使 rootPath 也对）", () => {
    const io = ioForProject({ source: fakeSource(), rootPath: "/ignored" })!;
    expect(io.rootLabel()).toBe("Demo");
  });

  it("没 source 但绝对根路径在 → 用根路径通道", () => {
    const io = ioForProject({ source: null, rootPath: "/storage/emulated/0/myproj/", name: "MyApp" })!;
    expect(io.rootLabel()).toBe("MyApp");
  });

  it("什么都没有 → null（prompt 里就不出现工具段）", () => {
    expect(ioForProject({ source: null, rootPath: null })).toBeNull();
    expect(ioForProject(null)).toBeNull();
  });
});

/** 伪 window.AxvNative：验 ioFromRootPath 的 list/read 路径拼接（B2 的核心） */
describe("M64b 根路径拼接（伪 native bridge）", () => {
  function withFakeNative(handlers: {
    saveFile?: () => string;
    listDir?: (p: string) => string | null;
    readText?: (t: string) => string | null;
    writeText?: (t: string, b64: string) => string;
  }) {
    (globalThis as { window?: unknown }).window = {
      AxvNative: {
        saveFile: () => "ok:/tmp/x",
        getWorkspace: () => "/w",
        ...handlers,
      },
    };
  }

  it("list 与 read 都以根目录 + 相对路径为准", async () => {
    const seen: string[] = [];
    withFakeNative({
      listDir: (p) => {
        seen.push("list:" + p);
        return JSON.stringify({ ok: true, items: [{ name: "a.xml", kind: "file" }] });
      },
      readText: (t) => {
        seen.push("read:" + t);
        return "content";
      },
    });
    const io = ioForProject({ source: null, rootPath: "/custom/dir/", name: "P" })!;
    const l = await io.list("app/src");
    expect(l.ok).toBe(true);
    const r = await io.read("app/src/a.xml");
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["list:/custom/dir/app/src", "read:/custom/dir/app/src/a.xml"]);
    delete (globalThis as { window?: unknown }).window;
  });

  it("write 走 writeText 桥（base64），失败给人话", async () => {
    let written: { path: string; b64: string } | null = null;
    withFakeNative({
      saveFile: () => "ok:/tmp/x",
      writeText: (t, b64) => {
        written = { path: t, b64 };
        return "ok:/w/" + t;
      },
    });
    const io = ioForProject({ source: null, rootPath: "/custom/dir/", name: "P" })!;
    const w = await io.write("res/a.xml", "hello");
    expect(w).toEqual({ ok: true });
    expect(written!.path).toBe("/custom/dir/res/a.xml");
    expect(Buffer.from(written!.b64, "base64").toString("utf8")).toBe("hello");
    delete (globalThis as { window?: unknown }).window;
  });
});

/** 护栏：AiPanel 真的接上了 fileIo（别再偷偷用旧通道） */
describe("M64b 接线护栏（源码级）", () => {
  const read = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8");

  it("XmlEditor 把 ioForProject(activeProject) 传给 AiPanel", () => {
    const src = read("components/XmlEditor.tsx");
    expect(src).toContain("ioForProject(activeProject)");
    expect(src).toMatch(/<AiPanel[\s\S]*?fileIo=\{/);
  });

  it("AiPanel 的 fileIo 显式 null 时不再回退 createNativeIo", () => {
    const src = read("components/AiPanel.tsx");
    expect(src).toContain("fileIo !== undefined ? fileIo : createNativeIo(projectName || undefined)");
  });
});

export type _ExpectAiIo = AiFileIo;
