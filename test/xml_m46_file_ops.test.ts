// M46：文件操作纯函数 + web 后端 createEntry（假 DirHandle）
import { describe, it, expect } from "vitest";
import {
  createEntry,
  deleteEntry,
  hasNameAmong,
  renameEntry,
  suggestUniqueName,
  type FileOpsCtx,
} from "@/lib/xml/file-ops";

describe("hasNameAmong", () => {
  it("命中", () => {
    expect(hasNameAmong([{ name: "a.xml" }, { name: "b.xml" }], "a.xml")).toBe(true);
    expect(hasNameAmong([], "x")).toBe(false);
    expect(hasNameAmong(undefined, "x")).toBe(false);
  });
  it("可选 name（native 解析出的）", () => {
    expect(hasNameAmong([{ name: "a" }, { name: undefined }], "a")).toBe(true);
  });
});

describe("suggestUniqueName", () => {
  it("无冲突原名", () => {
    expect(suggestUniqueName("a.xml", new Set(["b.xml"]))).toBe("a.xml");
  });
  it("冲突加序号", () => {
    expect(suggestUniqueName("a.xml", new Set(["a.xml"]))).toBe("a(1).xml");
  });
  it("多冲突", () => {
    expect(suggestUniqueName("a.xml", new Set(["a.xml", "a(1).xml"]))).toBe("a(2).xml");
  });
  it("无扩展名", () => {
    expect(suggestUniqueName("dir", new Set(["dir"]))).toBe("dir(1)");
  });
});

/* ---- 假 DirHandle（FSA 形状） ---- */
type FakeFile = { kind: "file"; name: string; text: string; created?: boolean };
class FD {
  kind = "directory" as const;
  children = new Map<string, FD | FakeFile>();
  constructor(public name: string) {}
  addDir(path: string): FD {
    const parts = path.split("/").filter(Boolean);
    let cur: FD = this;
    for (const p of parts) {
      let next = cur.children.get(p);
      if (!(next instanceof FD)) {
        next = new FD(p);
        cur.children.set(p, next);
      }
      cur = next;
    }
    return cur;
  }
  dir(name: string): FD {
    let cur: FD = this;
    for (const p of name.split("/").filter(Boolean)) {
      const hit = cur.children.get(p);
      if (!(hit instanceof FD)) throw new Error("not a dir: " + name);
      cur = hit;
    }
    return cur;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FD> {
    const hit = this.children.get(name);
    if (hit instanceof FD) return hit;
    if (opts?.create) {
      const d = new FD(name);
      this.children.set(name, d);
      return d;
    }
    throw new Error("no such dir");
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(d?: string): Promise<void>; close(): Promise<void> }>;
  }> {
    const hit = this.children.get(name);
    if (hit && !(hit instanceof FD)) return wrap(hit);
    if (opts?.create) {
      const f: FakeFile = { kind: "file", name, text: "", created: true };
      this.children.set(name, f);
      return wrap(f);
    }
    throw new Error("no such file");
    function wrap(f: FakeFile) {
      return {
        async createWritable() {
          return {
            async write(d?: string) {
              f.text = d ?? f.text;
            },
            async close() {},
          };
        },
      };
    }
  }
  async *values() {
    for (const v of this.children.values()) yield v;
  }
}

const web = (root: FD): FileOpsCtx => ({ backend: "web", root });

describe("createEntry（web 假句柄）", () => {
  it("建文件", async () => {
    const root = new FD("proj");
    root.addDir("res/layout");
    const r = await createEntry(web(root), { parentRel: "res/layout", name: "new.xml", isDir: false });
    expect(r.ok).toBe(true);
    expect(r.newRel).toBe("res/layout/new.xml");
    expect(root.dir("res/layout").children.has("new.xml")).toBe(true);
  });
  it("建目录", async () => {
    const root = new FD("proj");
    const r = await createEntry(web(root), { parentRel: "res", name: "menu", isDir: true });
    expect(r.ok).toBe(true);
    expect(root.dir("res").children.has("menu")).toBe(true);
  });
  it("空名拒绝", async () => {
    const root = new FD("proj");
    const r = await createEntry(web(root), { parentRel: "", name: "  ", isDir: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("名称为空");
  });
  it("名称含 / 拒绝", async () => {
    const root = new FD("proj");
    const r = await createEntry(web(root), { parentRel: "", name: "a/b", isDir: false });
    expect(r.ok).toBe(false);
  });
});

describe("web 后端写操作 → reason web", () => {
  it("重命名/删除不支持", async () => {
    const root = new FD("proj");
    const ctx = web(root);
    expect((await renameEntry(ctx, "a.xml", "b.xml")).reason).toBe("web");
    expect((await deleteEntry(ctx, "a.xml", false)).reason).toBe("web");
  });
});
