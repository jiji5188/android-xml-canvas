// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { pickIconFromNames } from "@/lib/xml/project-browse";
import {
  __resetAsyncIoForTest,
  hasAsyncIo,
  listDirQueued,
  readBase64Queued,
  readTextQueued,
  yieldToUi,
} from "@/lib/xml/native-async";

describe("M33 pickIconFromNames", () => {
  it("优先 ic_launcher.png", () => {
    expect(pickIconFromNames(["ic_launcher_round.png", "ic_launcher.png", "icon.png"])).toBe(
      "ic_launcher.png",
    );
  });

  it("没有标准 png 时退到 ic_launcher_round", () => {
    expect(pickIconFromNames(["ic_launcher_round.webp", "icon.png"])).toBe("ic_launcher_round.webp");
  });

  it("排除自适应图标 xml", () => {
    expect(pickIconFromNames(["ic_launcher.xml"])).toBeNull();
  });

  it("排除非图片与不相干文件", () => {
    expect(pickIconFromNames(["strings.xml", "logo.png", "readme.md"])).toBeNull();
  });

  it("ic_launcher_foreground 垫底于普通 ic_launcher", () => {
    expect(pickIconFromNames(["ic_launcher_foreground.png", "ic_launcher.png"])).toBe(
      "ic_launcher.png",
    );
  });
});

describe("M33 native async io", () => {
  beforeEach(() => {
    __resetAsyncIoForTest();
    delete (window as unknown as { AxvNative?: unknown }).AxvNative;
  });

  it("没有桥时 hasAsyncIo=false，读返回 null", async () => {
    expect(hasAsyncIo()).toBe(false);
    await expect(readTextQueued("/x")).resolves.toBeNull();
  });

  it("桥齐三个方法才认为可用", () => {
    (window as unknown as { AxvNative: Record<string, unknown> }).AxvNative = {
      readTextAsync: () => {},
      readBase64Async: () => {},
    };
    expect(hasAsyncIo()).toBe(false);
    (window as unknown as { AxvNative: Record<string, unknown> }).AxvNative = {
      readTextAsync: () => {},
      readBase64Async: () => {},
      listDirAsync: () => {},
    };
    expect(hasAsyncIo()).toBe(true);
  });

  it("回调 __axvIo 后 resolve", async () => {
    const calls: string[] = [];
    (window as unknown as { AxvNative: Record<string, unknown> }).AxvNative = {
      readTextAsync(id: string, target: string) {
        calls.push(target);
        setTimeout(() => {
          (window as unknown as { __axvIo?: (i: string, p: string | null) => void }).__axvIo?.(id, "hello");
        }, 0);
      },
      readBase64Async() {},
      listDirAsync() {},
    };
    await expect(readTextQueued("/a.xml")).resolves.toBe("hello");
    expect(calls).toEqual(["/a.xml"]);
  });

  it("串行：第二个请求等第一个完成才发出", async () => {
    const order: string[] = [];
    const pendingIds: string[] = [];
    (window as unknown as { AxvNative: Record<string, unknown> }).AxvNative = {
      readBase64Async(id: string, target: string) {
        order.push(`start:${target}`);
        pendingIds.push(id);
        // 不立刻回调，靠外部触发
      },
      readTextAsync() {},
      listDirAsync() {},
    };
    const p1 = readBase64Queued("/1.png");
    const p2 = readBase64Queued("/2.png");
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["start:/1.png"]);
    const io = (window as unknown as { __axvIo: (i: string, p: string | null) => void }).__axvIo;
    io(pendingIds[0], "AAA");
    await expect(p1).resolves.toBe("AAA");
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["start:/1.png", "start:/2.png"]);
    io(pendingIds[1], "BBB");
    await expect(p2).resolves.toBe("BBB");
  });

  it("listDir 超时返回 null（不永久挂起）", async () => {
    vi.useFakeTimers();
    (window as unknown as { AxvNative: Record<string, unknown> }).AxvNative = {
      listDirAsync() {},
      readTextAsync() {},
      readBase64Async() {},
    };
    const p = listDirQueued("/dir");
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("yieldToUi 会 resolve", async () => {
    await expect(yieldToUi()).resolves.toBeUndefined();
  });
});
