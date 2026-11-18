// lib/xml/lex-recency.ts — M352 M3：候选「使用记忆」落盘
//
// 背景：候选第二行 / 使用记忆。用户近期反复选中的候选，下次同前缀应该排更前。
// 纯逻辑 + localStorage（浏览器）；Node/单测里无 window 时全走内存 map，可注入 store。
//
// 设计：
//   - 记录：每次接受候选，该候选名 weight+1（带时间戳，衰减用）。
//   - 读取：导出 Map<候选名, 0~1>，近期（24h 内）高，越旧越低（指数衰减）。
//   - 上限：最多保留 200 个高频候选，防 localStorage 膨胀。
"use client";

const KEY = "axv.lex.recency.v1";

interface RecEntry {
  /** 最近一次选中时间戳（ms） */
  t: number;
  /** 累计次数 */
  n: number;
}

export type Store = { get: (k: string) => string | null; set: (k: string, v: string) => void; del?: (k: string) => void };

const memStore: Store = (() => {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
    },
    del: (k) => {
      m.delete(k);
    },
  };
})();

function defaultStore(): Store {
  if (typeof window !== "undefined" && window.localStorage) {
    const ls = window.localStorage;
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => {
        ls.setItem(k, v);
      },
      del: (k) => {
        ls.removeItem(k);
      },
    };
  }
  return memStore;
}

/** 默认半衰期：12 小时（ms）。超过 24h 视为过期。 */
const HALF_LIFE_MS = 12 * 60 * 60 * 1000;
const EXPIRE_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 200;

function readAll(store: Store): Map<string, RecEntry> {
  const out = new Map<string, RecEntry>();
  try {
    const raw = store.get(KEY);
    if (!raw) return out;
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return out;
    for (const it of arr) {
      if (it && typeof it === "object" && "t" in it && "n" in it && "name" in it) {
        const itn = it as RecEntry & { name: string };
        out.set(itn.name, { t: itn.t, n: itn.n });
      }
    }
  } catch {
    /* 解析失败当空 */
  }
  return out;
}

function writeAll(store: Store, entries: Map<string, RecEntry>): void {
  try {
    const arr = [...entries.entries()].map(([name, e]) => ({ name, t: e.t, n: e.n }));
    store.set(KEY, JSON.stringify(arr));
  } catch {
    /* 配额满就静默丢 */
  }
}

/** 记录一次候选接受（name = 候选文本，如 setText / TextView）。浏览器走 localStorage，Node 走内存。 */
export function recordUsage(name: string, now: number = Date.now(), store: Store = defaultStore()): void {
  if (!name) return;
  const m = readAll(store);
  const cur = m.get(name) ?? { t: now, n: 0 };
  cur.t = now;
  cur.n += 1;
  m.set(name, cur);
  // 控制体积：超过上限就丢掉最久未用的
  if (m.size > MAX_KEYS) {
    const arr = [...m.entries()].sort((a, b) => a[1].t - b[1].t);
    while (arr.length > MAX_KEYS) {
      const [k] = arr.shift() as [string, RecEntry];
      m.delete(k);
    }
  }
  writeAll(store, m);
}

/** 导出 recency Map（候选名 → 0~1 权重）。近期高、衰减、过期剔除。 */
export function loadRecency(now: number = Date.now(), store: Store = defaultStore()): Map<string, number> {
  const m = readAll(store);
  const out = new Map<string, number>();
  for (const [name, e] of m) {
    const age = now - e.t;
    if (age > EXPIRE_MS) continue; // 过期
    const decay = Math.pow(0.5, age / HALF_LIFE_MS);
    // 次数给个上限（最多 1.0 加成），避免单次刷爆
    const weight = Math.min(1, e.n * 0.15) * decay;
    if (weight > 0.02) out.set(name, weight);
  }
  return out;
}

/** 清空（测试 / 用户重置）。 */
export function clearRecency(store: Store = defaultStore()): void {
  try {
    store.del?.(KEY);
  } catch {
    /* ignore */
  }
}
