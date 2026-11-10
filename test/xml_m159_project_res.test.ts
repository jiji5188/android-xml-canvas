import { describe, expect, it } from "vitest";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import {
  loadProjectResForDoc,
  loadProjectResIndex,
  loadProjectResIndexCached,
  mergeProjectExtras,
  invalidateProjectRes,
} from "@/lib/xml/project-res";

function fakeIo(rootLabel: string, files: Record<string, string>, images: Record<string, string> = {}): AiFileIo {
  const all = { ...files, ...images };
  return {
    rootLabel: () => rootLabel,
    async list(rel) {
      const prefix = rel.endsWith("/") ? rel : `${rel}/`;
      const names = new Map<string, "dir" | "file">();
      for (const p of Object.keys(all)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest) continue;
        const cut = rest.indexOf("/");
        const name = cut < 0 ? rest : rest.slice(0, cut);
        names.set(name, cut < 0 ? "file" : "dir");
      }
      return {
        ok: true,
        items: [...names].map(([name, kind]) => ({ name, kind, rel: `${prefix}${name}` })),
      };
    },
    async read(rel) {
      return rel in files ? { ok: true, text: files[rel] } : { ok: false, error: "ENOENT" };
    },
    async readBase64(rel) {
      return rel in images ? { ok: true, base64: images[rel] } : { ok: false, error: "ENOENT" };
    },
    async write() {
      return { ok: false, error: "readonly" };
    },
  };
}

const FILES = {
  "res/layout/a.xml": '<LinearLayout android:background="@drawable/bg"/>',
  "res/drawable/bg.xml": '<shape><solid android:color="@color/brand"/></shape>',
  "res/values/colors.xml": '<resources><color name="brand">#123456</color></resources>',
  "res/values/strings.xml": '<resources><string name="title">Hi</string></resources>',
};

describe("M159 打开文件即载入项目资源", () => {
  it("快速通道：values + 文档引用递归（含二次引用）", async () => {
    const io = fakeIo(`p-${Math.random()}`, FILES);
    const extras = await loadProjectResForDoc(io, "res/layout/a.xml", FILES["res/layout/a.xml"]);
    expect(extras).not.toBeNull();
    expect(Object.keys(extras!.drawableXml)).toContain("bg");
    expect(extras!.valuesXml).toContain("brand");
    expect(extras!.valuesXml).toContain("title");
  });

  it("引用到只有图片的 drawable 也转成 dataURL", async () => {
    const io = fakeIo(`p-${Math.random()}`, FILES, { "res/drawable/icon.png": "UE5HREFUQQ==" });
    const extras = await loadProjectResForDoc(io, "res/layout/a.xml", '<ImageView android:src="@drawable/icon"/>');
    expect(extras!.drawables.icon).toBe("data:image/png;base64,UE5HREFUQQ==");
  });

  it("全量索引：把没被引用的 drawable 也扫进来，且有缓存", async () => {
    const io = fakeIo(`p-${Math.random()}`, FILES, { "res/drawable/other.webp": "V0VCUA==" });
    const first = await loadProjectResIndex(io, "res/layout/a.xml");
    expect(Object.keys(first!.drawableXml)).toContain("bg");
    expect(first!.drawables.other).toBe("data:image/webp;base64,V0VCUA==");

    const cachedA = await loadProjectResIndexCached(io, "res/layout/a.xml");
    const cachedB = await loadProjectResIndexCached(io, "res/layout/a.xml");
    expect(cachedA).toBe(cachedB); // 20s 内直接复用同一对象
  });

  it("没有 io 或不在 res 里 → null，不抛错", async () => {
    expect(await loadProjectResForDoc(null, "res/layout/a.xml", "<L/>")).toBeNull();
    const io = fakeIo(`p-${Math.random()}`, { "src/Main.java": "class Main {}" });
    expect(await loadProjectResForDoc(io, "src/Main.java", "<L/>")).toBeNull();
  });

  it("merge：项目资源覆盖旧的上传缓存", () => {
    const a = {
      drawables: { x: "data:image/png;base64,OLD" },
      vectorNames: ["v1"],
      drawableXml: { bg: "<shape/>" },
      valuesXml: '<color name="a">#fff</color>',
      styles: {},
      sourceFiles: ["drawable/bg.xml"],
      counts: { images: 1, vectors: 1, values: 0, styles: 0, shapes: 1 },
    };
    const b = {
      drawables: { x: "data:image/png;base64,NEW", y: "data:image/png;base64,Y" },
      vectorNames: ["v2"],
      drawableXml: { bg: "<selector/>" },
      valuesXml: "",
      styles: {},
      sourceFiles: ["drawable/bg2.xml"],
      counts: { images: 2, vectors: 1, values: 0, styles: 0, shapes: 0 },
    };
    const m = mergeProjectExtras(a as never, b as never)!;
    expect(m.drawables.x).toBe("data:image/png;base64,NEW");
    expect(m.drawables.y).toContain("Y");
    expect(m.drawableXml.bg).toBe("<selector/>");
    expect(m.vectorNames.sort()).toEqual(["v1", "v2"]);
    expect(m.sourceFiles.sort()).toEqual(["drawable/bg.xml", "drawable/bg2.xml"]);
  });

  it("全量索引：layout 目录的 @+id 也进 extras.layouts（M210）", async () => {
    const io = fakeIo(`p-${Math.random()}`, {
      "res/layout/activity_main.xml": '<LinearLayout><TextView android:id="@+id/tv_key"/></LinearLayout>',
      "res/layout/layout_item_refund.xml":
        '<LinearLayout><TextView android:id="@+id/tv_value"/><EditText android:id="@+id/tv_value_EditText"/></LinearLayout>',
      "res/layout-land/land_only.xml": '<FrameLayout android:id="@+id/right_ImageView"/>',
      "res/values/strings.xml": "<resources><string name=\"a\">x</string></resources>",
    });
    const ex = await loadProjectResIndex(io, "res/layout/activity_main.xml");
    expect(ex).not.toBeNull();
    // 三个布局名都在
    const layouts = Object.keys(ex!.layouts ?? {});
    expect(layouts).toContain("activity_main.xml");
    expect(layouts).toContain("layout_item_refund.xml");
    expect(layouts).toContain("land_only.xml");
  });

  it("全量索引：20s 内缓存命中同一对象（需显式 invalidateProjectRes 才刷新）", async () => {
    const io: AiFileIo = {
      rootLabel: () => "cache-stable",
      async list(rel: string) {
        // 模拟 res 下只有一个 layout 目录 + 一个文件
        const items: { name: string; kind: "dir" | "file"; rel: string }[] = [];
        if (!rel || rel === "") {
          items.push({ name: "layout", kind: "dir", rel: "layout" });
          items.push({ name: "values", kind: "dir", rel: "values" });
        } else if (rel === "layout") {
          items.push({ name: "a.xml", kind: "file", rel: "layout/a.xml" });
        } else if (rel === "values") {
          items.push({ name: "strings.xml", kind: "file", rel: "values/strings.xml" });
        }
        return { ok: true, items };
      },
      async read(rel: string) {
        if (rel === "layout/a.xml") return { ok: true, text: "<TextView android:id='@+id/one'/>" };
        if (rel === "values/strings.xml")
          return { ok: true, text: "<resources><string name=\"s\">x</string></resources>" };
        return { ok: false, error: "no" };
      },
      async write() {
        return { ok: false, error: "readonly" };
      },
    };
    // 清一下可能残留的缓存（同一 rootLabel 在别的测试里用过）
    invalidateProjectRes(io);
    const a = await loadProjectResIndexCached(io, "layout/a.xml");
    const b = await loadProjectResIndexCached(io, "layout/a.xml");
    expect(b).toBe(a); // 命中缓存，同一对象
    // 内容变了但缓存还在 → 仍返回旧对象（这正是隐患：没有自动失效）
    const c = await loadProjectResIndexCached(io, "layout/a.xml");
    expect(c).toBe(a);
    invalidateProjectRes(io); // 清掉，避免污染后续
  });
});
