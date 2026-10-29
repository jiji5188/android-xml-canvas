import { describe, it, expect } from "vitest";
import { fsAccessSupported } from "../lib/xml/workspace-fs";
import { DEFAULT_NATIVE_DIR, wsInfo, wsListProjects, wsRequestAllFiles, wsNativeAvailable } from "../lib/xml/workspace";

describe("M16i 工作目录", () => {
  it("默认目录常量固定为 /AndroidUIIDE/Project", () => {
    expect(DEFAULT_NATIVE_DIR).toBe("/AndroidUIIDE/Project");
  });

  it("Node（无 window）环境下判定为不支持，且不抛异常", async () => {
    expect(fsAccessSupported()).toBe(false);
    expect(wsNativeAvailable()).toBe(false);
    const info = await wsInfo();
    expect(info.mode).toBe("unsupported");
    expect(info.custom).toBe(false);
    expect(info.allFiles).toBe(false);
  });

  it("不支持的环境下列项目返回空数组（不炸）", async () => {
    await expect(wsListProjects()).resolves.toEqual([]);
  });

  it("没有原生桥时申请权限返回 false", () => {
    expect(wsRequestAllFiles()).toBe(false);
  });
});
