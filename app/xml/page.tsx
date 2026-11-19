"use client";

// M412：入口 = 项目管理页（点项目才进编辑器）。
// 壳在 components/XmlAppShell.tsx（内部 view 切换，不用真路由，见该文件头注释）。

import { XmlAppShell } from "@/components/XmlAppShell";

export default function XmlPage() {
  return <XmlAppShell />;
}
