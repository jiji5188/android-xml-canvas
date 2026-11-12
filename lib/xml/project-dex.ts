// lib/xml/project-dex.ts — M211：把项目里「已经编译好的」classes*.dex 收集起来，一起打进生成的 APK
//
// 目的：布局里写了自定义控件（<com.example.MyView ... />）时，没有对应的 class 是 inflate 不出来的
// （运行时报 ClassNotFoundException / InflateException）。本工具设备端不做 Java 编译，
// 所以把用户在 Android Studio 里编出来的 dex 直接带进包里 —— 原生 multidex（API 21+）会自动加载
// classes.dex / classes2.dex / classes3.dex …，ShellActivity 里 inflate 布局时就能找到这些类。
//
// 只是「读」，不改不改。安全护栏：
//   - 只认 .dex（不认 .apk/.jar，避免把整个包塞进来）
//   - 单个 ≤ 12MB，最多 8 个，总 ≤ 40MB（手机内存有限，base64 还要 ×1.33）
//   - 跳过 build 产物外的明显无关目录（.git/.gradle/.idea/node_modules）

import type { AiFileIo } from "./ai-tools";
import { coreSkipDirs as SKIP_DIRS } from "./skip-dirs";

export interface ProjectDexFile {
  /** 相对项目根的路径，仅用于日志/去重 */
  rel: string;
  /** dex 文件名（classes.dex / classes2.dex …） */
  name: string;
  /** base64（NO_WRAP 风格，无换行） */
  base64: string;
  bytes: number;
}

export const DEX_MAX_FILES = 8;
export const DEX_MAX_ONE = 12 * 1024 * 1024;
export const DEX_MAX_TOTAL = 40 * 1024 * 1024;

const isDex = (rel: string) => /(^|\/)classes\d*\.dex$/i.test(rel) || /\.dex$/i.test(rel);

/** base64 粗估字节数（不 decode，省内存） */
function b64bytes(b64: string): number {
  const n = b64.replace(/[^A-Za-z0-9+/=]/g, "").length;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((n * 3) / 4) - pad);
}

/**
 * 扫项目，收集 classes*.dex。找不到 / 没法读 base64 → 返回空数组（调用方当作「没有额外 dex」）。
 * 永远不抛错。
 */
export async function collectProjectDex(
  io: AiFileIo | null | undefined,
  opts?: { maxFiles?: number; maxOne?: number; maxTotal?: number; maxDepth?: number },
): Promise<ProjectDexFile[]> {
  if (!io || typeof io.readBase64 !== "function") return [];
  const readB64 = io.readBase64;
  const maxFiles = opts?.maxFiles ?? DEX_MAX_FILES;
  const maxOne = opts?.maxOne ?? DEX_MAX_ONE;
  const maxTotal = opts?.maxTotal ?? DEX_MAX_TOTAL;
  const maxDepth = opts?.maxDepth ?? 8;

  const found: string[] = [];
  let total = 0;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth || found.length >= maxFiles || total >= maxTotal) return;
    const r = await io.list(rel);
    if (!r.ok) return;
    for (const it of r.items ?? []) {
      if (found.length >= maxFiles || total >= maxTotal) return;
      if (it.kind === "dir") {
        const seg = String(it.rel ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
        if (SKIP_DIRS.has(seg.toLowerCase())) continue;
        await walk(it.rel, depth + 1);
        continue;
      }
      if (!isDex(it.rel)) continue;
      let got: { ok: boolean; base64?: string };
      try {
        got = await readB64(it.rel);
      } catch {
        continue;
      }
      if (!got.ok || !got.base64) continue;
      const bytes = b64bytes(got.base64);
      if (bytes <= 0 || bytes > maxOne) continue;
      if (total + bytes > maxTotal) continue;
      found.push(`${it.rel}\u0000${got.base64}`);
      total += bytes;
    }
  };

  try {
    await walk("", 0);
  } catch {
    return [];
  }

  return found.map((s) => {
    const [rel, base64] = s.split("\u0000");
    const name = rel.replace(/\\/g, "/").split("/").pop() ?? "classes.dex";
    return { rel, name, base64, bytes: b64bytes(base64) };
  });
}

/**
 * 按 multidex 规则给用户 dex 编号：shell 自己占 classes.dex，
 * 所以用户 dex 从 classes2.dex 开始（classes2 / classes3 …）。
 * 输入顺序保持稳定（按路径排序，保证产物可复现）。
 */
export function numberDexFiles(list: ProjectDexFile[]): { name: string; base64: string; bytes: number; rel: string }[] {
  const sorted = [...list].sort((a, b) => a.rel.localeCompare(b.rel));
  return sorted.map((d, i) => ({ name: `classes${i + 2}.dex`, base64: d.base64, bytes: d.bytes, rel: d.rel }));
}
