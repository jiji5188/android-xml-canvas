// @vitest-environment jsdom
// test/xml_m64i_ai_facts_prompt.test.tsx — M64i（A6）：项目事实真的进了 system prompt，且只扫一次
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { AI_LS_KEY } from "@/lib/xml/ai";

let sentSystems: string[] = [];
let listCount = 0;

vi.mock("@/lib/xml/ai-transport", () => ({
  nativeAiAvailable: () => false,
  streamChat: vi.fn(async (_cfg: unknown, msgs: unknown[]) => {
    const arr = msgs as { role: string; content: string }[];
    sentSystems.push(arr[0]?.content || "");
    return { ok: true, content: "好的。", via: "fetch", channel: "fetch" };
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

const TREE: Record<string, string[] | string> = {
  "app/src/main/res": ["drawable", "values"],
  "app/src/main/res/drawable": ["bg_card.xml", "ic_add.xml"],
  "app/src/main/res/values": ["strings.xml"],
  "app/src/main/res/values/strings.xml": '<resources><string name="app_name">MyApp</string></resources>',
  "app/build.gradle": "implementation 'androidx.appcompat:appcompat:1.6.1'",
};

function makeIo(): AiFileIo {
  return {
    rootLabel: () => "/sdcard/AndroidUIIDE/MyApp",
    canWrite: true,
    list: async (rel) => {
      listCount++;
      const v = TREE[rel];
      if (!Array.isArray(v)) return { ok: false, error: "不是目录" };
      return {
        ok: true,
        items: v.map((name) => ({
          name,
          kind: name.includes(".") ? ("file" as const) : ("dir" as const),
          rel: rel ? `${rel}/${name}` : name,
        })),
      };
    },
    read: async (rel) => {
      const v = TREE[rel];
      return typeof v === "string" ? { ok: true, text: v } : { ok: false, error: "不是文件" };
    },
    write: async () => ({ ok: true }),
  };
}

async function ask(el: HTMLElement, q: string) {
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
  sentSystems = [];
  listCount = 0;
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

describe("M64i A6：事实注入", () => {
  it("system prompt 里带真实 drawable/string 名单和库类型", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel
        xml="<LinearLayout/>"
        docRel="app/src/main/res/layout/activity_main.xml"
        fileIo={makeIo()}
        onReplaceXml={vi.fn()}
        onNote={vi.fn()}
      />,
    );
    await flush();
    await ask(host, "给这个布局加个圆角背景");

    const sys = sentSystems[0];
    expect(sys).toContain("项目事实");
    expect(sys).toContain("bg_card");
    expect(sys).toContain("ic_add");
    expect(sys).toContain("app_name");
    expect(sys).toContain("androidx");
    // 没列出的名字要被明确判定为不存在
    expect(sys).toContain("没列出的就当不存在");
  });

  it("同一项目第二轮不重扫（缓存生效）", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <AiPanel
        xml="<LinearLayout/>"
        docRel="app/src/main/res/layout/activity_main.xml"
        fileIo={makeIo()}
        onReplaceXml={vi.fn()}
        onNote={vi.fn()}
      />,
    );
    await flush();
    await ask(host, "第一问");
    const afterFirst = listCount;
    await ask(host, "第二问");
    expect(listCount).toBe(afterFirst);
    expect(sentSystems).toHaveLength(2);
  });
});
