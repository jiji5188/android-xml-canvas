// lib/plugin/editors.ts — 把现有编辑器注册成插件（M230 试点）
//
// drawable / icon 两个「资源编辑器」形状一致（name + existingXml + 保存/关闭 + res 源），
// 用同一套 EditorMountProps 就能驱动。CodeEditor 是内联编辑器（绑 XmlEditor 的 state），
// 不在这个全屏注册表里；Theme 编辑器回调太宿主特化，留到 M231+ 再决定要不要独立。

import type { EditorManifest, EditorMountProps } from "./plugin-registry";
import { EditorRegistry } from "./plugin-registry";
import type { ComponentType } from "react";

/**
 * 适配器：把 EditorMountProps 翻译成具体编辑器的真实 props。
 * 各编辑器组件签名不同，注册时包一层，宿主只管传 mount props。
 */
export function registerBuiltinEditors(): void {
  EditorRegistry.register({
    id: "axv:editor:drawable",
    kinds: ["drawable"],
    label: "drawable 绘制编辑器",
    needsRealRender: true,
    component: async () => {
      const m = await import("@/components/ShapeEditor");
      // ShapeEditor 需要 attrName/value；用 name 合成一个稳定的 value
      const ShapeEditor = m.ShapeEditor;
      const Adapter: ComponentType<EditorMountProps> = (p) => {
        const value = `@drawable/${p.name}`;
        return (
          <ShapeEditor
            attrName="background"
            value={value}
            existingXml={p.existingXml}
            existingNames={p.existingNames}
            res={p.res ?? null}
            io={p.io as never}
            docRel={p.docRel ?? null}
            onClose={p.onClose}
            onSave={p.onSave}
          />
        );
      };
      return { default: Adapter };
    },
  });

  EditorRegistry.register({
    id: "axv:editor:icon",
    kinds: ["icon"],
    label: "图标画布编辑器",
    needsRealRender: true,
    component: async () => {
      const m = await import("@/components/IconCanvasEditor");
      const IconCanvasEditor = m.default;
      const Adapter: ComponentType<EditorMountProps> = (p) => {
        return (
          <IconCanvasEditor
            name={p.name}
            xml={p.existingXml}
            existingNames={p.existingNames}
            onClose={p.onClose}
            onSave={p.onSave}
          />
        );
      };
      return { default: Adapter };
    },
  });
}

export type { EditorManifest, EditorMountProps };
