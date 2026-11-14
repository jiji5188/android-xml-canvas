// lib/xml/java-files.ts — M199：把项目里的 Java/Kotlin 源码读成内存文本，喂给运行调试的「轻量逻辑仿真」
//
// 只是「读」：不写、不改、不编译。找不到目录就返回空数组，调用方降级成纯 XML 预览。

import type { AiFileIo } from "./ai-tools";
import { coreSkipDirs, withSkipExtras } from "./skip-dirs";
import { hasAsyncIo, listDirQueued, readTextQueued } from "./native-async";
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

// M241：native 全量递归时直接用原生 readText 读文件（绕开 io.read 可能因路径/权限失败）
async function nativeReadText(rel: string, nativeRoot: string, io: AiFileIo | null | undefined): Promise<string | null> {
  const abs = nativeRoot.replace(/\/+$/, "") + "/" + rel;
  try {
    if (hasAsyncIo()) {
      const t = await readTextQueued(abs);
      return t == null ? null : t;
    }
    const b = nativeBridge() as { readText?: (p: string) => string | null } | null;
    const t = b?.readText?.(abs);
    return t == null ? null : t;
  } catch {
    // 原生读不到再退回 io.read（web 通道）
    if (io) {
      const r = await io.read(rel);
      if (r.ok && typeof r.text === "string") return r.text;
    }
    return null;
  }
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

  // M241：只要给了 nativeRoot 就用原生全量递归兜底（不再只在 out 为空时触发），
  // 用原生 readText 读文件；再把 io 扫到的去重合并，保证 Java 文件不漏。
  if (extra?.nativeRoot) {
    const found = new Set(out.map((x) => x.rel));
    const nb = { remaining: MAX_FILES };
    await nativeWalk(extra.nativeRoot, maxDepth, async (rel) => {
      if (found.has(rel)) return;
      const text = await nativeReadText(rel, extra.nativeRoot!, io);
      if (text == null || text.length > MAX_TEXT) return;
      console.log("[loadProjectJava] NATIVE FOUND:", rel);
      found.add(rel);
      out.push({ rel, text });
      nb.remaining--;
    }, nb);
  }

  console.log("[loadProjectJava] total found:", out.length);
  return out;
}
