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
  /** M383：收集明细（每行一个候选目录/通道的结果），写进构建日志用 */
  notes?: string[];
}

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;

/** M358：只收标准位置的库文件。 */
export const LIBS_BASE = "app/src/main/libs";
const isLibFile = (name: string) => /\.(jar|aar)$/i.test(name);

/**
 * M414：同名库多版本去重（保留最高版）。
 * 共享库目录里同时有 material-1.12.0.aar 和 material-1.0.0.aar 时，
 * 两个都进 aar overlay → aapt2 link 报「conflicting value for configuration」（真机实测）。
 * 规则：按文件名去掉扩展名后的「artifact 基名」（最后一个 -数字 段之前）分组，
 * 组内保留版本号最大的；同版本保留先出现的（共享库优先）。
 * 只有 .aar 去重（资源 overlay 会撞）；jar 由 M283 的包级去重处理，不动。
 * 返回 { kept, dropped: [{name, reason}] }，reason 写进构建日志。
 */
export function dedupAarVersions(libs: ProjectLib[]): {
  kept: ProjectLib[];
  dropped: { name: string; reason: string }[];
} {
  const parseVer = (name: string): { base: string; ver: number[] | null } => {
    const bare = name.replace(/\.aar$/i, "").toLowerCase();
    // 末尾的版本段：-1.12.0 / -1.0 / 带 SNAPSHOT 的也算
    const m = bare.match(/^(.+?)-(\d+(?:\.\d+)*(?:-[0-9a-z.]+)?)$/);
    if (!m) return { base: bare, ver: null };
    const ver = m[2]
      .replace(/-[0-9a-z.]+$/, "")
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
    return { base: m[1], ver };
  };
  const cmpVer = (a: number[], b: number[]) => {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const best = new Map<string, { lib: ProjectLib; name: string; ver: number[] | null }>();
  const kept: ProjectLib[] = [];
  const dropped: { name: string; reason: string }[] = [];
  libs.forEach((lib) => {
    const fname = lib.rel.split("/").pop() || lib.rel;
    if (!/\.aar$/i.test(fname)) { kept.push(lib); return; }
    const p = parseVer(fname);
    const cur = best.get(p.base);
    if (!cur) {
      best.set(p.base, { lib, name: fname, ver: p.ver });
      kept.push(lib);
      return;
    }
    const c = p.ver && cur.ver ? cmpVer(p.ver, cur.ver) : 0;
    if (c > 0) {
      // 新的高于已收的：替换（把旧的那个从 kept 移除并记 dropped）
      const idx = kept.indexOf(cur.lib);
      if (idx >= 0) kept.splice(idx, 1);
      dropped.push({ name: cur.name, reason: `被更高版 ${fname} 取代` });
      best.set(p.base, { lib, name: fname, ver: p.ver });
      kept.push(lib);
    } else {
      dropped.push({ name: fname, reason: `保留更高版 ${cur.name}` });
    }
  });
  return { kept, dropped };
}

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
  const notes: string[] = [];
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
  /** M383：每个目录 io 通道实际收到几个库（0 的话不能跳过原生补扫） */
  const ioGot = new Map<string, number>();

  // 1) io 通道（SAF）：逐个候选目录直接列
  if (io?.list) {
    for (const cand of candidates) {
      const r = await io.list(cand.rel);
      if (!r.ok || !r.items) {
        notes.push(`io ${cand.rel}: ${r.ok ? "列不到（items 空）" : "list 失败"}`);
        continue;
      }
      let got = 0;
      for (const it of r.items) {
        if (it.kind === "dir" || !acceptName(it.name, cand.includes)) continue;
        if (seenName.has(it.name)) continue; // 同名库已在更早的目录里取过
        const rel = `${cand.rel}/${it.name}`;
        const rb = io.readBase64 ? await io.readBase64(rel) : { ok: false as const };
        if (rb.ok && rb.base64) { seenName.add(it.name); got++; addBase64(rel, rb.base64); }
        else if (!rb.ok) failed.push(rel);
      }
      ioGot.set(cand.rel, got);
      notes.push(`io ${cand.rel}: 列 ${r.items.length} 项 → 收 ${got} 个库`);
    }
  }

  // 2) 原生通道（nativeRoot）：io 看不到 / 收不到库的目录靠这里补
  //  M383：以前 io “列成功”就跳过原生，哪怕一个库也没收到（SAF 树根不是项目根时
  //  会返回空数组）→ 整个 classpath 0 库。现在只跳过“io 真收到了库”的目录。
  if (nativeRoot) {
    const root = nativeRoot.replace(/[\\/]+$/, "");
    for (const cand of candidates) {
      if ((ioGot.get(cand.rel) || 0) > 0) continue;
      const abs = `${root}/${cand.rel}`;
      let json: string | null = null;
      try {
        json = hasAsyncIo() ? await listDirQueued(abs) : nativeListDir(abs).ok ? JSON.stringify(nativeListDir(abs)) : null;
      } catch { json = null; }
      if (!json) { notes.push(`native ${cand.rel}: 列不到`); continue; }
      let parsed: { ok?: boolean; items?: { name: string; kind: string; path?: string }[] };
      try { parsed = JSON.parse(json); } catch { parsed = { ok: false }; }
      if (!parsed?.ok || !Array.isArray(parsed.items)) { notes.push(`native ${cand.rel}: 返回异常`); continue; }
      let got = 0;
      for (const it of parsed.items) {
        if (it.kind === "dir" || !acceptName(it.name, cand.includes)) continue;
        if (seenName.has(it.name)) continue;
        const rel = `${cand.rel}/${it.name}`;
        const absPath = it.path || `${abs}/${it.name}`;
        const b64 = nativeReadBase64(absPath);
        if (b64) { seenName.add(it.name); got++; addBase64(rel, b64); }
        else failed.push(rel);
      }
      notes.push(`native ${cand.rel}: 列 ${parsed.items.length} 项 → 收 ${got} 个库`);
    }
  }

  notes.push(`合计 ${libs.length} 个库${failed.length ? `，读失败 ${failed.length}` : ""}${skipped.length ? `，超限跳过 ${skipped.length}` : ""}`);
  return { libs, skipped, failed, notes };
}

/**
 * M398：共享库候选目录（顺序 = 查找优先级）。
 *  坑（真机根因）：collectSharedLibs 以前用 "/AndroidUIIDE/libs" —— Android 里这是**相对路径**
 *  （new File(path) 相对进程 cwd "/" 解析），canon 后目录不存在 → {ok:false} → 共享库永远是 0 个。
 *  而 LibsPanel 下载/列表用的是绝对路径 /storage/emulated/0/AndroidUIIDE/libs，所以面板能看到库、
 *  编译却收不到 → 用户报「只加载了 app/src/main/libs 的库」。
 *  目录优先级：共享库（下载默认落点）→ 旧相对路径兑底 → 应用私有回退目录（M333 下载回退落点）。
 *  同名文件先到先得（前面目录赢）。
 */
export const SHARED_LIB_DIRS = [
  "/storage/emulated/0/AndroidUIIDE/libs",
  "/AndroidUIIDE/libs",
  "/storage/emulated/0/Android/data/com.jiji.axv/files/axv-libs",
];

/**
 * M361：从共享库目录（跨项目复用）读 jar/aar，进打包 classpath。
 *  maven 坐标引用的库实体就存在共享库；项目 build.gradle 写了坐标、实体在共享库，
 *  打包时把共享库也进 classpath 才能编译过。
 *  用 native 通道（listDir + readBase64）——共享库在 SAF 外部存储，io（SAF 项目树）不覆盖。
 *  返回的 rel 用 shared/ 前缀，打包端据此区分（不写进项目树）。
 */
export async function collectSharedLibs(notes?: string[]): Promise<ProjectLib[]> {
  const n = nativeBridge();
  if (!n?.listDir || !n?.readBase64) { notes?.push("共享库：原生桥不可用（listDir/readBase64 缺失）"); return []; }
  // M379：native listDir 返回的是 {ok, items:[{name,kind,path,size}]}（MainActivity.listDirJson），
  // 不是字符串数组！之前直接 for...of parse 结果 → "a is not iterable"（目录不存在时 {"ok":false} 也是对象，必炸）。
  // M367 只修了 mergeProjectExtras，漏了这里；这是设备端打包必炸的真根因。
  const seen = new Set<string>(); // M398：同名去重，先到先得（目录顺序 = 优先级）
  const out: ProjectLib[] = [];
  let total = 0;
  let readFail = 0;
  let overCap = 0;
  for (const dir of SHARED_LIB_DIRS) {
    let items: { name?: string; kind?: string }[] = [];
    let ok = false;
    try {
      const parsed = JSON.parse(n.listDir(dir) || "{}") as {
        ok?: boolean;
        items?: { name?: string; kind?: string }[];
      };
      if (parsed?.ok && Array.isArray(parsed.items)) { items = parsed.items; ok = true; }
    } catch { notes?.push(`共享库 ${dir}: listDir 返回非 JSON`); continue; }
    if (!ok) {
      notes?.push(`共享库 ${dir}: 不可读（目录不存在或无「所有文件访问」权限）`);
      continue;
    }
    let added = 0;
    let dirFail = 0;
    let dirOver = 0;
    for (const it of items) {
      const n1 = String(it?.name || "");
      if (!n1 || it.kind === "dir" || !isLibFile(n1)) continue;
      const key = n1.toLowerCase();
      if (seen.has(key)) continue; // 同名：优先级高的目录已收
      const abs = `${dir}/${n1}`;
      const b64 = n.readBase64?.(abs) || "";
      if (!b64) { dirFail++; continue; }
      const bytes = Math.floor(b64.length * 0.75);
      if (bytes > MAX_FILE || total + bytes > MAX_TOTAL) { dirOver++; continue; } // 守 40MB 帽
      total += bytes;
      seen.add(key);
      out.push({ rel: `shared/${n1}`, base64: b64 });
      added++;
    }
    readFail += dirFail;
    overCap += dirOver;
    notes?.push(
      `共享库 ${dir}: 列 ${items.length} 项 → 收 ${added} 个` +
        (dirFail ? `，读失败 ${dirFail}` : "") +
        (dirOver ? `，超限跳过 ${dirOver}` : ""),
    );
  }
  notes?.push(
    `共享库合计 ${out.length} 个` +
      (readFail ? `，读失败 ${readFail}` : "") +
      (overCap ? `，超限跳过 ${overCap}` : ""),
  );
  return out;
}
