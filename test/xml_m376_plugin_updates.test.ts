// test/xml_m376_plugin_updates.test.ts — M376 插件更新检查
import { describe, expect, it, vi, afterEach } from "vitest";
import { checkPluginUpdate, cmpVersion, fetchPluginRegistry } from "@/lib/plugin/updates";

describe("cmpVersion", () => {
  it("数字段按数值比", () => {
    expect(cmpVersion("1.2.10", "1.2.9")).toBe(1);
    expect(cmpVersion("1.2.9", "1.2.10")).toBe(-1);
    expect(cmpVersion("3.33.0", "3.33.0")).toBe(0);
    expect(cmpVersion("2.0", "1.9.9")).toBe(1);
  });
  it("位数不齐按 0 补", () => {
    expect(cmpVersion("1.2", "1.2.0")).toBe(0);
    expect(cmpVersion("1", "1.0.1")).toBe(-1);
  });
  it("非数字段字典序", () => {
    expect(cmpVersion("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(cmpVersion("1.0.0", "1.0.0-beta")).toBe(-1);
  });
  it("空/非法按 0", () => {
    expect(cmpVersion("", "0.0.0")).toBe(0);
    // 非数字段走字典序：x > 1
    expect(cmpVersion("x", "1")).toBe(1);
  });
});

describe("checkPluginUpdate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("注入注册表：有新版本", async () => {
    const r = await checkPluginUpdate("axv:editor:drawable", "1.0.0", undefined, {
      "axv:editor:drawable": { id: "axv:editor:drawable", version: "1.1.0" },
    });
    expect(r.hasUpdate).toBe(true);
    expect(r.latest).toBe("1.1.0");
    expect(r.error).toBeUndefined();
  });

  it("注入注册表：已是最新", async () => {
    const r = await checkPluginUpdate("axv:editor:icon", "1.0.0", undefined, {
      "axv:editor:icon": { id: "axv:editor:icon", version: "1.0.0" },
    });
    expect(r.hasUpdate).toBe(false);
  });

  it("注册表里没有 → error=not in registry", async () => {
    const r = await checkPluginUpdate("ghost", "1.0.0", undefined, {});
    expect(r.error).toBe("not in registry");
    expect(r.hasUpdate).toBe(false);
  });

  it("注册表不可用 → error=registry unavailable", async () => {
    const r = await checkPluginUpdate("x", "1.0.0", undefined, null);
    expect(r.error).toBe("registry unavailable");
  });

  it("有 manifestUrl：直接拉 manifest 比对", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ version: "2.0.0" }) })),
    );
    const r = await checkPluginUpdate("pl", "1.5.0", "https://x/manifest.json", {});
    expect(r.hasUpdate).toBe(true);
    expect(r.latest).toBe("2.0.0");
    expect(r.manifestUrl).toBe("https://x/manifest.json");
  });

  it("manifest 拉取失败 → error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    const r = await checkPluginUpdate("pl", "1.0.0", "https://x/manifest.json", {});
    expect(r.error).toBe("fetch failed");
    expect(r.hasUpdate).toBe(false);
  });
});

describe("fetchPluginRegistry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("解析 {plugins:[...]} 数组为 map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ plugins: [{ id: "a", version: "1.0.0" }, { id: "b", version: "2.0.0", manifestUrl: "u" }] }),
      })),
    );
    const m = await fetchPluginRegistry();
    expect(m?.a?.version).toBe("1.0.0");
    expect(m?.b?.manifestUrl).toBe("u");
  });

  it("网络失败返回 null 不抛", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await fetchPluginRegistry()).toBeNull();
  });
});
