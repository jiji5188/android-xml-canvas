// M45b：项目结构树支持浏览 main/java 下的 .java/.kt/.kts 文件
import { describe, it, expect } from "vitest";
import {
  isJavaDirRel,
  isJavaSrcName,
  webProjectSource,
  type ProjectSource,
} from "@/lib/xml/project-browse";

/* ---------- 假目录句柄 ---------- */
type FakeFile = { kind: "file"; name: string; text: string };
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
  addFile(path: string, text: string): void {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() as string;
    this.addDir(parts.join("/")).children.set(name, { kind: "file", name, text });
  }
  async getDirectoryHandle(name: string): Promise<FD> {
    const hit = this.children.get(name);
    if (!(hit instanceof FD)) throw new Error("not a dir");
    return hit;
  }
  async getFileHandle(name: string): Promise<{
    kind: "file";
    name: string;
    getFile(): Promise<{ text(): Promise<string>; name: string }>;
  }> {
    const f = this.children.get(name);
    if (!f || f instanceof FD) throw new Error("not a file");
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

describe("isJavaDirRel", () => {
  it("识别 main/java", () => {
    expect(isJavaDirRel("app/src/main/java")).toBe(true);
  });
  it("识别子包路径（java 在父级）", () => {
    expect(isJavaDirRel("app/src/main/java/com/example/myapp")).toBe(true);
  });
  it("识别 main/kotlin", () => {
    expect(isJavaDirRel("app/src/main/kotlin")).toBe(true);
  });
  it("res 目录不算", () => {
    expect(isJavaDirRel("app/src/main/res/layout")).toBe(false);
    expect(isJavaDirRel("res")).toBe(false);
  });
  it("空 rel 不算", () => {
    expect(isJavaDirRel("")).toBe(false);
  });
});

describe("isJavaSrcName", () => {
  it("识别 .java", () => {
    expect(isJavaSrcName("MainActivity.java")).toBe(true);
  });
  it("识别 .kt", () => {
    expect(isJavaSrcName("MainViewModel.kt")).toBe(true);
  });
  it("识别 .kts", () => {
    expect(isJavaSrcName("script.kts")).toBe(true);
  });
  it("xml 不算", () => {
    expect(isJavaSrcName("layout.xml")).toBe(false);
  });
});

describe("webProjectSource：main/java 目录浏览", () => {
  const src = fakeSource({
    "app/src/main/java/com/example/app/MainActivity.java": "class MainActivity {}",
    "app/src/main/java/com/example/app/MyFragment.kt": "class MyFragment",
    "app/src/main/java/com/example/app/adapter/ItemAdapter.kt": "class ItemAdapter",
    "app/src/main/res/layout/activity_main.xml": "<a/>",
    "app/build.gradle.kts": "plugins {}",
  });

  it("java 目录下列出 .java/.kt/.kts 文件", async () => {
    const kids = await src.listChildren("app/src/main/java/com/example/app");
    const names = kids.map((k) => k.name);
    expect(names).toContain("MainActivity.java");
    expect(names).toContain("MyFragment.kt");
    expect(names).toContain("adapter"); // 子目录
    // build.gradle.kts 不在 java 目录，不该出现
    expect(names).not.toContain("build.gradle.kts");
  });

  it("readText 能读 .java 文件", async () => {
    const text = await src.readText("app/src/main/java/com/example/app/MainActivity.java");
    expect(text).toBe("class MainActivity {}");
  });

  it("res 目录依然只列 xml 文件（.java 过滤掉）", async () => {
    // res/layout 下没有 java 文件，正常
    const kids = await src.listChildren("app/src/main/res/layout");
    expect(kids.map((k) => k.name)).toEqual(["activity_main.xml"]);
  });
});
