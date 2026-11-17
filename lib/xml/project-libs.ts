// lib/xml/project-libs.ts — M266：把项目里的依赖库（libs/*.jar、*.aar）读成 base64，
// 打包时传给设备端 ECJ/D8 当 classpath，解决 androidx / jxl 等第三方引用。
// M358：编译扫描 0 容忍——只认标准位置 app/src/main/libs（不再全树 /libs/ 兜底，不认 /app/libs）。
// 共享库 /AndroidUIIDE/libs（跨项目复用）由 M361 单独收集进 classpath，不在本函数里。
//
// 规则：
//   - 只收 app/src/main/libs 下的 .jar / .aar（.so 不碰——那是运行期 native 库，编译用不上）
//   - 单文件 ≤ 15MB，总量 ≤ 40MB（防 Gradle 缓存误扫进几百 MB）
//   - 超了就在返回里标 truncated，调用方 toast 提示

import type { AiFileIo } from "./ai-tools";
import { hasAsyncIo, listDirQueued } from "./native-async";
import { nativeBridge } from "./native-save";

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

  // M358：0 容忍——只直接列 app/src/main/libs，不再全树递归、不认 /app/libs 与任意 /libs/
  // 1) io 通道（SAF）：直接列标准目录
  if (io?.list) {
    const dir = LIBS_BASE;
    const r = await io.list(dir);
    if (r.ok && r.items) {
      for (const it of r.items) {
        if (it.kind === "dir" || !isLibFile(it.name)) continue;
        const rel = `${dir}/${it.name}`;
        const rb = io.readBase64 ? await io.readBase64(rel) : { ok: false as const };
        if (rb.ok && rb.base64) addBase64(rel, rb.base64);
        else if (!rb.ok) failed.push(rel);
      }
    }
  }

  // 2) 原生通道兜底（nativeRoot）：直接列标准目录
  if (nativeRoot && libs.length === 0) {
    const abs = `${nativeRoot.replace(/[\\/]+$/, "")}/${LIBS_BASE}`;
    let json: string | null = null;
    try {
      json = hasAsyncIo() ? await listDirQueued(abs) : nativeListDir(abs).ok ? JSON.stringify(nativeListDir(abs)) : null;
    } catch { json = null; }
    if (json) {
      let parsed: { ok?: boolean; items?: { name: string; kind: string; path?: string }[] };
      try { parsed = JSON.parse(json); } catch { parsed = { ok: false }; }
      if (parsed?.ok && Array.isArray(parsed.items)) {
        for (const it of parsed.items) {
          if (it.kind === "dir" || !isLibFile(it.name)) continue;
          const rel = `${LIBS_BASE}/${it.name}`;
          const absPath = it.path || `${abs}/${it.name}`;
          const b64 = nativeReadBase64(absPath);
          if (b64) addBase64(rel, b64);
          else failed.push(rel);
        }
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
  let names: string[] = [];
  try { names = JSON.parse(n.listDir(base) || "[]"); } catch { return []; }
  const out: ProjectLib[] = [];
  let total = 0;
  for (const raw of names) {
    const n1 = String(raw);
    if (!isLibFile(n1)) continue;
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
