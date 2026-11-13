// test/xml_m233_plugin_settings.test.tsx — M233：设置面板里出现「插件」分组
//
// 护栏：SettingsPanel 有插件分组，PluginPanel 能渲染内置插件开关；XmlEditor 把状态传给两边。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("M233 设置面板插件分组", () => {
  it("SettingsPanel 有「插件」分组 + 接 PluginPanel", () => {
    const s = rd("components/SettingsPanel.tsx");
    expect(s).toContain('groupCls(7)');
    expect(s).toContain("set.plugins");
    expect(s).toContain("<PluginPanel");
    expect(s).toContain("pluginsEnabled");
    expect(s).toContain("onTogglePlugin");
  });

  it("PluginPanel 列出内置插件 + 开关", () => {
    const s = rd("components/PluginPanel.tsx");
    expect(s).toContain("listPlugins");
    expect(s).toContain("axv:editor:drawable");
    expect(s).toContain("axv:editor:icon");
    expect(s).toContain('type="checkbox"');
    expect(s).toContain("已禁用");
  });

  it("XmlEditor 持有插件状态并传给设置面板 + 编辑器挂载", () => {
    const s = rd("components/XmlEditor.tsx");
    expect(s).toContain("loadPluginEnabled");
    expect(s).toContain("togglePluginEnabled");
    expect(s).toContain("pluginsEnabled={pluginEnabled}");
    expect(s).toContain("onTogglePlugin={onTogglePlugin}");
    expect(s).toContain("enabled={pluginEnabled}");
  });

  it("PluginEditorHost 查 enabled，被禁用的渲染 null", () => {
    const s = rd("components/PluginEditorHost.tsx");
    expect(s).toContain("enabled");
    expect(s).toContain("enabled[manifest.id] !== false");
    expect(s).toContain("if (!active) return null;");
  });
});
