// @vitest-environment jsdom
// test/xml_m64l_ai_toolrow.test.tsx — M148 改写：工具过程只进「调试日志」面板
//
// 老行为（M64l）：工具调用在聊天流里折成一行小灰字。
// 新行为（M148）：聊天框只显示「用户提问 + 最终回答」，
// 工具调用 / 工具返回 / 报错全部落在底部独立的调试日志面板里，按类型染色。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

const calls = [
  '```axv-tool\n{"tool":"read_file","args":{"path":"a.xml"}}\n```',
  '```axv-tool\n{"tool":"read_file","args":{"path":"missing.xml"}}\n```',
  '```axv-tool\n{"tool":"list_files","args":{"dir":"res"}}\n```',
];
const replies: string[] = [];

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  defaultTimeoutMs: () => 300_000,
  looksLikeToolsRejected: () => false,
  streamChat: vi.fn(async (_cfg: unknown, _msgs: unknown[]) => ({
    ok: true,
    content: replies.shift() ?? "",
    via: "fetch",
    channel: "fetch",
  })),
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

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

const io: AiFileIo = {
  rootLabel: () => "/proj",
  list: async () => ({ ok: true, items: [] }),
  read: async (rel) =>
    rel === "a.xml" ? { ok: true, text: "<LinearLayout/>\n<TextView/>" } : { ok: false, error: "文件不存在" },
  write: async () => ({ ok: true }),
};

async function mount(): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<AiPanel xml="<x/>" docRel="app/src/main/res/layout/a.xml" fileIo={io} onReplaceXml={vi.fn()} onNote={vi.fn()} />);
  await flush();
  return host;
}

async function ask(el: HTMLElement, q: string) {
  const ta = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, q);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(1);
  ([...el.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => (b.textContent || "").includes("发送"))!.click();
  await flush(20);
}

const logText = (el: HTMLElement) => el.querySelector(".axv-ai-log-body")?.textContent || "";
const chatText = (el: HTMLElement) => el.querySelector(".axv-ai-list")?.textContent || "";

beforeEach(() => {
  installStorage();
  replies.length = 0;
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

describe("M148：工具过程进调试日志，聊天框只留最终回答", () => {
  it("两次工具调用 → 日志里两条 tool_call，聊天框没有工具行", async () => {
    replies.push([calls[0], calls[2]].join("\n\n"), "都看完了。");
    const el = await mount();
    await ask(el, "看看这几个文件");

    const rows = el.querySelectorAll(".axv-ai-log-row.k-tool_call");
    expect(rows.length).toBe(2);
    expect(logText(el)).toContain("read_file");
    expect(logText(el)).toContain("a.xml");
    expect(logText(el)).toContain("list_files");

    // 聊天流里不再有工具行，也没有 ⏳/✅ 这类过程标记
    expect(el.querySelectorAll(".axv-ai-tool").length).toBe(0);
    expect(chatText(el)).not.toContain("⏳");
    expect(chatText(el)).not.toContain("✅");
    // 只保留提问 + 最终回答
    expect(chatText(el)).toContain("都看完了。");
  });

  it("工具返回内容整段进日志（可展开的完整输出）", async () => {
    replies.push(calls[0], "读完了。");
    const el = await mount();
    await ask(el, "读一下 a.xml");

    const res = el.querySelector(".axv-ai-log-row.k-tool_result");
    expect(res).not.toBeNull();
    expect(res!.textContent).toContain("<LinearLayout/>");
    expect(chatText(el)).toContain("读完了。");
  });

  it("失败的工具标 error 并带错误原文", async () => {
    replies.push(calls[1], "那个文件不存在。");
    const el = await mount();
    await ask(el, "读 missing.xml");

    const rows = el.querySelectorAll(".axv-ai-log-row.k-error");
    expect(rows.length).toBeGreaterThan(0);
    expect(logText(el)).toContain("文件不存在");
    expect(chatText(el)).toContain("那个文件不存在。");
  });

  it("调试日志面板可以折叠 / 展开，也能一键清空", async () => {
    replies.push("你好。");
    const el = await mount();
    expect(el.querySelector(".axv-ai-log-body")).not.toBeNull();

    // 折叠
    (el.querySelector(".axv-ai-log-toggle") as HTMLButtonElement).click();
    await flush(2);
    expect(el.querySelector(".axv-ai-log-body")).toBeNull();

    // 展开
    (el.querySelector(".axv-ai-log-toggle") as HTMLButtonElement).click();
    await flush(2);
    expect(el.querySelector(".axv-ai-log-body")).not.toBeNull();

    // 清空
    await ask(el, "在吗");
    const before = el.querySelectorAll(".axv-ai-log-row").length;
    expect(before).toBeGreaterThan(0);
    const clearBtn = [...el.querySelectorAll(".axv-ai-log-head button")].find((b) =>
      (b.getAttribute("title") || "").includes("清空"),
    ) as HTMLButtonElement;
    clearBtn.click();
    await flush(2);
    expect(el.querySelectorAll(".axv-ai-log-row").length).toBe(0);
    expect(el.querySelector(".axv-ai-log-empty")).not.toBeNull();
  });
});
