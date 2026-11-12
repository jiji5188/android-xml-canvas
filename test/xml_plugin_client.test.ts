// test/xml_plugin_client.test.ts
// 网页版没有 AxvNative 桥 → 各方法应安全退化（不抛错）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasPluginSupport, pluginStatus, downloadPlugin, clearPlugin } from "@/lib/xml/plugin-client";

beforeAll(() => {
  // 模拟手机上的桥（只测 JS 侧的调用形状，不真发请求）
  const g = globalThis as unknown as { window?: unknown; AxvNative?: unknown };
  g.window = g; // axvNative 读的是 window.AxvNative
  g.AxvNative = {
    pluginStatus: () => JSON.stringify({ id: "ecj-d8", installed: false, bytes: 0, files: [], missing: ["tool1.bin"] }),
    pluginDownload: () => {},
    pluginClear: () => {},
  };
});
afterAll(() => {
  const g = globalThis as unknown as { AxvNative?: unknown };
  delete g.AxvNative;
});

describe("plugin-client（有桥）", () => {
  it("hasPluginSupport true", () => {
    expect(hasPluginSupport()).toBe(true);
  });
  it("pluginStatus 解析原生返回", () => {
    const s = pluginStatus("ecj-d8");
    expect(s.id).toBe("ecj-d8");
    expect(s.installed).toBe(false);
    expect(s.missing).toContain("tool1.bin");
  });
});

describe("plugin-client（无桥，网页版）", () => {
  it("hasPluginSupport false + 各方法安全退化", async () => {
    const g = globalThis as unknown as { AxvNative?: unknown };
    delete g.AxvNative;
    expect(hasPluginSupport()).toBe(false);
    const s = pluginStatus("ecj-d8");
    expect(s.installed).toBe(false);
    expect(s.error).toBeTruthy();
    const r = await downloadPlugin("ecj-d8");
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
    const c = clearPlugin("ecj-d8");
    expect(c.ok).toBe(false);
  });
});
