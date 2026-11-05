// test/xml_m140_snapshots.test.ts — M140：历史版本快照（逻辑层 + 接线护栏）
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SNAP_CAP,
  deleteSnap,
  diffStat,
  fmtSizeParts,
  loadSnaps,
  pruneSnaps,
  pushSnap,
  relTimeParts,
  saveSnaps,
  snapKey,
  type Snap,
} from "../lib/xml/snapshots";

// 最小 localStorage 模拟（含配额：超了就抛，模拟浏览器 QuotaExceededError）
class Store {
  m = new Map<string, string>();
  limit = Infinity;
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    const size = [...this.m.entries()].filter(([kk]) => kk !== k).reduce((n, [, vv]) => n + vv.length, 0) + v.length;
    if (size > this.limit) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const g = globalThis as unknown as { localStorage?: Store };

beforeEach(() => {
  g.localStorage = new Store();
});

function snap(at: number, xml: string, label = "手动"): Snap {
  return { id: String(at), at, label, xml };
}

describe("M140 快照存储", () => {
  it("按文件分开存，不同文件互不污染", () => {
    pushSnap("res/layout/a.xml", "<A />", "保存");
    pushSnap("res/layout/b.xml", "<B />", "保存");
    expect(loadSnaps("res/layout/a.xml").map((s) => s.xml)).toEqual(["<A />"]);
    expect(loadSnaps("res/layout/b.xml").map((s) => s.xml)).toEqual(["<B />"]);
  });

  it("超长路径退化成 hash key，不会把 localStorage 的 key 撑爆", () => {
    const long = "res/layout/" + "x".repeat(300) + ".xml";
    const k = snapKey(long);
    expect(k.length).toBeLessThan(100);
    expect(snapKey(long)).toBe(k);
    expect(snapKey(long + "y")).not.toBe(k);
  });

  it("和最新一条内容相同就不重复存", () => {
    const a = pushSnap("f", "<A />", "保存");
    expect(a.added).toBe(true);
    const b = pushSnap("f", "<A />", "保存");
    expect(b.added).toBe(false);
    expect(loadSnaps("f")).toHaveLength(1);
  });

  it("新的在前，最多留 SNAP_CAP 条", () => {
    for (let i = 0; i < SNAP_CAP + 5; i++) pushSnap("f", `<v${i} />`, "保存", 1000 + i);
    const list = loadSnaps("f");
    expect(list).toHaveLength(SNAP_CAP);
    expect(list[0].xml).toBe(`<v${SNAP_CAP + 4} />`);
    expect(list[list.length - 1].xml).toBe("<v5 />");
  });

  it("总字符数超上限时截断（保留最新的几条）", () => {
    const big = (i: number) => "x".repeat(5000) + i;
    const list = pruneSnaps(Array.from({ length: 10 }, (_, i) => snap(10 - i, big(i))));
    const total = list.reduce((n, s) => n + s.xml.length, 0);
    expect(total).toBeLessThanOrEqual(1_200_000);
    expect(list[0].at).toBe(10);
  });

  it("配额写不进去时逐条丢最旧的，不抛异常", () => {
    g.localStorage!.limit = 3000;
    for (let i = 0; i < 6; i++) pushSnap("q", "y".repeat(900) + i, "保存", i + 1);
    const list = loadSnaps("q");
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThan(6);
    expect(list[0].at).toBe(6); // 最新的必须留下来
  });

  it("删除指定版本 / 清空", () => {
    pushSnap("f", "<A />", "保存", 1);
    pushSnap("f", "<B />", "保存", 2);
    const list = loadSnaps("f");
    const after = deleteSnap("f", list[0].id);
    expect(after).toHaveLength(1);
    expect(after[0].xml).toBe("<A />");
    saveSnaps("f", []);
    expect(loadSnaps("f")).toEqual([]);
  });

  it("存档损坏（不是 JSON）当作空，不炸界面", () => {
    g.localStorage!.setItem(snapKey("f"), "{not json");
    expect(loadSnaps("f")).toEqual([]);
  });
});

describe("M140 差异与显示", () => {
  it("行级差异：多 2 行少 1 行", () => {
    const a = "<a>\n  <b />\n</a>";
    const b = "<a>\n  <b />\n  <c />\n  <d />\n</a>";
    expect(diffStat(a, b)).toEqual({ added: 2, removed: 0 });
    expect(diffStat(b, a)).toEqual({ added: 0, removed: 2 });
    expect(diffStat(a, a)).toEqual({ added: 0, removed: 0 });
  });

  it("相对时间分档", () => {
    const now = 1_000_000_000_000;
    expect(relTimeParts(now - 10_000, now)).toEqual({ unit: "just", n: 0 });
    expect(relTimeParts(now - 5 * 60000, now)).toEqual({ unit: "min", n: 5 });
    expect(relTimeParts(now - 3 * 3600_000, now)).toEqual({ unit: "hour", n: 3 });
    expect(relTimeParts(now - 2 * 86400_000, now)).toEqual({ unit: "day", n: 2 });
    expect(relTimeParts(now - 60 * 86400_000, now).unit).toBe("date");
  });

  it("体积：小于 1K 用字数，否则 KB", () => {
    expect(fmtSizeParts("abc")).toEqual({ n: 3, kb: false });
    expect(fmtSizeParts("x".repeat(2048))).toEqual({ n: 2, kb: true });
  });
});

describe("M140 接线护栏", () => {
  const root = path.resolve(__dirname, "..");
  const editor = fs.readFileSync(path.join(root, "components/XmlEditor.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "components/HistoryPanel.tsx"), "utf8");
  const toolbar = fs.readFileSync(path.join(root, "components/Toolbar.tsx"), "utf8");

  it("保存成功会存快照（markSaved 里 pushSnap）", () => {
    const i = editor.indexOf("const markSaved");
    expect(i).toBeGreaterThan(-1);
    const body = editor.slice(i, i + 620);
    expect(body).toContain("pushSnap");
    expect(body).toContain("SNAP_LABEL_SAVE");
  });

  it("恢复走 setXmlAndTrack（进撤销栈），且先存「恢复前」", () => {
    expect(panel).toContain("pushSnap(fileKey, currentXml, SNAP_LABEL_BEFORE_RESTORE)");
    const i = editor.indexOf("<HistoryPanel");
    const body = editor.slice(i, i + 900);
    expect(body).toContain("setXmlAndTrack(next)");
  });

  it("工具栏按钮是可选的，不传就不渲染（老测试不炸）", () => {
    expect(toolbar).toContain("onHistory?: () => void");
    expect(toolbar).toMatch(/\{onHistory \? \(/);
  });
});
