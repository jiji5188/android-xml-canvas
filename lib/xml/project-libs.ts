// lib/xml/project-libs.ts — M266：把项目里的依赖库（libs/*.jar、*.aar）读成 base64，
// 打包时传给设备端 ECJ/D8 当 classpath，解决 androidx / jxl 等第三方引用。
// M358：编译扫描 0 容忍——以前全树 /libs/ 兜底会误扫。
// M380：现在只认两个来源：标准位置 app/src/main/libs + build.gradle 里 fileTree(dir:) 显式声明的目录
// （用户库放在 ../libs 之类自定义目录时，以前只扫标准位置 → 明明声明了却找不到）。
// 共享库 /AndroidUIIDE/libs（跨项目复用）由 M361 单独收集进 classpath，不在本函数里。
//
// 规则：
//   - 只收 app/src/main/libs 下的 .jar / .aar（.so 不碰——那是运行期 native 库，编译用不上）
//   - 单文件 ≤ 15MB，总量 ≤ 40MB（防 Gradle 缓存误扫进几百 MB）
//   - 超了就在返回里标 truncated，调用方 toast 提示

import type { AiFileIo } from "./ai-tools";
import { hasAsyncIo, listDirQueued } from "./native-async";
import { nativeBridge } from "./native-save";
import { parseFileTrees } from "./gradle-deps";
import { ftDirToProjectRel, matchFileTreeInclude } from "./libs-utils";

export interface ProjectLib {
  /** 相对项目根，如 app/src/main/libs/jxl.jar */
  rel: string;
  base64: string;
}

export interface CollectLibsResult {
  libs: ProjectLib[];
  /** 超过总量上限被跳过的文件 */
  skipped: string[];
  /** 读失败的 */
  failed: string[];
}

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;

/** M358：只收标准位置的库文件。 */
export const LIBS_BASE = "app/src/main/libs";
const isLibFile = (name: string) => /\.(jar|aar)$/i.test(name);

/** 原生通道列目录（绝对路径，同步） */
function nativeListDir(abs: string): { ok: boolean; items?: { name: string; kind: string; path?: string }[] } {
  let json: string | null = null;
  try {
    json = nativeBridge()?.listDir?.(abs) ?? null;
  } catch {
    return { ok: false };
  }
  if (!json) return { ok: false };
  try {
    const p = JSON.parse(json);
    if (!p?.ok || !Array.isArray(p.items)) return { ok: false };
    return { ok: true, items: p.items };
  } catch {
    return { ok: false };
  }
}

/** 原生通道读 base64（绝对路径） */
function nativeReadBase64(abs: string): string | null {
  try {
    return (nativeBridge() as { readBase64?: (p: string) => string | null })?.readBase64?.(abs) ?? null;
  } catch {
    return null;
  }
}

export async function collectProjectLibs(
  io: AiFileIo | null | undefined,
  nativeRoot?: string | null,
  /** M380：build.gradle 原文 —— 里面 fileTree(dir:..) 声明的目录也要扫 */
  gradleText?: string | null,
  /** build.gradle 的项目相对路径（决定 fileTree dir 的基准目录：app/build.gradle → app/） */
  gradleRel?: string | null,
): Promise<CollectLibsResult> {
  const libs: ProjectLib[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  let total = 0;

  const addBase64 = (rel: string, b64: string) => {
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > MAX_FILE || total + bytes > MAX_TOTAL) { skipped.push(rel); return; }
    total += bytes;
    libs.push({ rel, base64: b64 });
  };

  // M380：候选目录 = 标准位置 app/src/main/libs + 每个 fileTree 声明目录（各自 include 过滤）
  //  背景：用户的库不在 app/src/main/libs，而在 build.gradle 的 fileTree(dir: '../libs') 里，
  //  只扫标准目录会让 libs 明明声明了却“不存在”（aapt2/ECJ 都找不到）。
  const candidates: { rel: string; includes: string[] }[] = [{ rel: LIBS_BASE, includes: [] }];
  const seenDir = new Set<string>([LIBS_BASE]);
  if (gradleText) {
    for (const ft of parseFileTrees(gradleText)) {
      const rel = ftDirToProjectRel(ft.dir, gradleRel || "build.gradle");
      if (!rel || seenDir.has(rel)) continue;
      seenDir.add(rel);
      candidates.push({ rel, includes: ft.includes });
    }
  }
  /** 目录里的文件名是否算库：fileTree 声明了 include 就按 include 走，否则只认 jar/aar */
  const acceptName = (name: string, includes: string[]) =>
    includes.length ? matchFileTreeInclude(name, includes) && isLibFile(name) : isLibFile(name);
  const seenName = new Set<string>();
  const ioHandled = new Set<string>();

  // 1) io 通道（SAF）：逐个候选目录直接列
  if (io?.list) {
    for (const cand of candidates) {
      const r = await io.list(cand.rel);
      if (!r.ok || !r.items) continue;
      ioHandled.add(cand.rel);
      for (const it of r.items) {
        if (it.kind === "dir" || !acceptName(it.name, cand.includes)) continue;
        if (seenName.has(it.name)) continue; // 同名库已在更早的目录里取过
        const rel = `${cand.rel}/${it.name}`;
        const rb = io.readBase64 ? await io.readBase64(rel) : { ok: false as const };
        if (rb.ok && rb.base64) { seenName.add(it.name); addBase64(rel, rb.base64); }
        else if (!rb.ok) failed.push(rel);
      }
    }
  }

  // 2) 原生通道（nativeRoot）：io 看不到的目录（SAF 树外，如 ../libs）靠这里补
  if (nativeRoot) {
    const root = nativeRoot.replace(/[\\/]+$/, "");
    for (const cand of candidates) {
      if (ioHandled.has(cand.rel)) continue; // io 已经列过且列到了
      const abs = `${root}/${cand.rel}`;
      let json: string | null = null;
      try {
        json = hasAsyncIo() ? await listDirQueued(abs) : nativeListDir(abs).ok ? JSON.stringify(nativeListDir(abs)) : null;
      } catch { json = null; }
      if (!json) continue;
      let parsed: { ok?: boolean; items?: { name: string; kind: string; path?: string }[] };
      try { parsed = JSON.parse(json); } catch { parsed = { ok: false }; }
      if (!parsed?.ok || !Array.isArray(parsed.items)) continue;
      for (const it of parsed.items) {
        if (it.kind === "dir" || !acceptName(it.name, cand.includes)) continue;
        if (seenName.has(it.name)) continue;
        const rel = `${cand.rel}/${it.name}`;
        const absPath = it.path || `${abs}/${it.name}`;
        const b64 = nativeReadBase64(absPath);
        if (b64) { seenName.add(it.name); addBase64(rel, b64); }
        else failed.push(rel);
      }
    }
  }

  return { libs, skipped, failed };
}

/**
 * M361：从共享库 /AndroidUIIDE/libs（跨项目复用）读 jar/aar，进打包 classpath。
 *  maven 坐标引用的库实体就存在共享库；项目 build.gradle 写了坐标、实体在共享库，
 *  打包时把共享库也进 classpath 才能编译过。
 *  用 native 通道（listDir + readBytesBase64）——共享库在 SAF 外部存储，io（SAF 项目树）不覆盖。
 *  返回的 rel 用 shared/ 前缀，打包端据此区分（不写进项目树）。
 */
export async function collectSharedLibs(): Promise<ProjectLib[]> {
  const n = nativeBridge();
  if (!n?.listDir || !n?.readBase64) return [];
  const base = "/AndroidUIIDE/libs";
  // M379：native listDir 返回的是 {ok, items:[{name,kind,path,size}]}（MainActivity.listDirJson），
  // 不是字符串数组！之前直接 for...of parse 结果 → "a is not iterable"（目录不存在时 {"ok":false} 也是对象，必炸）。
  // M367 只修了 mergeProjectExtras，漏了这里；这是设备端打包必炸的真根因。
  let items: { name?: string; kind?: string }[] = [];
  try {
    const parsed = JSON.parse(n.listDir(base) || "{}") as {
      ok?: boolean;
      items?: { name?: string; kind?: string }[];
    };
    if (parsed?.ok && Array.isArray(parsed.items)) items = parsed.items;
  } catch { return []; }
  const out: ProjectLib[] = [];
  let total = 0;
  for (const it of items) {
    const n1 = String(it?.name || "");
    if (!n1 || it.kind === "dir" || !isLibFile(n1)) continue;
    const abs = `${base}/${n1}`;
    const b64 = n.readBase64?.(abs) || "";
    if (!b64) continue;
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > MAX_FILE || total + bytes > MAX_TOTAL) continue; // 守 40MB 帽
    total += bytes;
    out.push({ rel: `shared/${n1}`, base64: b64 });
  }
  return out;
}
