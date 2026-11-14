// lib/xml/project-libs.ts — M266：把项目里的依赖库（libs/*.jar、*.aar）读成 base64，
// 打包时传给设备端 ECJ/D8 当 classpath，解决 androidx / jxl 等第三方引用。
//
// 规则：
//   - 只认路径里含 /libs/ 段的文件（app/libs、libs 根目录都算）
//   - 后缀 .jar / .aar（.so 不碰——那是运行期 native 库，编译用不上）
//   - 单文件 ≤ 15MB，总量 ≤ 40MB（防 Gradle 缓存误扫进几百 MB）
//   - 超了就在返回里标 truncated，调用方 toast 提示

import type { AiFileIo } from "./ai-tools";
import { hasAsyncIo, listDirQueued, readBase64Queued } from "./native-async";
import { nativeBridge } from "./native-save";

export interface ProjectLib {
  /** 相对项目根，如 app/libs/jxl.jar */
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
const MAX_DEPTH = 4;

const isLib = (rel: string) =>
  /(^|\/)libs\/[^\/]+$/i.test(rel.replace(/\\/g, "/")) &&
  /\.(jar|aar)$/i.test(rel);

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

  const tryAdd = async (rel: string): Promise<void> => {
    // io.readBase64
    if (io?.readBase64) {
      const r = await io.readBase64(rel);
      if (r.ok && r.base64) {
        // base64 长度 ≈ 原始字节 × 4/3；粗略判大小
        const bytes = Math.floor(r.base64.length * 0.75);
        if (bytes > MAX_FILE || total + bytes > MAX_TOTAL) {
          skipped.push(rel);
          return;
        }
        total += bytes;
        libs.push({ rel, base64: r.base64 });
        return;
      }
      if (!r.ok) failed.push(rel);
    }
  };

  // 1) io 通道（SAF）：全量递归（深度限制），只收 libs 下的 jar/aar
  if (io) {
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      const r = await io.list(rel);
      if (!r.ok || !r.items) return;
      for (const it of r.items) {
        const childRel = rel ? `${rel}/${it.name}` : it.name;
        if (it.kind === "dir") {
          await walk(childRel, depth + 1);
        } else if (isLib(childRel)) {
          await tryAdd(childRel);
        }
      }
    };
    await walk("", 0);
  }

  // 2) 原生通道兜底（nativeRoot）：找 libs 目录全量递归
  if (nativeRoot && libs.length === 0) {
    const walkN = async (abs: string, rel: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      let json: string | null = null;
      try {
        json = hasAsyncIo() ? await listDirQueued(abs) : nativeListDir(abs).ok ? JSON.stringify(nativeListDir(abs)) : null;
      } catch {
        return;
      }
      if (!json) return;
      let parsed: { ok?: boolean; items?: { name: string; kind: string; path?: string }[] };
      try { parsed = JSON.parse(json); } catch { return; }
      if (!parsed?.ok || !Array.isArray(parsed.items)) return;
      for (const it of parsed.items) {
        const childRel = rel ? rel + "/" + it.name : it.name;
        if (it.kind === "dir") {
          await walkN(it.path || abs + "/" + it.name, childRel, depth + 1);
        } else if (isLib(childRel)) {
          const absPath = it.path || abs + "/" + it.name;
          const b64 = nativeReadBase64(absPath);
          if (b64) {
            const bytes = Math.floor(b64.length * 0.75);
            if (bytes > MAX_FILE || total + bytes > MAX_TOTAL) skipped.push(childRel);
            else { total += bytes; libs.push({ rel: childRel, base64: b64 }); }
          } else {
            failed.push(childRel);
          }
        }
      }
    };
    await walkN(nativeRoot, "", 0);
  }

  return { libs, skipped, failed };
}
