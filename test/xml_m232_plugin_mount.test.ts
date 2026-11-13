// test/xml_m232_plugin_mount.test.ts — M232：XmlEditor 改走插件注册表挂载
//
// 护栏：宿主不再直接 import ShapeEditor / IconCanvasEditor，而是丢 kind + props 给
// PluginEditorHost，由它去 EditorRegistry 查插件 + 懒加载。这样以后新增编辑器不用动宿主。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("M232 XmlEditor 走插件注册表", () => {
  const s = rd("components/XmlEditor.tsx");

  it("不再直接 import 具体编辑器组件", () => {
    expect(s).not.toContain('from "./ShapeEditor"');
    expect(s).not.toContain('from "./IconCanvasEditor"');
  });

  it("用 PluginEditorHost 按 kind 挂载", () => {
    expect(s).toContain('import { PluginEditorHost } from "./PluginEditorHost";');
    expect(s).toContain('kind="drawable"');
    expect(s).toContain('kind="icon"');
    expect(s).toContain("<PluginEditorHost");
  });

  it("编辑器专属参数走 extra，宿主不解释", () => {
    expect(s).toContain("attrName: \"background\"");
    expect(s).toContain("forceTree: resShape.forceTree");
    expect(s).toContain("initialAppIcon: appIconInit ?? undefined");
  });
});

describe("M232 PluginEditorHost 自身", () => {
  const s = rd("components/PluginEditorHost.tsx");

  it("模块加载时就注册内置编辑器（幂等）", () => {
    expect(s).toContain("registerBuiltinEditors();");
  });

  it("查不到插件或加载失败都安全返回 null（不炸宿主）", () => {
    expect(s).toContain("if (!manifest) {");
    expect(s).toContain("if (failed) return null;");
    expect(s).toContain("if (!Comp) return null;");
  });

  it("加载完成前不渲染，且卸载后不再 setState", () => {
    expect(s).toContain("if (alive) setComp(() => m.default);");
    expect(s).toContain("alive = false;");
  });
});
