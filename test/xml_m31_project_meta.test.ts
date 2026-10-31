// @vitest-environment jsdom
// M31：项目名/图标读取 —— 名称取 res/values/strings.xml 的 app_name，
// 图标取 res/mipmap*|drawable* 里的 ic_launcher* 图片（网页走 DirHandle，APK 走 bridge 绝对路径）。
import { describe, it, expect, afterEach } from "vitest";
import {
  iconRank,
  pickBestIconName,
  iconCandidates,
  readProjectMetaFromSource,
  readProjectMetaNative,
  type ProjectSource,
} from "../lib/xml/project-browse";

const STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">演示应用</string>
    <string name="hello">Hello</string>
</resources>`;

function fakeSource(over: Partial<ProjectSource> & { files?: Record<string, string> }): ProjectSource {
  const files = over.files ?? {};
  return {
    name: over.name ?? "fallback",
    listChildren: over.listChildren ?? (async () => []),
    readText: over.readText ?? (async (rel) => files[rel] ?? null),
    appIconUrl: over.appIconUrl,
  };
}

describe("M31 图标名优先级", () => {
  it("ic_launcher 本体最优先，foreground 最后", () => {
    expect(iconRank("ic_launcher.png")).toBeLessThan(iconRank("ic_launcher_round.png"));
    expect(iconRank("ic_launcher_round.png")).toBeLessThan(iconRank("ic_launcher_foreground.png"));
    expect(iconRank("ic_launcher_foreground.png")).toBeLessThan(iconRank("splash.png"));
  });

  it("不相关的文件不参与", () => {
    expect(iconRank("bg_home.png")).toBe(99);
    expect(iconRank("ic_launcher.xml")).toBe(99);
  });

  it("pickBestIconName 从一堆文件里挑 ic_launcher", () => {
    const got = pickBestIconName(["bg.png", "ic_launcher_foreground.png", "ic_launcher_round.webp"]);
    expect(got).toBe("ic_launcher_round.webp");
  });

  it("pickBestIconName 没有候选时返回 null", () => {
    expect(pickBestIconName(["a.png", "b.xml"])).toBe(null);
  });

  it("iconCandidates 排好序且过滤无关文件", () => {
    const got = iconCandidates(["ic_launcher_foreground.png", "x.png", "ic_launcher.png"]);
    expect(got).toEqual(["ic_launcher.png", "ic_launcher_foreground.png"]);
  });
});

describe("M31 readProjectMetaFromSource", () => {
  it("读 app/src/main/res/values/strings.xml 的 app_name", async () => {
    const src = fakeSource({
      files: { "app/src/main/res/values/strings.xml": STRINGS },
      appIconUrl: async () => "blob:icon",
    });
    const meta = await readProjectMetaFromSource(src, "ProjectFolder");
    expect(meta.name).toBe("演示应用");
    expect(meta.iconUrl).toBe("blob:icon");
  });

  it("退到 res/values/strings.xml 也能读到", async () => {
    const src = fakeSource({ files: { "res/values/strings.xml": STRINGS } });
    const meta = await readProjectMetaFromSource(src, "ProjectFolder");
    expect(meta.name).toBe("演示应用");
    expect(meta.iconUrl).toBeUndefined();
  });

  it("没有 strings.xml 时回退目录名，且图标异常不外抛", async () => {
    const src = fakeSource({
      appIconUrl: async () => {
        throw new Error("no access");
      },
    });
    const meta = await readProjectMetaFromSource(src, "ProjectFolder");
    expect(meta.name).toBe("ProjectFolder");
    expect(meta.iconUrl).toBeUndefined();
  });

  it("strings.xml 没有 app_name 时也回退目录名", async () => {
    const src = fakeSource({
      files: { "app/src/main/res/values/strings.xml": '<resources><string name="hello">hi</string></resources>' },
    });
    const meta = await readProjectMetaFromSource(src, "FolderX");
    expect(meta.name).toBe("FolderX");
  });
});

describe("M31 readProjectMetaNative（APK 绝对路径直读）", () => {
  const bridgeReads: string[] = [];

  function installBridge(opts: { base64?: string | null } = {}) {
    bridgeReads.length = 0;
    (window as unknown as { AxvNative?: unknown }).AxvNative = {
      saveFile: () => "ok",
      getWorkspace: () => "AndroidUIIDE/Project",
      pickWorkspace: () => undefined,
      readText: (target: string) => {
        bridgeReads.push("text:" + target);
        return target.endsWith("/app/src/main/res/values/strings.xml") ? STRINGS : null;
      },
      readBase64: (target: string) => {
        bridgeReads.push("b64:" + target);
        if (opts.base64 === null) return null;
        return target.includes("mipmap-xxxhdpi/ic_launcher.png") ? (opts.base64 ?? "QUJD") : null;
      },
    };
  }

  afterEach(() => {
    delete (window as unknown as { AxvNative?: unknown }).AxvNative;
  });

  it("读 app_name 并用 ic_launcher 图片做 data URL", async () => {
    installBridge();
    const meta = await readProjectMetaNative("DemoFolder", "/storage/emulated/0/AndroidUIIDE/Project/DemoApp");
    expect(meta.name).toBe("演示应用");
    expect(meta.iconUrl).toBe("data:image/png;base64,QUJD");
    // 先读名字，再按 xxxhdpi 优先级试图标
    expect(bridgeReads[0]).toContain("app/src/main/res/values/strings.xml");
    expect(bridgeReads.some((r) => r.includes("mipmap-xxxhdpi"))).toBe(true);
  });

  it("图标都读不到时不设 iconUrl（回退通用图标）", async () => {
    installBridge({ base64: null });
    const meta = await readProjectMetaNative("DemoFolder", "/tmp/DemoApp");
    expect(meta.name).toBe("演示应用");
    expect(meta.iconUrl).toBeUndefined();
  });

  it("没有目录路径时只用回退名，不调 bridge", async () => {
    installBridge();
    const meta = await readProjectMetaNative("OnlyFolder", null);
    expect(meta.name).toBe("OnlyFolder");
    expect(bridgeReads.length).toBe(0);
  });

  it("结果按目录缓存，不重复读", async () => {
    installBridge();
    await readProjectMetaNative("A", "/tmp/CachedApp");
    const first = bridgeReads.length;
    await readProjectMetaNative("A", "/tmp/CachedApp");
    expect(bridgeReads.length).toBe(first);
  });
});
