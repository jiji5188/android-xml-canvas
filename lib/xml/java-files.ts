// lib/xml/java-files.ts — M199：把项目里的 Java/Kotlin 源码读成内存文本，喂给运行调试的「轻量逻辑仿真」
//
// 只是「读」：不写、不改、不编译。找不到目录就返回空数组，调用方降级成纯 XML 预览。

import type { AiFileIo } from "./ai-tools";

/** 这些目录不进去（构建产物 / IDE 缓存 / 第三方库源码太多） */
const SKIP_DIRS = new Set([".git", ".gradle", "build", ".idea", ".cxx", "captures", ".kotlin", "node_modules"]);

/** 单文件最多读 400KB（Activity 一般 5~20KB，设上限防大文件卡住手机） */
const MAX_TEXT = 400 * 1024;
/** 最多读 60 个文件 */
const MAX_FILES = 60;

const isCode = (rel: string) => /\.(java|kt|kts)$/i.test(rel);

export async function loadProjectJavaFiles(
  io: AiFileIo | null | undefined,
  maxDepth = 8,
): Promise<{ rel: string; text: string }[]> {
  if (!io) return [];
  const out: { rel: string; text: string }[] = [];
  let budget = MAX_FILES;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth || budget <= 0) return;
    const r = await io.list(rel);
    if (!r.ok) return;
    for (const it of r.items ?? []) {
      if (budget <= 0) return;
      if (it.kind === "dir") {
        const seg = it.rel.replace(/\\/g, "/").split("/").pop() ?? "";
        if (SKIP_DIRS.has(seg.toLowerCase())) continue;
        await walk(it.rel, depth + 1);
        continue;
      }
      if (!isCode(it.rel)) continue;
      const t = await io.read(it.rel);
      if (!t.ok || typeof t.text !== "string") continue;
      if (t.text.length > MAX_TEXT) continue;
      out.push({ rel: it.rel, text: t.text });
      budget--;
    }
  };

  await walk("", 0);
  return out;
}
