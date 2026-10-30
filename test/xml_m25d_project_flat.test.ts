// M25d：项目列表扁平化 + 项目结构懒加载 + 名称/图标分析
import { describe, it, expect } from "vitest";
import {
  findMainLayout,
  nativeProjectSource,
  parseAppName,
  readProjectMeta,
  webProjectSource,
  type BrowseEntry,
  type ProjectSource,
} from "@/lib/xml/project-browse";
import type { WsProject } from "@/lib/xml/workspace";

/* ---------- 假目录句柄（只实现用到的部分） ---------- */

type FakeFile = { kind: "file"; name: string; text: string };

class FD {
  kind = "directory" as const;
  children = new Map<string, FD | FakeFile>();
  constructor(public name: string) {}
  dir(name: string): FD {
    const hit = this.children.get(name);
    if (!(hit instanceof FD)) throw new Error("not a dir");
    return hit;
  }
  file(name: string): FakeFile {
    const hit = this.children.get(name);
    if (!hit || hit instanceof FD) throw new Error("not a file");
    return hit;
  }
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
  addFile(path: string, text: string): void {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() as string;
    this.addDir(parts.join("/")).children.set(name, { kind: "file", name, text });
  }
  async getDirectoryHandle(name: string): Promise<FD> {
    return this.dir(name);
  }
  async getFileHandle(name: string): Promise<{
    kind: "file";
    name: string;
    getFile(): Promise<{ text(): Promise<string>; name: string }>;
  }> {
    const f = this.file(name);
    return {
      kind: "file",
      name: f.name,
      async getFile() {
        return { text: async () => f.text, name: f.name };
      },
    };
  }
  async *values() {
    for (const v of this.children.values()) yield v;
  }
}

const fakeSource = (files: Record<string, string>): ProjectSource => {
  const root = new FD("proj");
  for (const [k, v] of Object.entries(files)) root.addFile(k, v);
  return webProjectSource(root, "proj");
};

describe("parseAppName", () => {
  it("取双引号 app_name", () => {
    expect(parseAppName('<resources><string name="app_name">我的应用</string></resources>')).toBe("我的应用");
  });
  it("取单引号 + 其它属性", () => {
    expect(parseAppName("<string translatable='false' name='app_name'>Demo</string>")).toBe("Demo");
  });
  it("解实体", () => {
    expect(parseAppName('<string name="app_name">A &amp; B</string>')).toBe("A & B");
  });
  it("没有就 null", () => {
    expect(parseAppName('<string name="other">x</string>')).toBeNull();
    expect(parseAppName("")).toBeNull();
  });
});

describe("webProjectSource：只列一层 + 懒加载", () => {
  const src = fakeSource({
    "app/src/main/res/layout/activity_main.xml": "<LinearLayout/>",
    "app/src/main/res/layout/detail.xml": "<FrameLayout/>",
    "app/src/main/res/values/strings.xml": '<resources><string name="app_name">招聘助手</string></resources>',
    "app/src/main/res/mipmap-hdpi/ic_launcher.png": "PNG",
    "gradle/wrapper/x.txt": "noise",
    "notes.md": "ignore",
    "root.xml": "<x/>",
  });

  it("根目录只给直接子项，跳过非 xml 文件", async () => {
    const kids = await src.listChildren("");
    expect(kids.map((k) => k.kind + ":" + k.name)).toEqual(["dir:app", "dir:gradle", "file:root.xml"]);
  });

  it("目录优先排序 + 跳过 build/.git", async () => {
    const s2 = fakeSource({ "b.xml": "", "a.xml": "", "build/x.xml": "", ".git/y.xml": "", "zzz/q.xml": "" });
    const kids = await s2.listChildren("");
    expect(kids.map((k) => k.name)).toEqual(["zzz", "a.xml", "b.xml"]);
  });

  it("按 rel 下钻读目录 / 读文件", async () => {
    const kids = await src.listChildren("app/src/main/res/layout");
    expect(kids.map((k) => k.name)).toEqual(["activity_main.xml", "detail.xml"]);
    expect(await src.readText("app/src/main/res/layout/detail.xml")).toBe("<FrameLayout/>");
  });

  it("不存在返回空 / null", async () => {
    expect(await src.listChildren("nope/deep")).toEqual([]);
    expect(await src.readText("nope.xml")).toBeNull();
  });
});

describe("nativeProjectSource：扁平 rel 列表过滤出一层", () => {
  const all: WsProject[] = [
    { name: "proj", kind: "dir", rel: "proj", layoutCount: 0 },
    { name: "res", kind: "dir", rel: "proj/res", layoutCount: 0 },
    { name: "layout", kind: "dir", rel: "proj/res/layout", layoutCount: 2 },
    { name: "activity_main.xml", kind: "file", rel: "proj/res/layout/activity_main.xml", layoutCount: 1, target: "/s/proj/res/layout/activity_main.xml" },
    { name: "detail.xml", kind: "file", rel: "proj/res/layout/detail.xml", layoutCount: 1, target: "/s/proj/res/layout/detail.xml" },
  ];
  const src = nativeProjectSource("proj", all);

  it("列根：只有 res", async () => {
    expect((await src.listChildren("proj")).map((e) => e.rel)).toEqual(["proj/res"]);
  });
  it("列 layout：两个文件，带 target", async () => {
    const kids = await src.listChildren("proj/res/layout");
    expect(kids.map((e) => e.name)).toEqual(["activity_main.xml", "detail.xml"]);
    expect(kids[0].target).toBe("/s/proj/res/layout/activity_main.xml");
  });
});

describe("findMainLayout", () => {
  it("常见路径直接命中", async () => {
    const src = fakeSource({ "app/src/main/res/layout/activity_main.xml": "<a/>" });
    const hit: BrowseEntry | null = await findMainLayout(src);
    expect(hit?.rel).toBe("app/src/main/res/layout/activity_main.xml");
  });

  it("路径不常见时浅层 BFS 兜底", async () => {
    const src = fakeSource({ "ui/layout/home_main.xml": "<a/>", "ui/layout/zzz.xml": "<b/>" });
    const hit = await findMainLayout(src);
    expect(hit?.rel).toBe("ui/layout/home_main.xml");
  });

  it("没有 main 命名的就返回 null", async () => {
    const src = fakeSource({ "layout/login.xml": "<a/>" });
    expect(await findMainLayout(src)).toBeNull();
  });
});

describe("readProjectMeta：名称 + 图标", () => {
  const build = () => {
    const root = new FD("DemoApp");
    root.addFile("app/src/main/res/values/strings.xml", '<resources><string name="app_name">招聘助手</string></resources>');
    root.addFile("app/src/main/res/mipmap-hdpi/ic_launcher.png", "PNG");
    root.addFile("app/src/main/res/layout/activity_main.xml", "<a/>");
    return root;
  };

  it("读 strings.xml 的 app_name", async () => {
    const meta = await readProjectMeta(build(), "DemoApp");
    expect(meta.name).toBe("招聘助手");
  });

  it("读不到 strings.xml 时回落到目录名", async () => {
    const root = new FD("Plain");
    root.addFile("layout/a.xml", "<a/>");
    const meta = await readProjectMeta(root, "Plain");
    expect(meta.name).toBe("Plain");
  });

  it("没有句柄不炸", async () => {
    expect(await readProjectMeta(null, "X")).toEqual({ name: "X" });
  });
});
