// test/xml_m7c_refactor.test.ts — M7c 抽出来的 paths / storage 纯函数
import { afterEach, describe, expect, it } from "vitest";
import {
  collectIds,
  findResolvedNode,
  isSelfOrDescendant,
  pathDepth,
  splitPath,
  stripNs,
} from "../lib/xml/paths";
import { LS_KEY_XML, lsGet, lsGetJson, lsSet, lsSetJson } from "../lib/xml/storage";
import { findNode, parseLayoutXml } from "../lib/xml/parser";
import type { ResolvedNode } from "../lib/xml/types";

/** 造一棵最小渲染树：根 #0，两个子 #0/0、#0/1，后者再带一个孙 #0/1/0 */
function tree(): ResolvedNode {
  const node = (path: string, children: ResolvedNode[] = []): ResolvedNode =>
    ({ path, tag: "View", children } as unknown as ResolvedNode);
  return node("#0", [node("#0/0"), node("#0/1", [node("#0/1/0")])]);
}

describe("findResolvedNode", () => {
  it("命中根节点", () => {
    const root = tree();
    expect(findResolvedNode(root, "#0")).toBe(root);
  });

  it("命中深层节点", () => {
    expect(findResolvedNode(tree(), "#0/1/0")?.path).toBe("#0/1/0");
  });

  it("找不到返回 null；空树也不炸", () => {
    expect(findResolvedNode(tree(), "#0/9")).toBeNull();
    expect(findResolvedNode(null, "#0")).toBeNull();
  });
});

describe("splitPath", () => {
  it("拆出父路径与下标", () => {
    expect(splitPath("#0/1/2")).toEqual({ parentPath: "#0/1", index: 2 });
    expect(splitPath("#0/7")).toEqual({ parentPath: "#0", index: 7 });
  });

  it("父路径能直接交给 findNode（旧实现会得到 ##0/1）", () => {
    const { root } = parseLayoutXml(
      '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView/><Button/></LinearLayout>',
    );
    const btnPath = root!.children[1].path; // #0/1
    const { parentPath, index } = splitPath(btnPath);
    expect(parentPath).toBe("#0");
    expect(index).toBe(1);
    expect(findNode(root!, parentPath)).toBe(root);
  });
});

describe("stripNs", () => {
  it("去掉片段里的 xmlns:android", () => {
    const frag = '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/a"/>';
    expect(stripNs(frag)).toBe('<LinearLayout android:id="@+id/a"/>');
  });

  it("不动其它 xmlns 声明", () => {
    const frag = '<x xmlns:app="http://schemas.android.com/apk/res-auto"/>';
    expect(stripNs(frag)).toBe(frag);
  });
});

describe("collectIds", () => {
  it("深度优先收集所有 id", () => {
    const n = {
      attrs: { id: "@+id/a" },
      children: [{ attrs: { id: "@+id/b" }, children: [{ attrs: { id: "@+id/c" }, children: [] }] }],
    };
    expect(collectIds(n)).toEqual(["@+id/a", "@+id/b", "@+id/c"]);
  });

  it("没有 id 的节点不产生空串", () => {
    expect(collectIds({ attrs: {}, children: [] })).toEqual([]);
    expect(collectIds(null)).toEqual([]);
  });
});

describe("pathDepth / isSelfOrDescendant", () => {
  it("深度", () => {
    expect(pathDepth("#0")).toBe(0);
    expect(pathDepth("#0/1/2")).toBe(2);
  });

  it("拖拽防环判断", () => {
    expect(isSelfOrDescendant("#0/1", "#0/1")).toBe(true);
    expect(isSelfOrDescendant("#0/1", "#0/1/3")).toBe(true);
    expect(isSelfOrDescendant("#0/1", "#0/11")).toBe(false);
    expect(isSelfOrDescendant("#0/1", "#0/2")).toBe(false);
  });
});

describe("storage", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function stubStorage(quota = 1_000_000) {
    const map = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (v.length > quota) throw new Error("QuotaExceeded");
          map.set(k, v);
        },
      },
    };
    return map;
  }

  it("读写字符串", () => {
    stubStorage();
    lsSet(LS_KEY_XML, "<a/>");
    expect(lsGet(LS_KEY_XML)).toBe("<a/>");
  });

  it("环境没有 localStorage 时静默返回 null", () => {
    expect(lsGet("x")).toBeNull();
    expect(() => lsSet("x", "y")).not.toThrow();
  });

  it("JSON 往返 + 损坏内容返回 null", () => {
    const map = stubStorage();
    expect(lsSetJson("k", { a: 1 })).toBe(true);
    expect(lsGetJson<{ a: number }>("k")).toEqual({ a: 1 });
    map.set("bad", "{not json");
    expect(lsGetJson("bad")).toBeNull();
  });

  it("超过上限不写入（避免吃光配额）", () => {
    stubStorage(10);
    expect(lsSetJson("k", { big: "x".repeat(50) }, 10)).toBe(false);
    expect(lsGet("k")).toBeNull();
  });
});
