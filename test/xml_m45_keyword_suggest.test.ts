// test/xml_m45_keyword_suggest.test.ts — M45：输入关键词检索弹窗（纯函数层）
import { describe, it, expect } from "vitest";
import {
  computeSuggest,
  extractDocumentTokens,
  resourceMatches,
} from "@/lib/xml/keyword-suggest";

describe("extractDocumentTokens", () => {
  it("提取标签名 / 属性名 / 资源引用 / id", () => {
    const doc = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
  <TextView android:id="@+id/tv_title" android:layout_width="match_parent" android:text="hi" />
  <ImageView android:src="@drawable/ic_logo" />
</LinearLayout>`;
    const toks = extractDocumentTokens(doc);
    expect(toks).toContain("LinearLayout");
    expect(toks).toContain("TextView");
    expect(toks).toContain("android:id");
    expect(toks).toContain("android:layout_width");
    expect(toks).toContain("match_parent");
    expect(toks).toContain("@drawable/ic_logo");
    expect(toks).toContain("ic_logo");
    expect(toks).toContain("tv_title");
  });

  it("空文档返回空数组", () => {
    expect(extractDocumentTokens("")).toEqual([]);
  });
});

describe("resourceMatches", () => {
  const res = ["ic_logo", "ic_back", "avatar_round", "bg_card"];

  it("@drawable/ 前缀匹配到资源名", () => {
    const out = resourceMatches("@drawable/i", res);
    expect(out).toContain("@drawable/ic_logo");
    expect(out).toContain("@drawable/ic_back");
    expect(out).not.toContain("@drawable/avatar_round");
  });

  it("非 @ 前缀不匹配", () => {
    expect(resourceMatches("drawable/i", res)).toEqual([]);
  });

  it("没有 / 不匹配", () => {
    expect(resourceMatches("@drawable", res)).toEqual([]);
  });
});

describe("computeSuggest", () => {
  const doc = `<LinearLayout android:id="@+id/root">
  <TextView android:id="@+id/tv_title" android:layout_width="match_parent" />
  <ImageView android:src="@drawable/ic_logo" />
</LinearLayout>`;

  it("标签名上下文：补全已出现的标签", () => {
    // L2: '  <TextView ...'，光标在 "<Te" 之后 = col 6
    const ctx = computeSuggest(doc, { line: 2, col: 6 });
    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.kind).toBe("tag");
      expect(ctx.prefix).toBe("Te");
      expect(ctx.items).toContain("TextView");
    }
  });

  it("属性名上下文：补全高频属性", () => {
    // 在 <LinearLayout 后写 "andr"
    const ctx = computeSuggest(doc, { line: 1, col: 25 });
    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.kind).toBe("attr");
      expect(ctx.prefix).toContain("andr");
      expect(ctx.items).toContain("android:id");
    }
  });

  it("属性值上下文：补全常见值（match_parent / wrap_content）", () => {
    // L2 里 match_parent 从 col 62 开始，写到 "mat" = col 65
    const ctx = computeSuggest(doc, { line: 2, col: 65 });
    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.kind).toBe("value");
      expect(ctx.items).toContain("match_parent");
    }
  });

  it("资源引用上下文：@drawable/ 补全资源名", () => {
    // L3 里 @drawable/i 在 col 38
    const ctx = computeSuggest(doc, { line: 3, col: 38 }, ["ic_logo", "ic_back"]);
    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.kind).toBe("resource");
      expect(ctx.items).toContain("@drawable/ic_logo");
    }
  });

  it("前缀太短（<2 字符）不触发", () => {
    const ctx = computeSuggest(doc, { line: 2, col: 4 });
    expect(ctx).toBeNull();
  });

  it("没有候选时返回 null", () => {
    const ctx = computeSuggest(doc, { line: 1, col: 1 });
    expect(ctx).toBeNull();
  });

  it("注释里不弹候选", () => {
    const cdoc = `<LinearLayout>\n  <!-- android:lay -->\n</LinearLayout>`;
    const ctx = computeSuggest(cdoc, { line: 2, col: 21 });
    expect(ctx).toBeNull();
  });
});
