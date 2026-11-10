// test/xml_m212_apk_repack.test.ts — M212：导入 APK 换资源重签 + 打包插件注册表
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasApkRepack,
  isReplaceableEntry,
  listApkEntries,
  pickApk,
  repackApk,
} from "@/lib/xml/apk-repack";
import {
  __clearBuildPipelines,
  availableBuildPipelines,
  getBuildPipeline,
  listBuildPipelines,
  registerBuildPipeline,
  type BuildPipeline,
} from "@/lib/xml/build-pipeline";

interface WinShape {
  AxvNative?: Record<string, unknown>;
  __axvPickedApk?: (path: string, result: string) => void;
  __axvRepackApk?: (id: string, json: string) => void;
}
/** window 上已经声明了 AxvNative（AxvNativeBridge），测试里用 unknown 绕开，别和全局声明打架 */
const W = () => window as unknown as WinShape;

afterEach(() => {
  delete W().AxvNative;
  delete W().__axvPickedApk;
  delete W().__axvRepackApk;
  __clearBuildPipelines();
});

describe("M212 isReplaceableEntry", () => {
  it("图片能换", () => {
    expect(isReplaceableEntry("res/drawable-xhdpi/icon.png")).toBe(true);
    expect(isReplaceableEntry("res/mipmap-anydpi-v26/ic_launcher.webp")).toBe(true);
    expect(isReplaceableEntry("res/drawable/bg.9.png")).toBe(true);
  });

  it("编译过的 XML 不能换", () => {
    expect(isReplaceableEntry("res/layout/activity_main.xml")).toBe(false);
    expect(isReplaceableEntry("res/values/strings.xml")).toBe(false);
    expect(isReplaceableEntry("AndroidManifest.xml")).toBe(false);
    expect(isReplaceableEntry("resources.arsc")).toBe(false);
  });

  it("assets / raw / lib / so 能换", () => {
    expect(isReplaceableEntry("assets/config.json")).toBe(true);
    expect(isReplaceableEntry("res/raw/beep.mp3")).toBe(true);
    expect(isReplaceableEntry("lib/arm64-v8a/libfoo.so")).toBe(true);
  });
});

describe("M212 桥缺失时的兜底", () => {
  it("hasApkRepack 为 false", () => {
    expect(hasApkRepack()).toBe(false);
  });

  it("listApkEntries 返回空 + 错误文案", () => {
    const r = listApkEntries("/x.apk");
    expect(r.entries).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it("repackApk 不抛，返回失败", async () => {
    const r = await repackApk({
      apk: "/x.apk",
      replacements: [],
      keystore: "/k.keystore",
      storePass: "p",
      alias: "a",
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("pickApk 在没有桥时立刻报不支持", async () => {
    const r = await pickApk();
    expect(r.err).toBeTruthy();
  });
});

describe("M212 有桥时走协议", () => {
  it("listApkEntries 解析 ok: JSON 并排序", () => {
    W().AxvNative = {
      listApkEntries: () => 'ok:[{"name":"b.png","size":2},{"name":"a.png","size":1}]',
    };
    const r = listApkEntries("/x.apk");
    expect(r.error).toBeUndefined();
    expect(r.entries.map((e) => e.name)).toEqual(["a.png", "b.png"]);
  });

  it("listApkEntries 认 err: 前缀", () => {
    W().AxvNative = { listApkEntries: () => "err:找不到 APK 文件" };
    expect(listApkEntries("/x.apk").error).toBe("找不到 APK 文件");
  });

  it("repackApk 回调 ok: 路径", async () => {
    W().AxvNative = {
      pickApk: () => {},
      repackApkAsync: (id: string) => {
        setTimeout(() => W().__axvRepackApk?.(id, "ok:/out/app-resigned.apk"), 0);
      },
    };
    const r = await repackApk({
      apk: "/x.apk",
      replacements: [{ name: "res/drawable/a.png", base64: "AA==" }],
      keystore: "/k.keystore",
      storePass: "p",
      alias: "a",
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/out/app-resigned.apk");
  });

  it("repackApk 把 err:step:msg 拆开", async () => {
    W().AxvNative = {
      pickApk: () => {},
      repackApkAsync: (id: string) => {
        setTimeout(() => W().__axvRepackApk?.(id, "err:sign:keystore 口令不对"), 0);
      },
    };
    const r = await repackApk({
      apk: "/x.apk",
      replacements: [],
      keystore: "/k.keystore",
      storePass: "p",
      alias: "a",
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("sign");
    expect(r.log).toContain("口令不对");
  });

  it("pickApk 把路径透传出来", async () => {
    W().AxvNative = {
      pickApk: () => {
        setTimeout(() => W().__axvPickedApk?.("/cache/import/apked.apk", "ok:apked.apk"), 0);
      },
    };
    const r = await pickApk();
    expect(r.path).toBe("/cache/import/apked.apk");
    expect(r.name).toBe("apked.apk");
  });

  it("pickApk 认 err: 前缀（取消）", async () => {
    W().AxvNative = {
      pickApk: () => {
        setTimeout(() => W().__axvPickedApk?.("", "err:canceled"), 0);
      },
    };
    const r = await pickApk();
    expect(r.err).toBe("canceled");
  });
});

describe("M212 打包插件注册表", () => {
  const mk = (id: string, ok: boolean): BuildPipeline => ({
    id,
    label: id,
    available: () => ok,
    run: vi.fn(async () => ({ ok: true })),
  });

  it("注册 / 查询 / 列表", () => {
    registerBuildPipeline(mk("shell", true));
    registerBuildPipeline(mk("repack", false));
    expect(listBuildPipelines()).toHaveLength(2);
    expect(getBuildPipeline("shell")?.id).toBe("shell");
    expect(getBuildPipeline("nope")).toBeNull();
  });

  it("available 过滤掉不可用的", () => {
    registerBuildPipeline(mk("shell", true));
    registerBuildPipeline(mk("repack", false));
    expect(availableBuildPipelines().map((p) => p.id)).toEqual(["shell"]);
  });

  it("available 抛错算作不可用（不炸整个列表）", () => {
    registerBuildPipeline({
      id: "boom",
      label: "boom",
      available: () => {
        throw new Error("x");
      },
      run: async () => ({ ok: false }),
    });
    expect(availableBuildPipelines()).toEqual([]);
  });

  it("同 id 覆盖", () => {
    registerBuildPipeline(mk("shell", false));
    registerBuildPipeline(mk("shell", true));
    expect(listBuildPipelines()).toHaveLength(1);
    expect(availableBuildPipelines()).toHaveLength(1);
  });
});
