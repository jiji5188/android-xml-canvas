// test/xml_m75_chat_store.test.ts — M75：AI 对话按文件持久化
import { describe, expect, it } from "vitest";
import {
  CHAT_BYTES,
  CHAT_CAP,
  CHAT_OUT_MAX,
  capByBytes,
  chatKey,
  clearChatFor,
  decodeChat,
  encodeChat,
  loadChatFor,
  sanitizeChat,
  saveChatFor,
  type ChatStore,
} from "@/lib/xml/ai-chat-store";
import type { ChatItemLike } from "@/lib/xml/ai-chat-types";

function memStore(): ChatStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const user = (content: string): ChatItemLike => ({ role: "user", content });
const asst = (content: string): ChatItemLike => ({ role: "assistant", content });

describe("M75 键名", () => {
  it("一个文件一个桶，路径分隔符归一，不同文件不撞", () => {
    expect(chatKey("a/b.xml")).toContain("a~b.xml");
    expect(chatKey("a/b.xml")).toBe(chatKey("a\\b.xml"));
    expect(chatKey("x.xml")).not.toBe(chatKey("y.xml"));
  });
});

describe("M75 快照清洗", () => {
  it("流式中的半截消息不存", () => {
    const out = sanitizeChat([user("问"), { role: "assistant", content: "半截", streaming: true }]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("问");
  });

  it("running 的工具改 stopped（下次打开别停在转圈）", () => {
    const out = sanitizeChat([
      { role: "assistant", content: "", tool: { name: "read_file", target: "a.xml", state: "running" } },
    ]);
    expect(out[0].tool?.state).toBe("stopped");
  });

  it("工具输出截断到 CHAT_OUT_MAX", () => {
    const big = "x".repeat(CHAT_OUT_MAX * 3);
    const out = sanitizeChat([
      { role: "assistant", content: "", tool: { name: "read_file", target: "a.xml", state: "done", out: big } },
    ]);
    expect(out[0].tool?.out?.length).toBe(CHAT_OUT_MAX);
  });

  it("纯空气泡丢掉，但带工具行的空气泡保留", () => {
    const out = sanitizeChat([
      { role: "assistant", content: "   " },
      { role: "assistant", content: "", tool: { name: "outline", target: "A.java", state: "done" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tool?.name).toBe("outline");
  });

  it("超过 CHAT_CAP 只留最后几条", () => {
    const many: ChatItemLike[] = [];
    for (let i = 0; i < CHAT_CAP + 12; i++) many.push(user(`m${i}`));
    const out = sanitizeChat(many);
    expect(out).toHaveLength(CHAT_CAP);
    expect(out[out.length - 1].content).toBe(`m${CHAT_CAP + 11}`);
  });
});

describe("M75 字节预算", () => {
  it("超预算从最老的丢，最后一条一定保住", () => {
    const items = [user("老".repeat(500)), user("中".repeat(500)), user("新")];
    const out = capByBytes(items, 600);
    expect(out.length).toBeLessThan(3);
    expect(out[out.length - 1].content).toBe("新");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(600);
  });

  it("encodeChat 出来的串不会超过预算（单条除外）", () => {
    const items: ChatItemLike[] = [];
    for (let i = 0; i < 12; i++) items.push(asst("y".repeat(2000)));
    expect(encodeChat(items).length).toBeLessThanOrEqual(CHAT_BYTES);
  });
});

describe("M75 读写", () => {
  it("存了能读回来（角色/代码块/工具都在）", () => {
    const st = memStore();
    const items: ChatItemLike[] = [
      user("改一下"),
      { role: "assistant", content: "好", code: "<Button/>", codeTag: "xml", canReplace: true },
      { role: "assistant", content: "", tool: { name: "apply_patch", target: "a.xml", state: "done", ms: 12, out: "ok" } },
    ];
    expect(saveChatFor(st, "a.xml", items)).toBe(true);
    const back = loadChatFor(st, "a.xml");
    expect(back).toHaveLength(3);
    expect(back[1]).toMatchObject({ code: "<Button/>", codeTag: "xml", canReplace: true });
    expect(back[2].tool).toMatchObject({ name: "apply_patch", state: "done", ms: 12, out: "ok" });
  });

  it("不同文件互不干扰", () => {
    const st = memStore();
    saveChatFor(st, "a.xml", [user("A 的对话")]);
    saveChatFor(st, "b.xml", [user("B 的对话")]);
    expect(loadChatFor(st, "a.xml")[0].content).toBe("A 的对话");
    expect(loadChatFor(st, "b.xml")[0].content).toBe("B 的对话");
  });

  it("空 rel 不读不写（面板没绑文件时不污染存储）", () => {
    const st = memStore();
    expect(saveChatFor(st, "", [user("x")])).toBe(false);
    expect(loadChatFor(st, "")).toEqual([]);
    expect(st.data.size).toBe(0);
  });

  it("坏 JSON / 非数组 / 脏条目都当空或跳过，不抛", () => {
    expect(decodeChat("{oops")).toEqual([]);
    expect(decodeChat('{"a":1}')).toEqual([]);
    const dirty = decodeChat(JSON.stringify([{ role: "system", content: "x" }, { role: "user", content: 1 }, null, "s"]));
    expect(dirty).toEqual([{ role: "user", content: "", code: undefined, codeTag: undefined, canReplace: undefined, tool: undefined }]);
  });

  it("写超配额时不抛（静默放弃持久化）", () => {
    const st: ChatStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(saveChatFor(st, "a.xml", [user("x")])).toBe(false);
  });

  it("清空只清这个文件", () => {
    const st = memStore();
    saveChatFor(st, "a.xml", [user("A")]);
    saveChatFor(st, "b.xml", [user("B")]);
    clearChatFor(st, "a.xml");
    expect(loadChatFor(st, "a.xml")).toEqual([]);
    expect(loadChatFor(st, "b.xml")).toHaveLength(1);
  });
});
