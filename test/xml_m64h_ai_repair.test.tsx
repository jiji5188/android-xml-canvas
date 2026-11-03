// @vitest-environment jsdom
// test/xml_m64h_ai_repair.test.tsx — M64h（A4）：格式坏了要重问一次，二次失败降级成普通回答
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

const BAD = '我读一下：\n```axv-tool\n{"tool":"read_file","args":{"path":"a.xml",}}\n```';
const GOOD = '```axv-tool\n{"tool":"read_file","args":{"path":"a.xml"}}\n```\n读到了：里面是 <LinearLayout/>。';

const replies: string[] = [];
const sentMessages: string[][] = [];

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  defaultTimeoutMs: () => 300_000,
  streamChat: vi.fn(async (_cfg: unknown, msgs: unknown[]) => {
    sentMessages.push((msgs as { content: string }[]).map((m) => m.content));
    const content = replies.shift() ?? "";
    return { ok: true, content, via: "fetch", channel: "fetch" };
  }),
}));

import AiPanel from "../components/AiPanel";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function installStorage(): void {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    },
  });
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

let readCalls = 0;
// M64i：AiPanel 发请求前会扫项目事实（list res / 读 build.gradle），
// 这里只统计「读 a.xml」这一次，其它路径当不存在
const io: AiFileIo = {
  rootLabel: () => "/proj",
  canWrite: true,
  list: async () => ({ ok: true, items: [] }),
  read: async (rel) => {
    if (rel !== "a.xml") return { ok: false, error: "不存在" };
    readCalls++;
    return { ok: true, text: "<LinearLayout/>" };
  },
  write: async () => ({ ok: true }),
};

async function mount(): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<AiPanel xml="<x/>" docRel="res/layout/a.xml" fileIo={io} onReplaceXml={vi.fn()} onNote={vi.fn()} />);
  await flush();
  return host;
}

async function ask(el: HTMLElement, q = "这个布局长什么样") {
  const ta = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, q);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(1);
  ([...el.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => (b.textContent || "").includes("发送"))!.click();
  await flush(8);
}

beforeEach(() => {
  installStorage();
  replies.length = 0;
  sentMessages.length = 0;
  readCalls = 0;
  window.localStorage.setItem(
    AI_LS_KEY,
    JSON.stringify({ provider: "custom", baseUrl: "https://x/v1", model: "m", apiKey: "k", temperature: 0.2, maxTokens: 1024 }),
  );
});

afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
});

const listText = (el: HTMLElement) => el.querySelector(".axv-ai-list")!.textContent || "";

describe("M64h A4：工具格式修复", () => {
  it("第一次格式坏 → 重问一次并喂回错误原文；第二次合法 → 真正执行", async () => {
    replies.push(BAD, GOOD);
    const el = await mount();
    await ask(el);

    // 3 次：① 坏格式 ② 重问后合法（执行 read） ③ 「工具结果」那一轮
    expect(sentMessages).toHaveLength(3);
    const repair = sentMessages[1][sentMessages[1].length - 1];
    expect(repair).toContain("不能执行");
    expect(repair).toContain("不是合法 JSON");
    expect(repair).toContain('{"tool":"工具名","args":{...}}');
    expect(readCalls).toBe(1);
    expect(listText(el)).toContain("读到了");
    expect(listText(el)).toContain("工具调用格式无效");
  });

  it("两次都坏 → 不执行文件操作，降级成普通回答并标注未改动", async () => {
    replies.push(BAD, BAD);
    const el = await mount();
    await ask(el);

    expect(sentMessages).toHaveLength(2);
    expect(readCalls).toBe(0);
    expect(listText(el)).toContain("本轮未改动文件");
  });

  it("格式一次就对：不触发重问", async () => {
    replies.push(GOOD);
    const el = await mount();
    await ask(el);
    expect(sentMessages).toHaveLength(2); // 第 2 次是「工具结果」那轮
    expect(readCalls).toBe(1);
    expect(sentMessages[1][sentMessages[1].length - 1]).toContain("工具结果");
  });
});
