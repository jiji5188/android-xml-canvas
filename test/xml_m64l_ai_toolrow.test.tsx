// @vitest-environment jsdom
// test/xml_m64l_ai_toolrow.test.tsx — M64l（D2）：工具日志折叠成一行
//
// 以前每次工具调用产生两行文字（⏳ 读取 x.xml… → ✅ 读取 x.xml），三轮就是六行，
// 而且正文里没有任何有用信息。现在每步一行小灰字（图标 + 动作 + 目标 + 耗时），
// 点一下才展开工具原始输出，失败的标红。
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

describe("M64l D2：工具日志折叠", () => {
  it("同一次回复里的两次工具调用各占一行，且不再有 ⏳/✅ 气泡", async () => {
    // 单次回复最多解析 2 个工具调用（M64h 上限），所以这里用 2 个
    replies.push([calls[0], calls[2]].join("\n\n"), "都看完了。");
    const el = await mount();
    await ask(el, "看看这几个文件");

    const rows = el.querySelectorAll(".axv-ai-tool");
    expect(rows.length).toBe(2);
    expect(el.querySelector(".axv-ai-list")!.textContent).not.toContain("⏳");
    expect(el.querySelector(".axv-ai-list")!.textContent).not.toContain("✅");
    // 每行带动作 + 目标
    const first = rows[0].textContent || "";
    expect(first).toContain("读取");
    expect(first).toContain("a.xml");
  });

  it("点开才看到工具原始输出，再点收起", async () => {
    replies.push(calls[0], "读完了。");
    const el = await mount();
    await ask(el, "读一下 a.xml");

    const row = el.querySelector(".axv-ai-tool")!;
    expect(row.querySelector(".axv-ai-tool-out")).toBeNull();
    (row.querySelector(".axv-ai-tool-head") as HTMLButtonElement).click();
    await flush(2);
    const out = el.querySelector(".axv-ai-tool-out");
    expect(out).not.toBeNull();
    expect(out!.textContent).toContain("<LinearLayout/>");
    (el.querySelector(".axv-ai-tool-head") as HTMLButtonElement).click();
    await flush(2);
    expect(el.querySelector(".axv-ai-tool-out")).toBeNull();
  });

  it("失败的工具标 error 并带「失败」", async () => {
    replies.push(calls[1], "那个文件不存在。");
    const el = await mount();
    await ask(el, "读 missing.xml");

    const row = el.querySelector(".axv-ai-tool")!;
    expect(row.className).toContain("error");
    expect(row.textContent).toContain("失败");
    // 错误原文在展开后才能看到（默认收起，不刷屏）
    (row.querySelector(".axv-ai-tool-head") as HTMLButtonElement).click();
    await flush(2);
    expect(el.querySelector(".axv-ai-tool-out")!.textContent).toContain("文件不存在");
  });
});
