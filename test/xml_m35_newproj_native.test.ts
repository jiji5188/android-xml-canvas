// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  nativeNewProjectIO,
  nativeVerifyProject,
} from "@/lib/xml/new-project-io";

// 全局桩：nativeBridge 返回最小桥
(window as unknown as { __stubNative?: unknown }).__stubNative = null;

function mockNative(impl: {
  writeText?: (t: string, b64: string) => string;
  listDir?: (p: string) => string;
}) {
  (window as unknown as { AxvNative?: unknown }).AxvNative = {
    saveFile: () => "ok",
    getWorkspace: () => "AndroidUIIDE/Project",
    ...impl,
  };
}

describe("M35 native new project", () => {
  it("nativeNewProjectIO 返回 null 当没有 writeText 桥", () => {
    (window as unknown as { AxvNative?: unknown }).AxvNative = undefined;
    expect(nativeNewProjectIO("/sdcard/AndroidUIIDE/Project", "MyApp")).toBeNull();
  });

  it("nativeNewProjectIO 能写文件（模拟 writeText 成功）", async () => {
    const written: string[] = [];
    mockNative({
      writeText: (t) => {
        written.push(t);
        return "ok:" + t;
      },
    });
    const io = nativeNewProjectIO("/sdcard/AndroidUIIDE/Project", "MyApp")!;
    await io.writeText("app/src/main/res/layout/activity_main.xml", "<x/>");
    expect(written).toEqual(["/sdcard/AndroidUIIDE/Project/MyApp/app/src/main/res/layout/activity_main.xml"]);
  });

  it("nativeVerifyProject 没有 listDir 桥返回 0", () => {
    mockNative({});
    expect(nativeVerifyProject("/sdcard/AndroidUIIDE/Project", "MyApp")).toBe(0);
  });

  it("nativeVerifyProject 目录不存在时返回 0", () => {
    mockNative({
      listDir: () => JSON.stringify({ ok: false }),
    });
    expect(nativeVerifyProject("/sdcard/AndroidUIIDE/Project", "MyApp")).toBe(0);
  });

  it("nativeVerifyProject 目录有 3 项时返回 3", () => {
    mockNative({
      listDir: () =>
        JSON.stringify({ ok: true, items: [{ name: "a" }, { name: "b" }, { name: "c" }] }),
    });
    expect(nativeVerifyProject("/sdcard/AndroidUIIDE/Project", "MyApp")).toBe(3);
  });

  it("nativeVerifyProject 桥抛错时返回 0", () => {
    mockNative({
      listDir: () => {
        throw new Error("boom");
      },
    });
    expect(nativeVerifyProject("/sdcard/AndroidUIIDE/Project", "MyApp")).toBe(0);
  });
});
