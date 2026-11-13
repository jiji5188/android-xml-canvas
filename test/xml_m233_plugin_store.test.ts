// @vitest-environment jsdom
// test/xml_m233_plugin_store.test.ts — M233：设置面板里的插件启用/禁用
//
// 最小版：内置插件（drawable / icon 编辑器）能开能关，状态存 localStorage。
// 关掉某插件后，resolve 出来也视为「不可用」（回退到代码编辑）。

import { describe, expect, it, beforeEach } from "vitest";
import {
  loadPluginEnabled,
  togglePluginEnabled,
  enabledPluginForKind,
  type PluginEnabledMap,
} from "@/lib/plugin/store";
import { EditorRegistry } from "@/lib/plugin/plugin-registry";
import { registerBuiltinEditors } from "@/lib/plugin/editors";

beforeEach(() => {
  EditorRegistry.reset();
  registerBuiltinEditors();
  localStorage.clear();
});

describe("loadPluginEnabled", () => {
  it("没存过 → 内置全启用", () => {
    const m = loadPluginEnabled();
    expect(m["axv:editor:drawable"]).toBe(true);
    expect(m["axv:editor:icon"]).toBe(true);
  });

  it("存过的会覆盖默认（允许关掉）", () => {
    localStorage.setItem(
      "axv.plugin.enabled",
      JSON.stringify({ "axv:editor:icon": false, "axv:editor:drawable": true }),
    );
    const m = loadPluginEnabled();
    expect(m["axv:editor:icon"]).toBe(false);
    expect(m["axv:editor:drawable"]).toBe(true);
  });
});

describe("togglePluginEnabled", () => {
  it("切换 + 持久化", () => {
    let cur: PluginEnabledMap = loadPluginEnabled();
    expect(cur["axv:editor:icon"]).toBe(true);
    cur = togglePluginEnabled("axv:editor:icon", false, cur);
    expect(cur["axv:editor:icon"]).toBe(false);
    // 持久化后重新读
    expect(loadPluginEnabled()["axv:editor:icon"]).toBe(false);
    // 再开
    cur = togglePluginEnabled("axv:editor:icon", true, cur);
    expect(loadPluginEnabled()["axv:editor:icon"]).toBe(true);
  });
});

describe("enabledPluginForKind（M233 核心）", () => {
  it("启用 → 返回插件 id", () => {
    const on: PluginEnabledMap = { "axv:editor:drawable": true };
    expect(enabledPluginForKind("drawable", on)).toBe("axv:editor:drawable");
  });

  it("禁用 → 返回 null（回退代码编辑）", () => {
    const off: PluginEnabledMap = { "axv:editor:drawable": false };
    expect(enabledPluginForKind("drawable", off)).toBeNull();
  });

  it("未注册的 kind → null", () => {
    expect(enabledPluginForKind("unknown", {})).toBeNull();
  });
});
