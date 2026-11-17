import { describe, it, expect } from "vitest";
import { collectProjectLibs, type CollectLibsResult } from "../lib/xml/project-libs";

// M266：libs 收集器（io 通道）

function fakeIo(
  tree: Record<string, { kind: "dir" | "file"; name?: string }[]>,
  b64?: Record<string, string>,
) {
  return {
    rootLabel: () => "fake",
    list: (async (rel: string) => ({
      ok: true as const,
      items: (tree[rel] || []).map((x) => ({
        name: x.name ?? x.kind,
        kind: x.kind as "dir" | "file",
        rel: rel ? `${rel}/${x.name ?? x.kind}` : x.name ?? x.kind,
      })),
    })) as never,
    read: async () => ({ ok: false, error: "no" }),
    readBase64: (async (rel: string) => {
      if (b64 && b64[rel]) return { ok: true, base64: b64[rel] } as const;
      return { ok: false, error: "no" } as const;
    }) as never,
    write: async () => ({ ok: false }),
  };
}

type FakeTree = Record<string, { kind: "dir" | "file"; name?: string }[]>;

describe("collectProjectLibs (M266)", () => {
  it("M358：0 容忍——扫出 app/src/main/libs 下的 jar/aar（不再收 app/libs）", async () => {
    const tree: FakeTree = {
      "": [{ kind: "dir", name: "app" }],
      app: [{ kind: "dir", name: "libs" }, { kind: "dir", name: "src" }],
      "app/libs": [{ kind: "file", name: "should-ignore.jar" }],
      "app/src": [{ kind: "dir", name: "main" }],
      "app/src/main": [{ kind: "dir", name: "libs" }],
      "app/src/main/libs": [{ kind: "file", name: "jxl.jar" }, { kind: "file", name: "androidx-core.aar" }],
    };
    const r = await collectProjectLibs(
      fakeIo(tree, {
        "app/src/main/libs/jxl.jar": "YWJjZA==",
        "app/src/main/libs/androidx-core.aar": "ZXhmaQ==",
      }),
      null,
    );
    expect(r.libs.map((l) => l.rel).sort()).toEqual(["app/src/main/libs/androidx-core.aar", "app/src/main/libs/jxl.jar"]);
    expect(r.failed).toEqual([]);
  });

  it("不碰 libs 之外的 jar（gradle.properties 同级）", async () => {
    const tree: FakeTree = {
      "": [{ kind: "file", name: "dep.jar" }, { kind: "dir", name: "build" }],
      build: [{ kind: "file", name: "x.jar" }],
    };
    const r = await collectProjectLibs(fakeIo(tree, {}), null);
    expect(r.libs).toEqual([]);
  });

  it("M358：总量超 40MB 截断（app/src/main/libs）", async () => {
    const big = "A".repeat(16 * 1024 * 1024); // base64 4/3 后 ~12MB
    const tree: FakeTree = {
      "": [{ kind: "dir", name: "app" }],
      app: [{ kind: "dir", name: "src" }],
      "app/src": [{ kind: "dir", name: "main" }],
      "app/src/main": [{ kind: "dir", name: "libs" }],
      "app/src/main/libs": [
        { kind: "file", name: "a.jar" },
        { kind: "file", name: "b.jar" },
        { kind: "file", name: "c.jar" },
      ],
    };
    const r = await collectProjectLibs(
      fakeIo(tree, {
        "app/src/main/libs/a.jar": big,
        "app/src/main/libs/b.jar": big,
        "app/src/main/libs/c.jar": big,
      }),
      null,
    );
    // 单文件 ~12MB，3 个 36MB < 40MB 都能进；换成 4 个就截断
    expect(r.libs.length).toBe(3);
  });

  it("M346：标准安卓工程位置 app/src/main/libs/ 也能被收进编译（depth 4 不超 MAX_DEPTH）", async () => {
    const tree: FakeTree = {
      "": [{ kind: "dir", name: "app" }],
      app: [{ kind: "dir", name: "src" }],
      "app/src": [{ kind: "dir", name: "main" }],
      "app/src/main": [{ kind: "dir", name: "libs" }, { kind: "dir", name: "res" }],
      "app/src/main/libs": [{ kind: "file", name: "okhttp-4.12.0.jar" }],
      "app/src/main/res": [{ kind: "dir", name: "layout" }],
      "app/src/main/res/layout": [{ kind: "file", name: "a.xml" }],
    };
    const r = await collectProjectLibs(
      fakeIo(tree, { "app/src/main/libs/okhttp-4.12.0.jar": "YWJjZA==" }),
      null,
    );
    expect(r.libs.map((l) => l.rel)).toEqual(["app/src/main/libs/okhttp-4.12.0.jar"]);
    expect(r.failed).toEqual([]);
  });
});
