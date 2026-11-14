// test/xml_m241_java_native_fallback.test.ts — M241：loadProjectJavaFiles 原生全量递归兜底
// 只要给了 nativeRoot 就强制 native 全量递归（不再只在 out 为空时触发），
// 且读文件走原生 readText，最后和 io 扫到的去重合并，保证 Java 文件不漏。
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock native-async + native-bridge
const readCalls: string[] = [];
vi.mock("@/lib/xml/native-async", () => ({
  hasAsyncIo: () => false,
  listDirQueued: vi.fn(),
  readTextQueued: vi.fn(),
}));
let nativeDirJson: string | null = null;
let nativeReadMap: Record<string, string> = {};
vi.mock("@/lib/xml/native-save", () => ({
  nativeBridge: () => ({
    listDir: (p: string) => nativeDirJson,
    readText: (p: string) => nativeReadMap[p] ?? null,
  }),
}));

import { loadProjectJavaFiles } from "@/lib/xml/java-files";

beforeEach(() => {
  nativeDirJson = null;
  nativeReadMap = {};
  readCalls.length = 0;
});

describe("loadProjectJavaFiles M241 native 兜底", () => {
  it("io 扫不到、native 全量递归能拿到 .java", async () => {
    // io.list 返回空（模拟 io 通道失效），nativeRoot 给绝对路径
    const io = {
      rootLabel: () => "/root",
      canWrite: false,
      list: async () => ({ ok: true, items: [] as { name: string; kind: string; rel?: string }[] }),
      read: async () => ({ ok: false, error: "no io" }),
      write: async () => ({ ok: false, error: "no" }),
    } as never;
    // 原生 listDir 在 /root 列出一个 .java 文件
    nativeDirJson = JSON.stringify({
      ok: true,
      items: [
        { name: "App.java", kind: "file", path: "/root/App.java" },
      ],
    });
    // 原生 readText 读 /root/App.java（nativeReadText 用 nativeRoot + "/" + rel）
    nativeReadMap["/root/App.java"] = "class App {}";
    const res = await loadProjectJavaFiles(io, 8, { nativeRoot: "/root" });
    // native 递归列了 /root，找到 App.java（file 且 .java）
    expect(res.some((x) => x.rel === "App.java")).toBe(true);
  });

  it("io 已扫到 + native 兜底，去重不重复", async () => {
    const io = {
      rootLabel: () => "/root",
      canWrite: false,
      list: async () => ({ ok: true, items: [] as { name: string; kind: string; rel?: string }[] }),
      read: async (rel: string) => ({ ok: true, text: "io:" + rel }),
      write: async () => ({ ok: false, error: "no" }),
    } as never;
    // io 这轮 list 空，out 空；native 给两个 .java
    nativeDirJson = JSON.stringify({
      ok: true,
      items: [
        { name: "A.java", kind: "file", path: "/root/A.java" },
        { name: "B.java", kind: "file", path: "/root/B.java" },
      ],
    });
    nativeReadMap = {
      "/root/A.java": "class A {}",
      "/root/B.java": "class B {}",
    };
    const res = await loadProjectJavaFiles(io, 8, { nativeRoot: "/root" });
    const names = res.map((x) => x.rel).sort();
    expect(names).toEqual(["A.java", "B.java"]);
  });

  it("没给 nativeRoot 时不触发 native 兜底（纯 io 通道）", async () => {
    const io = {
      rootLabel: () => "/root",
      canWrite: false,
      list: async () => ({ ok: true, items: [] as { name: string; kind: string; rel?: string }[] }),
      read: async () => ({ ok: false, error: "no" }),
      write: async () => ({ ok: false, error: "no" }),
    } as never;
    const res = await loadProjectJavaFiles(io, 8, { nativeRoot: null });
    // nativeDirJson 没设（null），且没 nativeRoot → out 空
    expect(res.length).toBe(0);
  });
});
