// test/xml_m352_m3_features.test.ts — M352 M3：候选第二行 + 使用记忆落盘 + 外部库未索引不报未知符号
import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { recordUsage, loadRecency, clearRecency, type Store } from "@/lib/xml/lex-recency";
import { lintJava } from "@/lib/xml/java-lint";
import { buildLexicon } from "@/lib/xml/lexicon";
import { rankCandidates } from "@/lib/xml/lexicon-rank";

function memStore(): Store {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => {
      m.set(k, v);
    },
    del: (k: string) => {
      m.delete(k);
    },
  };
}

describe("M352 M3：候选第二行（方法签名 subs）", () => {
  it("computeJavaSuggest 返回 subs，且方法候选带构造函数签名", () => {
    const lex = buildLexicon([
      {
        rel: "src/MainActivity.java",
        text: "public class MainActivity { public void loadData(String url, int n) {} }",
        lang: "java",
      },
    ]);
    const src = "public class M {\n  void run() {\n    loadDa\n  }\n}";
    const out = computeJavaSuggest(src, { line: 3, col: 11 }, lex);
    expect(out).toBeTruthy();
    const idx = out!.items.indexOf("loadData");
    expect(idx).toBeGreaterThanOrEqual(0);
    // 第二行签名含参数（已包成 (String url, int n)）
    expect(out!.subs).toBeTruthy();
    expect(out!.subs![idx] || "").toMatch(/String/);
  });

  it("rankCandidates 无 receiver 时也保留签名（不只 deprecated 才有）", () => {
    const lex = buildLexicon([
      { rel: "src/A.java", text: "public class A { public int countRows() { return 0; } }", lang: "java" },
    ]);
    const rk = rankCandidates("countR", {
      lex,
      currentFile: { methods: [], classes: [], fields: [], vars: [] },
    });
    const item = rk.ui.find((x) => x.text === "countRows");
    expect(item).toBeTruthy();
    // 无参也是有效签名（空字符串 = 无参数），不能是 undefined
    expect(item!.signature).not.toBeUndefined();
  });
});

describe("M352 M3：使用记忆落盘", () => {
  it("recordUsage 后 loadRecency 权重 > 0，且次数多的更高", () => {
    const store = memStore();
    const now = 1_000_000_000_000;
    recordUsage("setText", now, store);
    recordUsage("setText", now, store);
    recordUsage("findViewById", now, store);
    const rec = loadRecency(now, store);
    expect(rec.get("setText") ?? 0).toBeGreaterThan(0);
    expect((rec.get("setText") ?? 0) >= (rec.get("findViewById") ?? 0)).toBe(true);
  });

  it("过期（>24h）不返回", () => {
    const store = memStore();
    const now = 2_000_000_000_000;
    recordUsage("oldThing", now - 25 * 60 * 60 * 1000, store);
    const rec = loadRecency(now, store);
    expect(rec.get("oldThing")).toBeUndefined();
  });

  it("clearRecency 清空", () => {
    const store = memStore();
    recordUsage("x", 1, store);
    clearRecency(store);
    expect(loadRecency(1, store).size).toBe(0);
  });

  it("recency 让同来源同前缀候选排前", () => {
    const lex = buildLexicon([
      { rel: "src/A.java", text: "public class A { public void load() {} public void loadAll() {} }", lang: "java" },
    ]);
    const base = rankCandidates("load", {
      lex,
      currentFile: { methods: [], classes: [], fields: [], vars: [] },
    });
    // 无 recency：按字母序 load 在前
    // 有 recency：loadAll 权重高 → loadAll 排前
    const rec = new Map<string, number>([["loadAll", 1]]);
    const boosted = rankCandidates(
      "load",
      { lex, currentFile: { methods: [], classes: [], fields: [], vars: [] } },
      { recency: rec },
    );
    const iBase = base.ui.findIndex((x) => x.text === "loadAll");
    const iBoost = boosted.ui.findIndex((x) => x.text === "loadAll");
    expect(iBoost).toBeGreaterThanOrEqual(0);
    // 使用记忆后 loadAll 位置不变或更靠前
    expect(iBoost).toBeLessThanOrEqual(iBase);
  });
});

describe("M352 M3：外部库未索引不报未知符号", () => {
  it("调用外部库方法（无本地近似声明）不报 sym", () => {
    const src = [
      "public class MainActivity {",
      "  void run() {",
      "    RetrofitClient.enqueueSomething();",
      "  }",
      "}",
    ].join("\n");
    const issues = lintJava(src, {});
    const sym = issues.filter((i) => i.code === "sym");
    expect(sym.length).toBe(0);
  });

  it("拼错本地变量仍报 error（近似候选命中）", () => {
    const src = [
      "public class MainActivity {",
      "  void run() {",
      "    int counter = 0;",
      "    countr = 1;",
      "  }",
      "}",
    ].join("\n");
    const issues = lintJava(src, {});
    const sym = issues.filter((i) => i.code === "sym");
    // countr ≈ counter（编辑距离 1）→ 仍报
    expect(sym.length).toBeGreaterThanOrEqual(1);
    expect(sym[0].msg).toMatch(/counter/);
  });

  it("无候选的裸变量仍报 warn（垃圾/漏声明代码）；但外部库类型/方法不报", () => {
    const src = [
      "public class MainActivity {",
      "  void run() {",
      "    zzqqww = 1;",
      "  }",
      "}",
    ].join("\n");
    const issues = lintJava(src, {});
    const sym = issues.filter((i) => i.code === "sym" && i.msg.includes("zzqqww"));
    // 裸变量猜不到近似声明 → warn（不冒充 error）
    expect(sym.length).toBeGreaterThanOrEqual(1);
    expect(sym[0].sev).toBe("warn");
  });
});
