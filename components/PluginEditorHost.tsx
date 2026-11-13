"use client";

// components/PluginEditorHost.tsx — M232：按资源种类挂载编辑器插件
//
// 宿主（XmlEditor）不再 import 具体编辑器组件，只丢一个 kind + mount props 过来，
// 这里去 EditorRegistry 查插件、懒加载、渲染。加载中渲染 null（全屏弹层，闪一下可接受）。
//
// 用法：
//   <PluginEditorHost kind="drawable" props={{ name, existingXml, existingNames, onSave, onClose, res, io, docRel, extra }} />

import { useEffect, useState, type ComponentType } from "react";
import { EditorRegistry, type EditorKind, type EditorMountProps } from "@/lib/plugin/plugin-registry";
import { registerBuiltinEditors } from "@/lib/plugin/editors";

// 模块加载时就把内置编辑器登记上（幂等，重复 register 覆盖旧的），
// 保证宿主任何一次 resolve 都能查到；具体组件仍然是 manifest 里的动态 import。
registerBuiltinEditors();

interface Props {
  kind: EditorKind;
  props: EditorMountProps;
}

export function PluginEditorHost({ kind, props }: Props) {
  const [Comp, setComp] = useState<ComponentType<EditorMountProps> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const manifest = EditorRegistry.resolve(kind);
    if (!manifest) {
      setFailed(true);
      return;
    }
    setComp(null);
    setFailed(false);
    manifest
      .component()
      .then((m) => {
        if (alive) setComp(() => m.default);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [kind]);

  if (failed) return null;
  if (!Comp) return null;
  return <Comp {...props} />;
}

export default PluginEditorHost;
