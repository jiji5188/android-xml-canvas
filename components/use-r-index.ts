"use client";

// components/use-r-index.ts — M465：R 表索引 hook
//
// 从编辑器已有的 resExtras（res 目录树）+ 本工具生成的 drawable 推导 R 表，
// 供 Java 候选（R. / R.layout. / R.string.xxx）列出项目真实资源引用。
// 拆成独立文件是为了守住 XmlEditor 行数护栏（M408）。

import { useMemo } from "react";
import { buildRIndex, type RIndex } from "@/lib/xml/r-index";
import type { ResourceExtras } from "@/lib/xml/resdir";

export function useRIndex(
  resExtras: ResourceExtras | null | undefined,
  generatedDrawables: Record<string, string> | null | undefined,
): RIndex {
  return useMemo(() => buildRIndex(resExtras, generatedDrawables), [resExtras, generatedDrawables]);
}
