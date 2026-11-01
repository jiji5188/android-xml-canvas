// @vitest-environment jsdom
// M63k：浏览器不支持选目录（showDirectoryPicker 缺席 / wsInfo 返回 unsupported）时：
//   · 项目列表不再 12s 轮询（之前每次非静默刷新都会把 wsBusy 抬一下 → 「正在读取…」一直闪）
//   · 也不该再问一遍工作目录
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

const wsInfoMock = vi.fn(async () => ({
  mode: "unsupported" as const,
  label: "",
  custom: false,
  allFiles: false,
}));
const wsListMock = vi.fn(async () => []);

vi.mock("@/lib/xml/workspace", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, wsInfo: () => wsInfoMock(), wsListTopProjects: () => wsListMock() };
});

const { XmlEditor } = await import("@/components/XmlEditor");

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;

beforeEach(() => {
  // 模拟不支持目录选择的浏览器
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  document.body.innerHTML = "";
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  // @ts-expect-error 测试桩
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  Range.prototype.getBoundingClientRect = () => rect;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  wsInfoMock.mockClear();
  wsListMock.mockClear();
});

afterEach(() => {
  if (root) root.unmount();
  root = null;
  vi.useRealTimers();
});

describe("M63k 不支持选目录时不轮询", () => {
  it("打开项目面板后不再周期性问工作目录、也不闪「正在读取…」", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<XmlEditor />);
    await flush(12);

    // 打开左侧「项目管理」（左侧图标条的 Project 按钮）
    const rail = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.getAttribute("title") || "") + " " + (b.getAttribute("aria-label") || "");
      return t.includes("Project") || t.includes("项目");
    });
    expect(rail, "没找到项目管理入口").toBeTruthy();
    rail?.click();
    await flush(12);

    // 允许首次探测（认清 unsupported），之后就该停
    const afterFirst = wsInfoMock.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(40000); // 3 个轮询周期
    await flush(8);

    expect(wsInfoMock.mock.calls.length).toBe(afterFirst);
    expect(wsListMock.mock.calls.length).toBe(0);
    expect(document.body.textContent ?? "").not.toContain("正在读取…");
  });
});
