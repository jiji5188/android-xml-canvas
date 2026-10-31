// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  RES_PREFIX,
  projectSaveRoot,
  resAbs,
  resRel,
  saveResFiles,
} from "@/lib/xml/project-save";

describe("M36 project-save 路径", () => {
  it("resAbs 拼出 <项目>/app/src/main/res/<rel>", () => {
    expect(resAbs("/sdcard/AndroidUIIDE/Project/MyApp", "layout/activity_main.xml")).toBe(
      `/sdcard/AndroidUIIDE/Project/MyApp/${RES_PREFIX}/layout/activity_main.xml`,
    );
  });

  it("resAbs 容忍尾部斜杠和多余前缀", () => {
    expect(resAbs("/a/b/", "drawable/x.xml")).toBe("/a/b/app/src/main/res/drawable/x.xml");
    expect(resAbs("/a/b", "app/src/main/res/values/colors.xml")).toBe(
      "/a/b/app/src/main/res/values/colors.xml",
    );
    expect(resRel("app/src/main/res/layout/a.xml")).toBe("layout/a.xml");
  });

  it("projectSaveRoot: native 优先用绝对路径", () => {
    const r = projectSaveRoot({ dirPath: "/sdcard/P/App1", handle: { fake: 1 } });
    expect(r).toEqual({ kind: "native", base: "/sdcard/P/App1" });
  });

  it("projectSaveRoot: 没绝对路径但有句柄 → handle", () => {
    const h = { name: "App2" };
    expect(projectSaveRoot({ handle: h })).toEqual({ kind: "handle", handle: h });
  });

  it("projectSaveRoot: 什么都没有 → null", () => {
    expect(projectSaveRoot(null)).toBeNull();
    expect(projectSaveRoot({})).toBeNull();
    expect(projectSaveRoot({ dirPath: "AndroidUIIDE/Project/X" })).not.toEqual(
      expect.objectContaining({ kind: "native" }),
    );
  });
});

describe("M36 saveResFiles", () => {
  it("native: 每个文件写到 res 子目录，返回 written/total", async () => {
    const calls: [string, string][] = [];
    (window as unknown as { AxvNative: unknown }).AxvNative = {
      writeText: (p: string, b64: string) => {
        calls.push([p, b64]);
        return "ok:" + p;
      },
      getWorkspace: () => "x",
      saveFile: () => "ok",
    };
    const r = await saveResFiles({ kind: "native", base: "/sdcard/P/App" }, [
      { path: "layout/activity_main.xml", text: "<a/>" },
      { path: "values/colors.xml", text: "<b/>" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.written).toBe(2);
    expect(r.failed).toEqual([]);
    expect(r.base).toBe("/sdcard/P/App/app/src/main/res");
    expect(calls.map((c) => c[0])).toEqual([
      "/sdcard/P/App/app/src/main/res/layout/activity_main.xml",
      "/sdcard/P/App/app/src/main/res/values/colors.xml",
    ]);
  });

  it("native: 写失败的文件进 failed，不全成功时 ok 仍为 true（部分成功）", async () => {
    (window as unknown as { AxvNative: unknown }).AxvNative = {
      writeText: (p: string) => (p.includes("values") ? "err:no perm" : "ok:" + p),
      getWorkspace: () => "x",
      saveFile: () => "ok",
    };
    const r = await saveResFiles({ kind: "native", base: "/sdcard/P/App" }, [
      { path: "layout/a.xml", text: "<a/>" },
      { path: "values/colors.xml", text: "<b/>" },
    ]);
    expect(r.written).toBe(1);
    expect(r.failed).toEqual(["values/colors.xml"]);
  });

  it("handle: 逐级建目录再写文件", async () => {
    const log: string[] = [];
    const makeDir = (label: string): unknown => ({
      getDirectoryHandle: async (n: string) => {
        log.push(`dir:${label}/${n}`);
        return makeDir(`${label}/${n}`);
      },
      getFileHandle: async (n: string) => {
        log.push(`file:${label}/${n}`);
        return {
          createWritable: async () => ({
            write: async (d: string) => log.push(`write:${d}`),
            close: async () => log.push("close"),
          }),
        };
      },
    });
    const r = await saveResFiles({ kind: "handle", handle: makeDir("") }, [
      { path: "layout/activity_main.xml", text: "X" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.written).toBe(1);
    expect(log).toContain("dir:/app");
    expect(log).toContain("dir:/app/src");
    expect(log).toContain("dir:/app/src/main/res/layout");
    expect(log).toContain("file:/app/src/main/res/layout/activity_main.xml");
    expect(log).toContain("write:X");
    expect(log).toContain("close");
  });

  it("handle: 句柄不支持 createWritable 时计为失败", async () => {
    const r = await saveResFiles(
      {
        kind: "handle",
        handle: {
          getDirectoryHandle: async () => ({}),
          getFileHandle: async () => ({}),
        },
      },
      [{ path: "layout/a.xml", text: "X" }],
    );
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(["layout/a.xml"]);
  });
});
