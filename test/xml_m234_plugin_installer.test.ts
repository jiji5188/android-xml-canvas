// @vitest-environment jsdom
// test/xml_m234_plugin_installer.test.ts — M234：第三方插件安装链路
//
// 验证：拉 manifest + bundle → 存 IndexedDB → 执行 bundle → 注册进 EditorRegistry。
// mock fetch 喂假 manifest + bundle，不真访问网络；IndexedDB 用内存 stub。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { installPlugin, listInstalledIds } from "@/lib/plugin/installer";
import { EditorRegistry } from "@/lib/plugin/plugin-registry";

async function flush(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  EditorRegistry.reset();
  (globalThis as { __axvBareEditors?: Record<string, unknown> }).__axvBareEditors = {};
  // jsdom 没有 indexedDB，给个内存实现
  const mem: Record<string, string> = {};
  const store = {
    put: (rec: { id: string; code: string }) => {
      mem[rec.id] = rec.code;
    },
    getAll: () => {
      const rq = {
        onsuccess: null as null | ((e: { target: { result: unknown } }) => void),
        onerror: null as null | (() => void),
      };
      setTimeout(() => rq.onsuccess?.({ target: { result: Object.entries(mem).map(([id, code]) => ({ id, code })) } }), 0);
      return rq;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => {
      const tx = { objectStore: () => store, oncomplete: null as null | (() => void), onerror: null as null | (() => void) };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  } as unknown as IDBDatabase;
  vi.stubGlobal("indexedDB", {
    open: () => {
      const req = {
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | ((e: { target: { result: IDBDatabase } }) => void),
        onerror: null as null | (() => void),
        result: db,
      };
      setTimeout(() => req.onsuccess?.({ target: { result: db } }), 0);
      return req as unknown as IDBOpenDBRequest;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MANIFEST = {
  id: "axv:editor:demo",
  name: "演示插件",
  version: "1.0.0",
  type: "bare",
  kinds: ["code"],
  entry: "bundle.js",
};

const BUNDLE = `(function(){ if(typeof window!=="undefined"){ window.__axvBareEditors=window.__axvBareEditors||{}; window.__axvBareEditors["axv:editor:demo"]={mount:function(el,p){el.textContent="demo-ok";},unmount:function(){}}; } })();`;

describe("installPlugin", () => {
  it("拉 manifest + bundle，执行后注册进 EditorRegistry", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify(MANIFEST), { status: 200 });
      return new Response(BUNDLE, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const p = await installPlugin("https://x.test/editors/demo/manifest.json");
    expect(p.id).toBe("axv:editor:demo");
    expect(p.kind).toBe("code");

    expect(EditorRegistry.resolve("code")?.id).toBe("axv:editor:demo");
    await flush();
    expect(listInstalledIds()).toContain("axv:editor:demo");
  });

  it("manifest 缺 id → 报错", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...MANIFEST, id: "" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(installPlugin("https://x.test/editors/demo/manifest.json")).rejects.toThrow(/id/);
  });

  it("type 不是 bare → 报错", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("manifest.json") ? new Response(JSON.stringify({ ...MANIFEST, type: "react" }), { status: 200 }) : new Response(BUNDLE, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(installPlugin("https://x.test/editors/demo/manifest.json")).rejects.toThrow(/bare/);
  });
});
