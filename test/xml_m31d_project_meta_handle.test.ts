// @vitest-environment jsdom
// M31d：用假 DirHandle 树跑一遍 readProjectMeta —— 证明「项目列表卡片」能拿到
// strings.xml 里的 app_name 和 res/mipmap-xxhdpi/ic_launcher.png 图标。
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readProjectMeta } from "../lib/xml/project-browse";

type FakeFile = {
  name: string;
  kind: "file";
  getFile: () => Promise<File>;
};
type FakeDir = {
  name: string;
  kind: "directory";
  values: () => AsyncGenerator<FakeFile | FakeDir, void, unknown>;
  getFileHandle: (n: string) => Promise<FakeFile>;
  getDirectoryHandle: (n: string) => Promise<FakeDir>;
};

function fdir(name: string, children: Record<string, FakeFile | FakeDir>): FakeDir {
  return {
    name,
    kind: "directory",
    async *values() {
      for (const v of Object.values(children)) yield v;
    },
    async getFileHandle(n: string) {
      const f = children[n];
      if (!f || f.kind !== "file") throw new Error("ENOENT " + n);
      return f;
    },
    async getDirectoryHandle(n: string) {
      const d = children[n];
      if (!d || d.kind !== "directory") throw new Error("ENOENT " + n);
      return d;
    },
  };
}

function ffile(name: string, content: string): FakeFile {
  return {
    name,
    kind: "file",
    async getFile() {
      return new File([content], name, { type: name.endsWith(".png") ? "image/png" : "text/plain" });
    },
  };
}

const STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources><string name="app_name">仓库助手</string></resources>`;

function makeProject(): FakeDir {
  return fdir("仓库助手", {
    app: fdir("app", {
      src: fdir("src", {
        main: fdir("main", {
          res: fdir("res", {
            values: fdir("values", { "strings.xml": ffile("strings.xml", STRINGS) }),
            "mipmap-xxhdpi": fdir("mipmap-xxhdpi", {
              "ic_launcher.png": ffile("ic_launcher.png", "fake-png-bytes"),
              "ic_launcher_round.png": ffile("ic_launcher_round.png", "fake-png-bytes"),
            }),
            "mipmap-anydpi-v26": fdir("mipmap-anydpi-v26", {
              // 自适应图标描述文件：不是图片，必须被排除
              "ic_launcher.xml": ffile("ic_launcher.xml", "<adaptive-icon/>"),
            }),
          }),
        }),
      }),
    }),
  });
}

beforeAll(() => {
  // jsdom 没有 createObjectURL，这里给个确定值方便断言
  (URL as unknown as { createObjectURL: (f: unknown) => string }).createObjectURL = vi.fn(
    () => "blob:fake-icon",
  );
});
afterAll(() => {
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
});

describe("M31d readProjectMeta（DirHandle 树）", () => {
  it("拿到 app_name 与 ic_launcher 图标", async () => {
    const meta = await readProjectMeta(makeProject(), "仓库助手");
    expect(meta.name).toBe("仓库助手");
    expect(meta.iconUrl).toBe("blob:fake-icon");
  });

  it("没有 strings.xml 时回退目录名", async () => {
    const root = fdir("裸目录", { app: fdir("app", {}) });
    const meta = await readProjectMeta(root, "裸目录");
    expect(meta.name).toBe("裸目录");
    expect(meta.iconUrl).toBeUndefined();
  });

  it("有图标没有 strings.xml 时只回退名字，图标照给", async () => {
    const root = fdir("只有图标", {
      res: fdir("res", {
        "mipmap-hdpi": fdir("mipmap-hdpi", { "ic_launcher.png": ffile("ic_launcher.png", "x") }),
      }),
    });
    const meta = await readProjectMeta(root, "只有图标");
    expect(meta.name).toBe("只有图标");
    expect(meta.iconUrl).toBe("blob:fake-icon");
  });
});
