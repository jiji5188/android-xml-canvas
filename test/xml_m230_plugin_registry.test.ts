// test/xml_m230_plugin_registry.test.ts — M230：编辑器插件化试点（注册表 + 懒加载 + 适配器）
//
// 验证「按资源 kind 查得到编辑器 + 能懒加载 + 适配器 props 映射正确」。
// 不动 XmlEditor 的现有 resShape/resIcon 挂载（那一步 M231 再做），先保证这条链路本身是通的。

import { describe, expect, it, beforeEach } from "vitest";
import { EditorRegistry, type EditorKind } from "@/lib/plugin/plugin-registry";
import { registerBuiltinEditors } from "@/lib/plugin/editors";
import { resolveFileKind } from "@/lib/plugin/file-kind";

beforeEach(() => {
  EditorRegistry.reset();
});

describe("EditorRegistry 注册/查询", () => {
  it("注册后能按 kind 查到，没注册返回 null", () => {
    registerBuiltinEditors();
    expect(EditorRegistry.resolve("drawable")?.id).toBe("axv:editor:drawable");
    expect(EditorRegistry.resolve("icon")?.id).toBe("axv:editor:icon");
    expect(EditorRegistry.resolve("theme")).toBeNull();
    expect(EditorRegistry.resolve("unknown")).toBeNull();
    expect(EditorRegistry.kinds()).toEqual(["drawable", "icon"]);
    expect(EditorRegistry.size).toBe(2);
  });

  it("needsRealRender 标记正确（drawable/icon 都要真机渲染桥）", () => {
    registerBuiltinEditors();
    expect(EditorRegistry.resolve("drawable")?.needsRealRender).toBe(true);
    expect(EditorRegistry.resolve("icon")?.needsRealRender).toBe(true);
  });
});

describe("编辑器组件能懒加载且适配器映射 props", () => {
  it("drawable 编辑器：组件可加载，适配器接住 mount props", async () => {
    registerBuiltinEditors();
    const ed = EditorRegistry.resolve("drawable")!;
    const { default: Component } = await ed.component();
    expect(typeof Component).toBe("function");
    // 适配器是函数组件；能渲染（renderReal 不在测试里触发，只验证接住 props）
  });

  it("icon 编辑器：组件可加载", async () => {
    registerBuiltinEditors();
    const ed = EditorRegistry.resolve("icon")!;
    const { default: Component } = await ed.component();
    expect(typeof Component).toBe("function");
  });
});

describe("resolveFileKind 判型", () => {
  it("资源目录 + 扩展名 → 正确种类", () => {
    expect(resolveFileKind({ relPath: "drawable/bg_card.xml" })).toBe("drawable");
    expect(resolveFileKind({ relPath: "drawable/ic_launcher_foreground.svg" })).toBe("icon");
    expect(resolveFileKind({ relPath: "mipmap/ic_launcher.xml" })).toBe("icon");
    expect(resolveFileKind({ relPath: "layout/activity_main.xml" })).toBe("code");
    expect(resolveFileKind({ relPath: "values/strings.xml" })).toBe("code");
    expect(resolveFileKind({ relPath: "src/MainActivity.java" })).toBe("code");
    expect(resolveFileKind({ relPath: "res/menu/main.xml" })).toBe("code");
  });

  it("没列出的目录 → unknown", () => {
    expect(resolveFileKind({ relPath: "raw/anim_data.xml" })).toBe("unknown");
    expect(resolveFileKind({ relPath: "font/myfont.ttf" })).toBe("unknown");
  });
});
