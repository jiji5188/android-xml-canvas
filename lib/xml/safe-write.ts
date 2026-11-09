// lib/xml/safe-write.ts — M201：写入安全网（外部改动检测 + 基线 + 写前快照）
//
// 为什么需要：我们改的是**用户真实项目的真实文件**。用户可能同时在电脑上
// 用 Android Studio 改同一个布局，或者 git 切了分支。这时候编辑器里还拿着
// 半小时前的旧内容，一点保存就把别人的改动整段抹掉。
//
// 做法（跟 VS Code 的「文件已在磁盘上更改」同一思路）：
//   1. 每次成功写入后记一条「基线」＝ 我写下去的文本的 hash（localStorage）
//   2. 下次写之前先读磁盘，跟基线比：
//        - 一致 → 正常写
//        - 不一致 → 拦下来，让用户选「覆盖 / 载入磁盘版本 / 取消」
//        - 读不到（没权限 / 首次）→ 不拦，避免误伤
//   3. 写之前把磁盘上的旧内容塞进本地快照（label 写入前），随时能翻回去
//
// 纯逻辑 + 只在 load/save 边界碰 localStorage，Node 里可以直接测。

import { pushSnap, SNAP_LABEL_BEFORE_WRITE } from "./snapshots";

export type DiskState = "same" | "changed" | "missing" | "unknown" | "first";

export interface Baseline {
  /** 写入内容的 hash（FNV-1a 32 位，够用且不用异步 crypto） */
  hash: string;
  /** 写入内容的长度，hash 撞了还能挡一道 */
  len: number;
  /** 记录时间 */
  at: number;
}

const BASELINE_PREFIX = "axv.base.v1.";

/** FNV-1a 32 位 → 8 位十六进制。同步、无依赖、跨 Node/浏览器一致 */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 基线 key：路径归一化；太长（手机目录很深）就哈希，避免 localStorage key 爆 */
export function baselineKey(rel: string): string {
  const k = (rel || "untitled").replace(/\\/g, "/").replace(/^\/+/, "");
  if (k.length <= 90) return BASELINE_PREFIX + k;
  return BASELINE_PREFIX + "h" + hashText(k);
}

function hasStore(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadBaseline(rel: string): Baseline | null {
  if (!hasStore()) return null;
  try {
    const raw = localStorage.getItem(baselineKey(rel));
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const b = o as Baseline;
    if (typeof b.hash !== "string" || typeof b.len !== "number") return null;
    return { hash: b.hash, len: b.len, at: typeof b.at === "number" ? b.at : 0 };
  } catch {
    return null;
  }
}

export function saveBaseline(rel: string, text: string, now = Date.now()): void {
  if (!hasStore()) return;
  try {
    const b: Baseline = { hash: hashText(text), len: text.length, at: now };
    localStorage.setItem(baselineKey(rel), JSON.stringify(b));
  } catch {
    /* 存不下就算了，退化成「每次都不拦」 */
  }
}

export function clearBaseline(rel: string): void {
  if (!hasStore()) return;
  try {
    localStorage.removeItem(baselineKey(rel));
  } catch {
    /* ignore */
  }
}

/** 磁盘内容跟基线比：missing = 文件被删了；unknown = 压根没读到 */
export function diskState(b: Baseline | null, diskText: string | null, readFailed = false): DiskState {
  if (readFailed) return "unknown";
  if (!b) return "first";
  if (diskText === null) return "missing";
  if (diskText.length === b.len && hashText(diskText) === b.hash) return "same";
  return "changed";
}

export interface WritePlan {
  /** 允许写 */
  go: boolean;
  /** 拦下来了：外部改过 */
  conflict: boolean;
  /** 第一次写（没有基线），不做比较 */
  first: boolean;
  /** 磁盘上文件没了（外部删掉 / 移走），保存等于重建 */
  recreate: boolean;
  state: DiskState;
}

/** 决定这次要不要拦。force = 用户在弹窗里点了「覆盖保存」 */
export function planWrite(
  b: Baseline | null,
  diskText: string | null,
  force = false,
  readFailed = false,
): WritePlan {
  const state = diskState(b, diskText, readFailed);
  const first = state === "first";
  const recreate = state === "missing";
  const conflict = state === "changed" && !force;
  return { go: !conflict, conflict, first, recreate, state };
}

/** 第一处不同的行号（1 起）；内容相同返回 0。用来在弹窗里说「从第 12 行开始就不一样」 */
export function firstDiffLine(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) if (la[i] !== lb[i]) return i + 1;
  return n + 1;
}

/** 写前快照：把磁盘上的旧内容存进本地历史，label 固定「写入前」。
 *  返回是否真的存了（内容为空 / 跟新内容一样 就不占额度）。 */
export function snapshotBeforeWrite(fileKey: string, diskText: string | null, nextText: string): boolean {
  if (diskText === null) return false;
  if (diskText === nextText) return false;
  if (!diskText.trim()) return false;
  pushSnap(fileKey, diskText, SNAP_LABEL_BEFORE_WRITE);
  return true;
}
