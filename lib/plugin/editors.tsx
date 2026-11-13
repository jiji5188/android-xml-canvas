// lib/plugin/editors.tsx — 把现有编辑器注册成插件（M231 试点）
//
// drawable / icon 两个「资源编辑器」形状一致（name + existingXml + 保存/关闭 + res 源），
// 用同一套 EditorMountProps 驱动。各编辑器特有的参数（attrName/value/forceTree、
// initialAppIcon/onAppIcon）从 extra 里取，宿主不解释。
//
// CodeEditor 是内联编辑器（绑 XmlEditor 的 state），Theme 编辑器回调太宿主特化，
// 都不在这个全屏注册表里。

import type { EditorManifest, EditorMountProps } from "./plugin-registry";
import { EditorRegistry } from "./plugin-registry";
import type { ComponentType } from "react";

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export function registerBuiltinEditors(): void {
  EditorRegistry.register({
    id: "axv:editor:drawable",
    kinds: ["drawable"],
    label: "drawable 绘制编辑器",
    needsRealRender: true,
    component: async () => {
      const m = await import("@/components/ShapeEditor");
      const ShapeEditor = m.ShapeEditor;
      const Adapter: ComponentType<EditorMountProps> = (p) => (
        <ShapeEditor
          attrName={str(p.extra?.attrName, "background")}
          value={str(p.extra?.value, `@drawable/${p.name}`)}
          existingXml={p.existingXml}
          existingNames={p.existingNames}
          forceTree={p.extra?.forceTree === true}
          res={p.res ?? null}
          io={p.io as never}
          docRel={p.docRel ?? null}
          onClose={p.onClose}
          onSave={p.onSave}
        />
      );
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
      const Adapter: ComponentType<EditorMountProps> = (p) => (
        <IconCanvasEditor
          name={p.name}
          xml={p.existingXml}
          existingNames={p.existingNames}
          initialAppIcon={p.extra?.initialAppIcon as never}
          onAppIcon={p.extra?.onAppIcon as never}
          onClose={p.onClose}
          onSave={p.onSave}
        />
      );
      return { default: Adapter };
    },
  });
}

export type { EditorManifest, EditorMountProps };
