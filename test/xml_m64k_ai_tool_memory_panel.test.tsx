// @vitest-environment jsdom
// test/xml_m64k_ai_tool_memory_panel.test.tsx — M64k（A7）：下一句追问不必重读文件
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

const FILE = '<LinearLayout android:id="@+id/root"><TextView android:text="你好"/></LinearLayout>';
const TOOL_REPLY = '```axv-tool\n{"tool":"read_file","args":{"path":"other.xml"}}\n```';

const systems: string[] = [];
const replies: string[] = [];
let readCalls = 0;
let bump = 0;

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  streamChat: vi.fn(async (_cfg: unknown, msgs: unknown[]) => {
    const arr = msgs as { role: string; content: string }[];
    systems.push(arr[0]?.content || "");
    return { ok: true, content: replies.shift() ?? "", via: "fetch", channel: "fetch" };
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

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

const io: AiFileIo = {
  rootLabel: () => "/proj",
  list: async () => ({ ok: true, items: [] }),
  read: async (rel) => {
    if (rel !== "other.xml") return { ok: false, error: "不存在" };
    readCalls++;
    return { ok: true, text: FILE };
  },
  write: async () => ({ ok: true }),
};

async function ask(el: HTMLElement, q: string) {
  const ta = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, q);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(1);
  ([...el.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => (b.textContent || "").includes("发送"))!.click();
  await flush(15);
}

beforeEach(() => {
  installStorage();
  systems.length = 0;
  replies.length = 0;
  readCalls = 0;
  bump = 0;
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

describe("M64k A7：工具结果进历史", () => {
  it("第二轮追问命中记忆，不再 read 同一文件", async () => {
    replies.push(TOOL_REPLY, "里面有一个根布局 TextView。", "它的 id 是 root。");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel xml="<x/>" docRel="app/src/main/res/layout/a.xml" fileIo={io} onReplaceXml={vi.fn()} onNote={vi.fn()} />,
    );
    await flush();
    await ask(host, "读一下 other.xml 里有什么");
    expect(readCalls).toBe(1);

    await ask(host, "那它的 id 是什么");
    // 第二轮 system prompt 里带着上一轮读到的正文
    const last = systems[systems.length - 1];
    expect(last).toContain("本次会话已经读过");
    expect(last).toContain("other.xml");
    expect(last).toContain("@+id/root");
    // 没有再去读一次
    expect(readCalls).toBe(1);
  });
});
