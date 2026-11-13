"use client";

// components/PluginEditorHost.tsx — M232：按资源种类挂载编辑器插件
//
// 宿主（XmlEditor）不再 import 具体编辑器组件，只丢一个 kind + mount props + enabled 过来，
// 这里去 EditorRegistry 查插件、懒加载、渲染。加载中渲染 null（全屏弹层，闪一下可接受）。
//
// M233：新增 enabled —— 某插件被用户在设置里关掉了，resolve 出来也渲染 null（回退到代码编辑）。
//
// 用法：
//   <PluginEditorHost kind="drawable" props={{...}} enabled={{ "axv:editor:drawable": true }} />

import { useEffect, useState, type ComponentType } from "react";
import {
  EditorRegistry,
  type EditorKind,
  type EditorMountProps,
} from "@/lib/plugin/plugin-registry";
import { registerBuiltinEditors } from "@/lib/plugin/editors";
import type { PluginEnabledMap } from "@/lib/plugin/store";

// 模块加载时就把内置编辑器登记上（幂等，重复 register 覆盖旧的），
// 保证宿主任何一次 resolve 都能查到；具体组件仍然是 manifest 里的动态 import。
registerBuiltinEditors();

interface Props {
  kind: EditorKind;
  props: EditorMountProps;
  /** 各插件启用状态。没传或对应 id 为 false → 渲染 null（回退） */
  enabled?: PluginEnabledMap;
}

export function PluginEditorHost({ kind, props, enabled }: Props) {
  const [Comp, setComp] = useState<ComponentType<EditorMountProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const manifest = EditorRegistry.resolve(kind);
  // M233：被禁用 / 没注册 → 不加载
  const active = manifest && (!enabled || enabled[manifest.id] !== false);

  useEffect(() => {
    if (!manifest) {
      setFailed(true);
      return;
    }
    if (!active) {
      setComp(null);
      return;
    }
    let alive = true;
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
  }, [manifest, active]);

  if (!active) return null;
  if (failed) return null;
  if (!Comp) return null;
  return <Comp {...props} />;
}

export default PluginEditorHost;
