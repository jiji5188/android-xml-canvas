// lib/plugin/file-kind.ts — 判断一个资源文件该交给哪个编辑器
//
// 纯函数，可单测。宿主拿到 relPath（如 drawable/bg_card.xml / mipmap/ic_launcher.xml /
// values/strings.xml / java/MainActivity.kt）后调 resolveFileKind 决定用哪个编辑器。

import type { EditorKind } from "./plugin-registry";

/** 资源目录 → 编辑器种类。未列出的目录 → unknown（宿主兜底走代码编辑器） */
const RES_KIND: Record<string, EditorKind> = {
  drawable: "drawable",
  // mipmap 里只有 launcher 是 vector（可编辑），其它位图 mipmap 走代码编辑
  mipmap: "icon",
  layout: "code",
  values: "code",
  res: "code",
};

const VECTOR_EXT = /\.svg$/i;
const DRAWABLE_XML = /\.(xml)$/i;
const JAVA_EXT = /\.(java|kt|kts)$/i;

export interface FileKindInput {
  /** 资源树相对路径，如 drawable/bg_card.xml */
  relPath: string;
  /** 文件内容（判断 svg / 矢量用；没有就只看路径） */
  content?: string;
}

export function resolveFileKind(input: FileKindInput): EditorKind {
  const rel = input.relPath.replace(/\\/g, "/");
  const seg = rel.split("/")[0] || "";
  const base = rel.split("/").pop() || "";

  // java / kotlin 源码 → 代码编辑器（含 lint/仿真）
  if (JAVA_EXT.test(base)) return "code";

  // 矢量图（svg）或 mipmap 里的 launcher → 图标画布编辑器
  if (VECTOR_EXT.test(base) || (seg === "mipmap" && /ic_launcher/i.test(base))) {
    return "icon";
  }

  // drawable / 其它 res 目录的 xml → 绘制编辑器
  if (seg === "drawable" && DRAWABLE_XML.test(base)) return "drawable";

  const byDir = RES_KIND[seg];
  if (byDir) return byDir;

  return "unknown";
}
