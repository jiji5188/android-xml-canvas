"use client";
// components/XmlAppShell.tsx — M412：入口切换壳（项目管理页 ↔ 编辑器）
//
// 为什么用内部 view 状态而不是 Next 路由：
//   - Android WebView 里真路由会碰返回键/BASE_PATH/状态回收三件麻烦事
//   - 内部切换 = 页面边界即状态生命周期边界（编辑器卸载 → 释放项目内存）
//
// 壳本身无逻辑：选中的项目存 pending，切进编辑器时以 initialProject 传下去，
// 编辑器内部只自动打开一次（见 XmlEditor 的 openedInitRef）。
// 退出编辑器（onExit）回到首页并清掉 pending。
// 未保存拦截在编辑器内（Toolbar 返回按钮 → leaveGuard 三态），壳不管。

import { useState } from "react";
import dynamic from "next/dynamic";
import type { WsProject } from "@/lib/xml/workspace";
import { ProjectHome } from "./ProjectHome";

const XmlEditor = dynamic(() => import("./XmlEditor").then((m) => m.XmlEditor), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#6B6F76" }}>
      正在打开编辑器…
    </div>
  ),
});

export function XmlAppShell() {
  const [view, setView] = useState<"home" | "editor">("home");
  const [pending, setPending] = useState<WsProject | null>(null);

  return view === "home" ? (
    <ProjectHome
      onOpenProject={(it) => {
        setPending(it);
        setView("editor");
      }}
      onOpenEditor={() => {
        setPending(null);
        setView("editor");
      }}
    />
  ) : (
    <XmlEditor
      initialProject={pending}
      onExit={() => {
        setPending(null);
        setView("home");
      }}
    />
  );
}
