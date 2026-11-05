// test/setup.ts — M144：jsdom 里补一个 localStorage
//
// 背景：Node 24 自带 `localStorage` 全局（不带 --experimental-webstorage 时访问就返回 undefined），
// vitest 的 jsdom 环境只会把「自己那份 KEYS 列表里」的 window 属性搬到 global，localStorage 不在列表里，
// 结果 window.localStorage 直接是 undefined。AutoSave / 树展开状态都靠它，测试里必须补上。

type Store = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
  key(i: number): string | null;
  readonly length: number;
};

function memoryStorage(): Store {
  const map = new Map<string, string>();
  const store: Store = {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(String(k), String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return store;
}

function install(): void {
  const w = globalThis as unknown as { window?: Window & typeof globalThis; localStorage?: Store };
  const win = typeof window !== "undefined" ? window : w.window;
  if (!win) return; // node 环境的测试不需要
  try {
    if (win.localStorage) return;
  } catch {
    /* 抛错也当没有 */
  }
  const store = memoryStorage();
  try {
    Object.defineProperty(win, "localStorage", { value: store, configurable: true, writable: true });
  } catch {
    /* 定义不了就放弃（老环境） */
  }
  try {
    Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true, writable: true });
  } catch {
    /* 同上 */
  }
}

install();
