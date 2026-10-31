// test/xml_m31h_icon_dir.test.ts — M31h：drawable/mipmap 目录判定 + 图片行缩略图
import { describe, expect, it } from "vitest";
import {
  isIconDirRel,
  isImageName,
  pickBestIconName,
  readEntryImageUrl,
  nativeProjectSource,
  webProjectSource,
} from "@/lib/xml/project-browse";
import type { WsProject } from "@/lib/xml/workspace";

describe("isIconDirRel", () => {
  it("drawable / mipmap 及其密度桶都算图标目录", () => {
    expect(isIconDirRel("app/src/main/res/drawable")).toBe(true);
    expect(isIconDirRel("app/src/main/res/drawable-xxhdpi")).toBe(true);
    expect(isIconDirRel("app/src/main/res/mipmap-anydpi-v26")).toBe(true);
    expect(isIconDirRel("app/src/main/res/mipmap-hdpi/")).toBe(true);
  });

  it("layout / values / 名字里带 drawable 的普通目录不算", () => {
    expect(isIconDirRel("app/src/main/res/layout")).toBe(false);
    expect(isIconDirRel("app/src/main/res/values")).toBe(false);
    expect(isIconDirRel("res")).toBe(false);
    expect(isIconDirRel("src/main/java/com/x/drawablehelper")).toBe(false);
  });
});

describe("isImageName / pickBestIconName", () => {
  it("只认位图扩展名", () => {
    expect(isImageName("ic_launcher.png")).toBe(true);
    expect(isImageName("a.WEBP")).toBe(true);
    expect(isImageName("bg.jpg")).toBe(true);
    expect(isImageName("ic_launcher.xml")).toBe(false);
    expect(isImageName("notes.txt")).toBe(false);
  });

  it("选图标时 ic_launcher.xml 不会被当成图片", () => {
    expect(pickBestIconName(["ic_launcher.xml", "ic_launcher_round.png", "ic_launcher.png"])).toBe("ic_launcher.png");
    expect(pickBestIconName(["ic_launcher.xml"])).toBe(null);
  });
});

describe("readEntryImageUrl", () => {
  it("非图片直接返回 null（不去读文件）", async () => {
    expect(await readEntryImageUrl({ kind: "file", name: "activity_main.xml", rel: "a/activity_main.xml" })).toBe(null);
  });

  it("web 句柄：getFile 拿到 Blob → objectURL", async () => {
    const fh = {
      kind: "file" as const,
      name: "ic_launcher.png",
      getFile: async () => new Blob(["x"], { type: "image/png" }),
    };
    const url = await readEntryImageUrl({ kind: "file", name: "ic_launcher.png", rel: "r/ic_launcher.png", handle: fh });
    expect(url).toMatch(/^blob:/);
  });
});

describe("webProjectSource：drawable/mipmap 里的图片也列出来", () => {
  const file = (name: string) => ({ kind: "file" as const, name, getFile: async () => new Blob([name]) });
  const dir = (name: string, kids: unknown[]) => ({
    kind: "directory" as const,
    name,
    async *values() {
      for (const k of kids) yield k;
    },
    async getDirectoryHandle(n: string) {
      const hit = kids.find((k) => (k as { name: string }).name === n);
      if (!hit) throw new Error("no " + n);
      return hit as never;
    },
    async getFileHandle(n: string) {
      const hit = kids.find((k) => (k as { name: string }).name === n);
      if (!hit) throw new Error("no " + n);
      return hit as never;
    },
  });

  it("drawable 下 png 进列表，layout 下 png 不进", async () => {
    const drawable = dir("drawable", [file("ic_launcher.png"), file("bg.xml"), file("readme.txt")]);
    const layout = dir("layout", [file("main.xml"), file("preview.png")]);
    const res = dir("res", [drawable, layout]);
    const root = dir("Demo", [res]);
    const src = webProjectSource(root, "Demo");
    const r = await src.listChildren("res");
    expect(r.map((e) => e.name)).toEqual(["drawable", "layout"]);
    const d = await src.listChildren("res/drawable");
    expect(d.map((e) => e.name)).toEqual(["bg.xml", "ic_launcher.png"]);
    const l = await src.listChildren("res/layout");
    expect(l.map((e) => e.name)).toEqual(["main.xml"]);
  });
});

describe("nativeProjectSource + listDir", () => {
  const all: WsProject[] = [
    { name: "app", kind: "dir", rel: "app", layoutCount: 0 },
    { name: "activity_main.xml", kind: "file", rel: "app/src/main/res/layout/activity_main.xml", layoutCount: 0 },
  ];

  it("拿不到 listDir 时退回扁平列表（只有 xml）", async () => {
    const src = nativeProjectSource("Demo", all, "/sdcard/AndroidUIIDE/Project/Demo");
    const top = await src.listChildren("");
    expect(top.map((e) => e.name)).toEqual(["app"]);
  });

  it("bridge.listDir 可用时按真实目录列，drawable 里图片也列出来", async () => {
    const calls: string[] = [];
    (globalThis as unknown as { window: unknown }).window = {
      AxvNative: {
        saveFile: () => "ok",
        getWorkspace: () => "x",
        pickWorkspace: () => {},
        listDir: (p: string) => {
          calls.push(p);
          if (p.endsWith("/drawable")) {
            return JSON.stringify({
              ok: true,
              items: [
                { name: "ic_launcher.png", kind: "file", path: `${p}/ic_launcher.png` },
                { name: "notes.txt", kind: "file", path: `${p}/notes.txt` },
              ],
            });
          }
          if (p.endsWith("/layout")) {
            return JSON.stringify({
              ok: true,
              items: [{ name: "main.xml", kind: "file", path: `${p}/main.xml` }],
            });
          }
          return JSON.stringify({ ok: true, items: [{ name: "drawable", kind: "dir", path: `${p}/drawable` }] });
        },
      },
    };
    const src = nativeProjectSource("Demo", [], "/sdcard/AndroidUIIDE/Project/Demo");
    const top = await src.listChildren("");
    expect(top.map((e) => e.name)).toEqual(["drawable"]);
    const drawable = await src.listChildren("drawable");
    // 图片留下，txt 过滤掉；图片带绝对路径 target（供 readBase64 读缩略图）
    expect(drawable.map((e) => e.name)).toEqual(["ic_launcher.png"]);
    expect(drawable[0].target).toBe("/sdcard/AndroidUIIDE/Project/Demo/drawable/ic_launcher.png");
    expect(calls[1]).toBe("/sdcard/AndroidUIIDE/Project/Demo/drawable");
  });
});
