// lib/xml/snapshots.ts — M140：历史版本快照
//
// 为什么需要：diffHistory 只覆盖「本次会话的 50 步」，关掉 App / 重启后全是空的，
// 而且它是按键粒度，想「回到昨天那版」根本滚不到。这里存的是整份文档快照，按文件分开。
//
// 存储：localStorage，一文件一个 key。配额有限（浏览器 5MB 上下），所以两道上限：
//   ① 条数 ≤ SNAP_CAP   ② 总字符数 ≤ SNAP_CHARS
// 超了就从最旧的删（永远保留最新一条）。
//
// 纯函数 + 明确副作用边界：读写 localStorage 的只有 load/save 两个，方便测试时 mock。

export interface Snap {
  id: string;
  /** 毫秒时间戳 */
  at: number;
  /** 来源标记：保存 / 手动 / 恢复前 */
  label: string;
  xml: string;
}

/** 快照来源标签：存进 localStorage 的稳定值（不随界面语言变） */
export const SNAP_LABEL_SAVE = "保存";
export const SNAP_LABEL_MANUAL = "手动";
export const SNAP_LABEL_BEFORE_RESTORE = "恢复前";
/** M201：写盘前把磁盘上的旧内容存一份，方便回滚别人/自己的改动 */
export const SNAP_LABEL_BEFORE_WRITE = "写入前";

export const SNAP_CAP = 12;
export const SNAP_CHARS = 1_200_000;
const KEY_PREFIX = "axv.snap.v1.";

/** 每个文件一个 key；路径太长就退化成 hash，避免 key 超长 */
export function snapKey(fileKey: string): string {
  const k = (fileKey || "untitled").replace(/\\/g, "/");
  if (k.length <= 80) return KEY_PREFIX + k;
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return KEY_PREFIX + "h" + (h >>> 0).toString(36);
}

function hasStore(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadSnaps(fileKey: string): Snap[] {
  if (!hasStore()) return [];
  try {
    const raw = localStorage.getItem(snapKey(fileKey));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is Snap =>
        !!s && typeof s === "object" && typeof (s as Snap).xml === "string" && typeof (s as Snap).at === "number",
    );
  } catch {
    return [];
  }
}

/** 写回；空间不够时逐条丢最旧的再试，全丢光了还失败就返回 false */
export function saveSnaps(fileKey: string, list: Snap[]): boolean {
  if (!hasStore()) return false;
  let cur = list.slice(0, SNAP_CAP);
  while (cur.length > 0) {
    try {
      localStorage.setItem(snapKey(fileKey), JSON.stringify(cur));
      return true;
    } catch {
      cur = cur.slice(0, -1); // 砍最旧的一条
    }
  }
  try {
    localStorage.removeItem(snapKey(fileKey));
  } catch {
    // ignore
  }
  return false;
}

/** 按条数 + 体积裁剪（新的在前） */
export function pruneSnaps(list: Snap[]): Snap[] {
  const out: Snap[] = [];
  let chars = 0;
  for (const s of list) {
    const n = s.xml.length;
    if (out.length >= SNAP_CAP) break;
    if (out.length > 0 && chars + n > SNAP_CHARS) break;
    out.push(s);
    chars += n;
  }
  return out;
}

function newId(at: number): string {
  return at.toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/**
 * 存一条快照。和「最新一条」内容完全一样就不重复存（返回原列表）——
 * 反复点保存不该把 12 个位置占满同一份内容。
 */
export function pushSnap(
  fileKey: string,
  xml: string,
  label: string,
  at = Date.now(),
): { list: Snap[]; added: boolean } {
  const cur = loadSnaps(fileKey);
  if (cur.length > 0 && cur[0].xml === xml) return { list: cur, added: false };
  const snap: Snap = { id: newId(at), at, label, xml };
  const list = pruneSnaps([snap, ...cur]);
  saveSnaps(fileKey, list);
  return { list, added: true };
}

export function deleteSnap(fileKey: string, id: string): Snap[] {
  const list = loadSnaps(fileKey).filter((s) => s.id !== id);
  saveSnaps(fileKey, list);
  return list;
}

export function clearSnaps(fileKey: string): void {
  if (!hasStore()) return;
  try {
    localStorage.removeItem(snapKey(fileKey));
  } catch {
    // ignore
  }
}

export interface DiffStat {
  added: number;
  removed: number;
}

/** 行级差异统计（够列表里显示「比现在多/少几行」，不做逐行对齐） */
export function diffStat(a: string, b: string): DiffStat {
  const al = a.split("\n");
  const bl = b.split("\n");
  const pool = new Map<string, number>();
  for (const line of bl) pool.set(line, (pool.get(line) ?? 0) + 1);
  let kept = 0;
  for (const line of al) {
    const n = pool.get(line) ?? 0;
    if (n > 0) {
      kept++;
      pool.set(line, n - 1);
    }
  }
  return { added: bl.length - kept, removed: al.length - kept };
}

/** 相对时间：只算“多久之前”，文案交给 UI 层翻译 */
export interface RelParts {
  unit: "just" | "min" | "hour" | "day" | "date";
  n: number;
}

export function relTimeParts(at: number, now = Date.now()): RelParts {
  const d = Math.max(0, now - at);
  const min = Math.floor(d / 60000);
  if (min < 1) return { unit: "just", n: 0 };
  if (min < 60) return { unit: "min", n: min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { unit: "hour", n: hr };
  const day = Math.floor(hr / 24);
  if (day < 30) return { unit: "day", n: day };
  return { unit: "date", n: at };
}

/** 体积：小于 1K 用字数，否则 KB */
export function fmtSizeParts(xml: string): { n: number; kb: boolean } {
  const n = xml.length;
  if (n < 1024) return { n, kb: false };
  return { n: Math.round((n / 1024) * 10) / 10, kb: true };
}
