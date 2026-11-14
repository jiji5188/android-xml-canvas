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
  it("扫出 app/libs 下的 jar/aar", async () => {
    const tree: FakeTree = {
      "": [{ kind: "dir", name: "app" }],
      app: [{ kind: "dir", name: "libs" }, { kind: "dir", name: "src" }],
      "app/libs": [{ kind: "file", name: "jxl.jar" }, { kind: "file", name: "androidx-core.aar" }],
      "app/src": [{ kind: "file", name: "Main.java" }],
    };
    const r = await collectProjectLibs(
      fakeIo(tree, {
        "app/libs/jxl.jar": "YWJjZA==",
        "app/libs/androidx-core.aar": "ZXhmaQ==",
      }),
      null,
    );
    expect(r.libs.map((l) => l.rel).sort()).toEqual(["app/libs/androidx-core.aar", "app/libs/jxl.jar"]);
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

  it("总量超 40MB 截断", async () => {
    const big = "A".repeat(16 * 1024 * 1024); // base64 4/3 后 ~12MB
    const tree: FakeTree = {
      "": [{ kind: "dir", name: "libs" }],
      libs: [
        { kind: "file", name: "a.jar" },
        { kind: "file", name: "b.jar" },
        { kind: "file", name: "c.jar" },
      ],
    };
    const r = await collectProjectLibs(
      fakeIo(tree, {
        "libs/a.jar": big,
        "libs/b.jar": big,
        "libs/c.jar": big,
      }),
      null,
    );
    // 单文件 ~12MB，3 个 36MB < 40MB 都能进；换成 4 个就截断
    expect(r.libs.length).toBe(3);
  });
});
