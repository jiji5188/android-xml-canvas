// @vitest-environment jsdom
// test/xml_m64b_ai_abort.test.tsx — M64b（D3）：点「停止」必须真的停住工具循环
//
// 以前：stop() 只 abort 了流，for 循环继续跑 runTool、还会再发下一轮请求。
// 现在：每轮开头 + 每个工具前 + 每个工具后都检查 signal.aborted。
// 这条测试用一个「卡住不返回」的 read 把流程停在工具执行中间，点停止后再放行，
// 断言：streamChat 只被调了 1 次、没有第二个工具调用、气泡显示「已停止」。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

const TOOL_REPLY = '先看一下文件：\n```axv-tool\n{"tool":"read_file","path":"a.xml"}\n```';

const streamCalls: unknown[][] = [];

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  streamChat: vi.fn(async (...args: unknown[]) => {
    streamCalls.push(args);
    return { ok: true, content: TOOL_REPLY, via: "fetch", channel: "fetch" };
  }),
}));

import AiPanel from "../components/AiPanel";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** jsdom 里可能拿不到 localStorage（opaque origin），自己塞一个内存实现 */
function installStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

async function mount(io: AiFileIo): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<AiPanel xml="<LinearLayout/>" docRel="app/src/main/res/layout/a.xml" fileIo={io} onReplaceXml={vi.fn()} onNote={vi.fn()} />);
  await flush();
  return host;
}

function typeInto(input: HTMLTextAreaElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, v);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const btnByText = (el: HTMLElement, text: string): HTMLButtonElement | null =>
  ([...el.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => (b.textContent || "").includes(text)) ?? null;

beforeEach(() => {
  installStorage();
  streamCalls.length = 0;
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

describe("M64b D3：停止要停住整个工具循环", () => {
  it("工具执行中点停止 → 不再请求下一轮，气泡标已停止", async () => {
    let releaseRead: ((v: { ok: boolean; text?: string }) => void) | null = null;
    let listCalls = 0;
    let readCalls = 0;
    const io: AiFileIo = {
      rootLabel: () => "/proj",
      list: async () => {
        listCalls++;
        return { ok: true, items: [] };
      },
      read: () => {
        readCalls++;
        return new Promise((res) => {
          releaseRead = res;
        });
      },
      write: async () => ({ ok: true }),
    };

    const el = await mount(io);
    const ta = el.querySelector("textarea")!;
    typeInto(ta, "看下 a.xml");
    await flush(1);
    const sendBtn = btnByText(el, "发送");
    expect(sendBtn).not.toBeNull();
    sendBtn!.click();
    await flush(3);

    // 模型第一轮回来了，正在执行 read_file（卡住）
    expect(streamCalls.length).toBe(1);
    expect(readCalls).toBe(1);

    const stopBtn = btnByText(el, "停止");
    expect(stopBtn).not.toBeNull();
    stopBtn!.click();
    await flush(2);

    // 放行那个卡住的 read：若没有 abort 检查，这里会继续拼第二轮消息并再请求一次
    releaseRead!({ ok: true, text: "<x/>" });
    await flush(6);

    expect(streamCalls.length).toBe(1);
    expect(readCalls).toBe(1);
    expect(listCalls).toBe(0);
    expect(el.querySelector(".axv-ai-list")!.textContent || "").toContain("已停止");
    // 停止后不应该再出现「正在生成…」
    expect(el.querySelector(".axv-ai-typing")).toBeNull();
  });
});
