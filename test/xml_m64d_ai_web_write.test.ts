// test/xml_m64d_ai_web_write.test.ts — M64d（B1）：浏览器版 AI 写能力 + 能力角标
//
// 以前 ioFromProjectSource 的 write 只认 rootPath（native），web 项目一律「没有可写根路径」；
// 现在有项目根 DirHandle（FSA）就用 getDirectoryHandle(create) + getFileHandle(create) + createWritable。
import { describe, expect, it } from "vitest";
import { ioForProject, ioFromProjectSource, ioFromRootPath } from "@/lib/xml/ai-fs";
import type { ProjectSource } from "@/lib/xml/project-browse";

/** 内存版 FSA：够模拟 getDirectoryHandle / getFileHandle / createWritable */
type FakeFile = { kind: "file"; name: string; text: string };
type FakeDir = {
  kind: "directory";
  name: string;
  dirs: Map<string, FakeDir>;
  files: Map<string, FakeFile>;
};

function newDir(name: string): FakeDir {
  return { kind: "directory", name, dirs: new Map(), files: new Map() };
}

function fsaRoot(opts?: { denyWrite?: boolean }) {
  const root = newDir("");
  const dirHandle = (d: FakeDir): unknown => ({
    getDirectoryHandle: async (name: string, o?: { create?: boolean }) => {
      let c = d.dirs.get(name);
      if (!c) {
        if (!o?.create) throw new Error("NotFoundError");
        c = newDir(name);
        d.dirs.set(name, c);
      }
      return dirHandle(c);
    },
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      let f = d.files.get(name);
      if (!f) {
        if (!o?.create) throw new Error("NotFoundError");
        f = { kind: "file", name, text: "" };
        d.files.set(name, f);
      }
      const file = f;
      return {
        createWritable: async () => {
          if (opts?.denyWrite) throw new Error("NotAllowedError: permission denied");
          return {
            write: async (t: string) => {
              file.text += t;
            },
            close: async () => {},
          };
        },
      };
    },
  });
  return { root, handle: dirHandle(root) };
}

function fakeSource(over: Partial<ProjectSource> = {}): ProjectSource {
  return {
    name: "Demo",
    listChildren: async () => [],
    readText: async () => null,
    ...over,
  };
}

describe("M64d（B1）web 写入", () => {
  it("有 DirHandle：canWrite=true，能创建多级目录并写文件", async () => {
    const { root, handle } = fsaRoot();
    const io = ioFromProjectSource(fakeSource(), handle);
    expect(io).not.toBeNull();
    expect(io!.canWrite).toBe(true);
    const r = await io!.write("res/values/strings.xml", "<resources/>");
    expect(r.ok).toBe(true);
    expect(root.dirs.get("res")?.dirs.get("values")?.files.get("strings.xml")?.text).toBe("<resources/>");
  });

  it("没有 DirHandle：canWrite=false，写入报清楚原因", async () => {
    const io = ioFromProjectSource(fakeSource());
    expect(io!.canWrite).toBe(false);
    const r = await io!.write("a.xml", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("可写根路径");
  });

  it("浏览器拒绝授权 → 人话提示（不是裸 NotAllowedError）", async () => {
    const { handle } = fsaRoot({ denyWrite: true });
    const io = ioFromProjectSource(fakeSource(), handle)!;
    const r = await io.write("a.xml", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("权限");
  });

  it("ioForProject 把 handle 传下去（编辑器只需给 activeProject）", () => {
    const { handle } = fsaRoot();
    const io = ioForProject({ source: fakeSource(), handle, name: "Demo" });
    expect(io!.canWrite).toBe(true);
  });

  it("native 根路径仍然可写（两条路都活）", () => {
    const io = ioFromRootPath("/storage/emulated/0/Demo", "Demo");
    expect(io!.canWrite).toBe(true);
    expect(io!.rootLabel()).toBe("Demo");
  });

  it("什么都没有 → null（prompt 里工具段整段不出现）", () => {
    expect(ioForProject({ source: null })).toBeNull();
    expect(ioForProject(null)).toBeNull();
  });
});
