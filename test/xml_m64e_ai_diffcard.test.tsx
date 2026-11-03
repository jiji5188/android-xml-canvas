// @vitest-environment jsdom
// test/xml_m64e_ai_diffcard.test.tsx — M64e（B3）：AI 改动先出 diff 卡片，点「全部应用」才落盘
//
// 以前：runTool 直接 write，模型写错就是既成事实，用户连看的机会都没有。
// 现在：写只进暂存 → 卡片显示文件 + -/+ 行数 → 应用时才备份+落盘，并回调编辑器。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

const PATCH_REPLY = [
  "我把标题加上文字：",
  "```axv-tool",
  '{"tool":"apply_patch","path":"res/layout/a.xml","edits":[{"old":"<TextView />","new":"<TextView android:text=\\"Hi\\" />"}]}',
  "```",
].join("\n");

let reply = PATCH_REPLY;
const streamCalls: unknown[][] = [];

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  defaultTimeoutMs: () => 300_000,
  streamChat: vi.fn(async (...args: unknown[]) => {
    streamCalls.push(args);
    return { ok: true, content: reply, via: "fetch", channel: "fetch" };
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

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

function memIo(files: Record<string, string>, onWrite?: (rel: string, text: string) => void): AiFileIo {
  return {
    rootLabel: () => "/proj",
    canWrite: true,
    list: async () => ({ ok: true, items: [] }),
    read: async (rel) => (files[rel] !== undefined ? { ok: true, text: files[rel] } : { ok: false, error: "不存在" }),
    write: async (rel, text) => {
      files[rel] = text;
      onWrite?.(rel, text);
      return { ok: true };
    },
  };
}

const btnByText = (el: HTMLElement, text: string): HTMLButtonElement | null =>
  ([...el.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => (b.textContent || "").includes(text)) ?? null;

async function run(el: HTMLElement, prompt = "改一下标题") {
  const ta = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, prompt);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(1);
  btnByText(el, "发送")!.click();
  await flush(6);
}

beforeEach(() => {
  installStorage();
  streamCalls.length = 0;
  reply = PATCH_REPLY;
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

describe("M64e B3：改动卡片", () => {
  it("AI 写文件只暂存：出卡片、磁盘不动；点应用才落盘并回调", async () => {
    const files: Record<string, string> = { "res/layout/a.xml": "<LinearLayout>\n  <TextView />\n</LinearLayout>" };
    const writes: string[] = [];
    const applied: { rel: string; text: string }[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel
        xml="<LinearLayout/>"
        docRel="res/layout/a.xml"
        fileIo={memIo(files, (rel) => writes.push(rel))}
        onReplaceXml={vi.fn()}
        onNote={vi.fn()}
        onApplied={(p) => applied.push(p)}
      />,
    );
    await flush();
    await run(host);

    // 卡片出现了，文件已经变了但还没写盘
    const card = host.querySelector(".axv-ai-diffcard");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("res/layout/a.xml");
    expect(card!.textContent).toContain("+1");
    expect(files["res/layout/a.xml"]).toContain("<TextView />");
    expect(writes).toEqual([]);

    // 展开看 diff：能看到 -/+ 两行
    btnByText(card as HTMLElement, "res/layout/a.xml")?.click();
    await flush(1);
    const diff = host.querySelector(".axv-ai-diff");
    expect(diff).not.toBeNull();
    expect(diff!.textContent).toContain('android:text="Hi"');
    expect(diff!.querySelector(".op-add")).not.toBeNull();
    expect(diff!.querySelector(".op-del")).not.toBeNull();

    // 应用
    btnByText(card as HTMLElement, "全部应用")!.click();
    await flush(6);

    expect(files["res/layout/a.xml"]).toContain('android:text="Hi"');
    expect(writes.some((w) => w.startsWith(".axv_backup/"))).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0].text).toContain('android:text="Hi"');
    expect(host.querySelector(".axv-ai-diffcard")).toBeNull();
  });

  it("点「放弃」什么都不写", async () => {
    const files: Record<string, string> = { "res/layout/a.xml": "<LinearLayout>\n  <TextView />\n</LinearLayout>" };
    const writes: string[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel
        xml="<LinearLayout/>"
        docRel="res/layout/a.xml"
        fileIo={memIo(files, (rel) => writes.push(rel))}
        onReplaceXml={vi.fn()}
        onNote={vi.fn()}
      />,
    );
    await flush();
    await run(host);

    const card = host.querySelector(".axv-ai-diffcard") as HTMLElement;
    btnByText(card, "放弃")!.click();
    await flush(4);

    expect(writes).toEqual([]);
    expect(files["res/layout/a.xml"]).toContain("<TextView />");
    expect(host.querySelector(".axv-ai-diffcard")).toBeNull();
  });

  it("应用后进历史；点回滚 → 文件恢复成修改前的原文", async () => {
    const ORIG = "<LinearLayout>\n  <TextView />\n</LinearLayout>";
    const files: Record<string, string> = { "res/layout/a.xml": ORIG };
    const applied: { rel: string; text: string }[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel
        xml="<LinearLayout/>"
        docRel="res/layout/a.xml"
        fileIo={memIo(files)}
        onReplaceXml={vi.fn()}
        onNote={vi.fn()}
        onApplied={(p) => applied.push(p)}
      />,
    );
    await flush();
    await run(host);
    btnByText(host.querySelector(".axv-ai-diffcard") as HTMLElement, "全部应用")!.click();
    await flush(6);
    expect(files["res/layout/a.xml"]).toContain('android:text="Hi"');

    const hist = host.querySelector(".axv-ai-hist");
    expect(hist).not.toBeNull();
    expect(hist!.querySelectorAll(".axv-ai-hist-row")).toHaveLength(1);

    btnByText(hist as HTMLElement, "回滚")!.click();
    await flush(8);
    expect(files["res/layout/a.xml"]).toBe(ORIG);
    expect(applied.some((a) => a.text === ORIG)).toBe(true);
    expect(host.querySelector(".axv-ai-hist")).toBeNull();
  });
});
