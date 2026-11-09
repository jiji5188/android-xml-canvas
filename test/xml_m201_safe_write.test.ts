// test/xml_m201_safe_write.test.ts — M201：写入安全网（外部改动检测 + 基线 + 写前快照）
import { describe, it, expect, beforeEach } from "vitest";
import {
  hashText,
  baselineKey,
  loadBaseline,
  saveBaseline,
  clearBaseline,
  diskState,
  planWrite,
  firstDiffLine,
  snapshotBeforeWrite,
} from "../lib/xml/safe-write";
import { loadSnaps, SNAP_LABEL_BEFORE_WRITE } from "../lib/xml/snapshots";

/** 极简 localStorage 替身（node 环境没有 window） */
class MemLS {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  const ls = new MemLS();
  const g = globalThis as unknown as { window: { localStorage: MemLS }; localStorage: MemLS };
  g.window = { localStorage: ls };
  // snapshots.ts 用的是裸 localStorage（不挂 window），两边都要给
  g.localStorage = ls;
});

describe("M201 hash 与 key", () => {
  it("同一个内容 hash 稳定，不同内容 hash 不同", () => {
    expect(hashText("<a/>")).toBe(hashText("<a/>"));
    expect(hashText("<a/>")).not.toBe(hashText("<b/>"));
    expect(hashText("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("路径归一化：反斜杠和开头的斜杠不影响 key", () => {
    expect(baselineKey("app\\src\\main\\res\\layout\\a.xml")).toBe(baselineKey("/app/src/main/res/layout/a.xml"));
  });

  it("超长路径退化成 hash key，不会无限长", () => {
    const long = "a/" + "b".repeat(200) + "/c.xml";
    const k = baselineKey(long);
    expect(k.length).toBeLessThan(120);
    expect(k).not.toBe(baselineKey(long + "x"));
  });
});

describe("M201 基线存取", () => {
  it("存了能读回，hash / len / at 都在", () => {
    saveBaseline("res/layout/a.xml", "<LinearLayout/>", 1000);
    const b = loadBaseline("res/layout/a.xml");
    expect(b).not.toBeNull();
    expect(b!.hash).toBe(hashText("<LinearLayout/>"));
    expect(b!.len).toBe("<LinearLayout/>".length);
    expect(b!.at).toBe(1000);
  });

  it("清掉之后读不到", () => {
    saveBaseline("a.xml", "x");
    clearBaseline("a.xml");
    expect(loadBaseline("a.xml")).toBeNull();
  });

  it("坏 JSON 不抛，退化成没有基线", () => {
    (globalThis as unknown as { window: { localStorage: MemLS } }).window.localStorage.setItem(
      baselineKey("a.xml"),
      "{oops",
    );
    expect(loadBaseline("a.xml")).toBeNull();
  });
});

describe("M201 磁盘状态判定", () => {
  const text = "<FrameLayout/>";
  const base = { hash: hashText(text), len: text.length, at: 1 };

  it("没基线 = first，读失败 = unknown", () => {
    expect(diskState(null, text)).toBe("first");
    expect(diskState(base, null, true)).toBe("unknown");
  });

  it("一致 = same，不一致 = changed，文件没了 = missing", () => {
    expect(diskState(base, text)).toBe("same");
    expect(diskState(base, text + " ")).toBe("changed");
    expect(diskState(base, null)).toBe("missing");
  });

  it("长度一样但内容不同也算 changed（不只比长度）", () => {
    expect(diskState(base, "<FrameLayout/>".replace("Frame", "Table"))).toBe("changed");
  });
});

describe("M201 写不写：planWrite", () => {
  const mine = "<a/>";
  const base = { hash: hashText(mine), len: mine.length, at: 1 };

  it("首次写、内容一致、文件被删 → 都放行", () => {
    expect(planWrite(null, "<other/>").go).toBe(true);
    expect(planWrite(base, mine).go).toBe(true);
    const p = planWrite(base, null);
    expect(p.go).toBe(true);
    expect(p.recreate).toBe(true);
  });

  it("外部改过 → 拦下，并标 conflict", () => {
    const p = planWrite(base, "<b/>");
    expect(p.go).toBe(false);
    expect(p.conflict).toBe(true);
    expect(p.state).toBe("changed");
  });

  it("用户点「覆盖保存」（force）→ 放行但仍标出不是首次", () => {
    const p = planWrite(base, "<b/>", true);
    expect(p.go).toBe(true);
    expect(p.conflict).toBe(false);
    expect(p.first).toBe(false);
  });

  it("读不到磁盘 → 不拦（宁可放过也别误伤）", () => {
    const p = planWrite(base, null, false, true);
    expect(p.go).toBe(true);
    expect(p.conflict).toBe(false);
    expect(p.state).toBe("unknown");
  });
});

describe("M201 差异行号", () => {
  it("内容相同返回 0", () => {
    expect(firstDiffLine("a\nb", "a\nb")).toBe(0);
  });

  it("从第 2 行开始不同 → 返回 2", () => {
    expect(firstDiffLine("a\nb\nc", "a\nX\nc")).toBe(2);
  });

  it("一边是另一边的前缀 → 返回短的那边的下一行", () => {
    expect(firstDiffLine("a\nb", "a\nb\nc")).toBe(3);
  });
});

describe("M201 写前快照", () => {
  it("磁盘上有旧内容 → 存一条「写入前」快照", () => {
    const added = snapshotBeforeWrite("res/layout/a.xml", "<old/>", "<new/>");
    expect(added).toBe(true);
    const list = loadSnaps("res/layout/a.xml");
    expect(list.length).toBe(1);
    expect(list[0].label).toBe(SNAP_LABEL_BEFORE_WRITE);
    expect(list[0].xml).toBe("<old/>");
  });

  it("磁盘上没有 / 内容一样 / 只有空白 → 不存", () => {
    expect(snapshotBeforeWrite("b.xml", null, "<new/>")).toBe(false);
    expect(snapshotBeforeWrite("b.xml", "<same/>", "<same/>")).toBe(false);
    expect(snapshotBeforeWrite("b.xml", "   \n", "<new/>")).toBe(false);
    expect(loadSnaps("b.xml").length).toBe(0);
  });
});
