// lib/xml/java-files.ts — M199：把项目里的 Java/Kotlin 源码读成内存文本，喂给运行调试的「轻量逻辑仿真」
//
// 只是「读」：不写、不改、不编译。找不到目录就返回空数组，调用方降级成纯 XML 预览。

import type { AiFileIo } from "./ai-tools";
import { coreSkipDirs, withSkipExtras } from "./skip-dirs";
import { hasAsyncIo, listDirQueued } from "./native-async";
import { nativeBridge } from "./native-save";

// 不读 build/ 里的源码（build 产物不是源码）；dex 查找例外（见 project-dex.ts）
const SKIP_DIRS = withSkipExtras(coreSkipDirs, "build");

/** 单文件最多读 400KB（Activity 一般 5~20KB，设上限防大文件卡住手机） */
const MAX_TEXT = 400 * 1024;
/** 最多读 60 个文件 */
const MAX_FILES = 60;

const isCode = (rel: string) => /\.(java|kt|kts)$/i.test(rel);

// M236：Native 全量递归（绕过 listChildren 的 UI 过滤），
// 当 aiFileIo 扫不到任何 .java 时 fallback 到这里。
async function nativeWalk(
  rootDir: string,
  maxDepth: number,
  onFound: (rel: string) => Promise<void>,
  budget: { remaining: number },
): Promise<void> {
  const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth || budget.remaining <= 0) return;
    let json: string | null = null;
    try {
      json = hasAsyncIo() ? await listDirQueued(abs) : (nativeBridge()?.listDir?.(abs) ?? null);
    } catch {
      return;
    }
    if (!json) return;
    let parsed: { ok?: boolean; items?: { name: string; kind: string; path?: string }[] };
    try { parsed = JSON.parse(json); } catch { return; }
    if (!parsed?.ok || !Array.isArray(parsed.items)) return;
    for (const it of parsed.items) {
      if (budget.remaining <= 0) return;
      const childRel = rel ? rel + "/" + it.name : it.name;
      if (it.kind === "dir") {
        const seg = it.name.toLowerCase();
        if (SKIP_DIRS.has(seg)) continue;
        await walk(it.path || (abs + "/" + it.name), childRel, depth + 1);
      } else if (isCode(childRel)) {
        budget.remaining--;
        await onFound(childRel);
      }
    }
  };
  await walk(rootDir, "", 0);
}

export async function loadProjectJavaFiles(
  io: AiFileIo | null | undefined,
  maxDepth = 8,
  extra?: { nativeRoot?: string | null },
): Promise<{ rel: string; text: string }[]> {
  const out: { rel: string; text: string }[] = [];
  let budget = MAX_FILES;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth || budget <= 0) return;
    if (!io) return;
    const r = await io.list(rel);
    if (!r.ok) {
      console.log("[loadProjectJava] list failed at", rel, "-", r.error);
      return;
    }
    console.log("[loadProjectJava] list(" + rel + ") →", r.items?.length, "items:", r.items?.map((x) => x.kind + ":" + x.name).join(", ") || "(empty)");
    for (const it of r.items ?? []) {
      if (budget <= 0) return;
      if (it.kind === "dir") {
        const seg = it.rel.replace(/\\/g, "/").split("/").pop() ?? "";
        if (SKIP_DIRS.has(seg.toLowerCase())) {
          console.log("[loadProjectJava] SKIP dir", it.rel);
          continue;
        }
        await walk(it.rel, depth + 1);
        continue;
      }
      if (!isCode(it.rel)) continue;
      console.log("[loadProjectJava] FOUND code file:", it.rel);
      const t = await io.read(it.rel);
      if (!t.ok || typeof t.text !== "string") {
        console.log("[loadProjectJava] read failed:", it.rel, t.error);
        continue;
      }
      if (t.text.length > MAX_TEXT) continue;
      out.push({ rel: it.rel, text: t.text });
      budget--;
    }
  };

  await walk("", 0);

  // M236：aiFileIo 扫不到任何 .java 时，fallback 到 Native 全量递归
  if (out.length === 0 && extra?.nativeRoot) {
    console.log("[loadProjectJava] aiFileIo found 0, trying native fallback at", extra.nativeRoot);
    const nb = { remaining: MAX_FILES };
    await nativeWalk(extra.nativeRoot, maxDepth, async (rel) => {
      const t = await (io?.read(rel) ?? Promise.resolve({ ok: false as const }));
      if (!t.ok || typeof t.text !== "string" || t.text.length > MAX_TEXT) return;
      console.log("[loadProjectJava] NATIVE FOUND:", rel);
      out.push({ rel, text: t.text });
      nb.remaining--;
    }, nb);
  }

  console.log("[loadProjectJava] total found:", out.length);
  return out;
}
