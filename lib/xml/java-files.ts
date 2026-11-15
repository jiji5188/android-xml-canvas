// lib/xml/java-files.ts — M199：把项目里的 Java/Kotlin 源码读成内存文本，喂给运行调试的「轻量逻辑仿真」
//
// 只是「读」：不写、不改、不编译。找不到目录就返回空数组，调用方降级成纯 XML 预览。

import type { AiFileIo } from "./ai-tools";
import { coreSkipDirs, withSkipExtras } from "./skip-dirs";
import { hasAsyncIo, listDirQueued, readTextQueued } from "./native-async";
import { nativeBridge } from "./native-save";

// 不读 build/ 里的源码（build 产物不是源码）；dex 查找例外（见 project-dex.ts）
const SKIP_DIRS = withSkipExtras(coreSkipDirs, "build");

/** M278：单文件最多读 2MB（以前 400KB，大反编译文件会被静默丢弃） */
const MAX_TEXT = 2 * 1024 * 1024;
/** M278：最多读 2000 个文件（以前 400，大项目会漏类；配合日志能看出是否截断） */
const MAX_FILES = 2000;
/** M278：递归深度放宽到 30（以前 8，深层包目录会被整支剪掉） */
export const MAX_DEPTH = 30;

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

// M278：收集报告——打包日志要能看出「扫到几个、跳过了哪些、为什么跳」，
// 否则漏文件时无从排查（P0-1 的核心诉求）。
export interface JavaCollectReport {
  collected: number;
  /** 因深度/预算/读失败/过大而被跳过的文件（rel + 原因） */
  skipped: { rel: string; reason: string }[];
  truncated: boolean; // 是否触到了 MAX_FILES / MAX_DEPTH 上限
  maxDepth: number;
  maxFiles: number;
  maxText: number;
  nativeWalkUsed: boolean;
}

export async function loadProjectJavaFiles(
  io: AiFileIo | null | undefined,
  maxDepth = MAX_DEPTH,
  extra?: { nativeRoot?: string | null },
  onReport?: (r: JavaCollectReport) => void,
): Promise<{ rel: string; text: string }[]> {
  const out: { rel: string; text: string }[] = [];
  const skipped: { rel: string; reason: string }[] = [];
  let budget = MAX_FILES;
  let truncated = false;
  let nativeWalkUsed = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth) { truncated = true; return; }
    if (budget <= 0) { truncated = true; return; }
    if (!io) return;
    const r = await io.list(rel);
    if (!r.ok) {
      console.log("[loadProjectJava] list failed at", rel, "-", r.error);
      return;
    }
    for (const it of r.items ?? []) {
      if (budget <= 0) { truncated = true; break; }
      if (it.kind === "dir") {
        const seg = it.rel.replace(/\\/g, "/").split("/").pop() ?? "";
        if (SKIP_DIRS.has(seg.toLowerCase())) continue;
        await walk(it.rel, depth + 1);
        continue;
      }
      if (!isCode(it.rel)) continue;
      const t = await io.read(it.rel);
      if (!t.ok || typeof t.text !== "string") {
        skipped.push({ rel: it.rel, reason: "读不到（" + (t.error || "io.read 失败") + "）" });
        continue;
      }
      if (t.text.length > MAX_TEXT) {
        skipped.push({ rel: it.rel, reason: "文件 " + Math.round(t.text.length / 1024) + "KB 超过 " + Math.round(MAX_TEXT / 1024) + "KB 上限" });
        continue;
      }
      out.push({ rel: it.rel, text: t.text });
      budget--;
    }
  };

  await walk("", 0);

  // M241/M278：只要给了 nativeRoot 就用原生全量递归兜底（不再只在 out 为空时触发），
  // 用原生 readText 读文件；再把 io 扫到的去重合并，保证 Java 文件不漏。
  if (extra?.nativeRoot) {
    nativeWalkUsed = true;
    const found = new Set(out.map((x) => x.rel));
    const nb = { remaining: MAX_FILES };
    await nativeWalk(extra.nativeRoot, maxDepth, async (rel) => {
      if (found.has(rel)) return;
      if (nb.remaining <= 0) { truncated = true; return; }
      const text = await nativeReadText(rel, extra.nativeRoot!, io);
      if (text == null) { skipped.push({ rel, reason: "原生/nativeReadText 读不到" }); return; }
      if (text.length > MAX_TEXT) { skipped.push({ rel, reason: "文件 " + Math.round(text.length / 1024) + "KB 超限" }); return; }
      found.add(rel);
      out.push({ rel, text });
      nb.remaining--;
    }, nb);
    if (nb.remaining <= 0) truncated = true;
  }

  onReport?.({ collected: out.length, skipped, truncated, maxDepth, maxFiles: MAX_FILES, maxText: MAX_TEXT, nativeWalkUsed });
  return out;
}
