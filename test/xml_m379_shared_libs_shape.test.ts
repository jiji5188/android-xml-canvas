// M379：collectSharedLibs 必须解析 native listDir 的 {ok, items:[{name,kind}]} 形状。
// 回归背景：设备端打包 "a is not iterable"（M361 引入，M367 只修了 mergeProjectExtras 漏了这里）。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectSharedLibs } from "../lib/xml/project-libs";

type FakeNative = {
  listDir?: (p: string) => string | null;
  readBase64?: (p: string) => string | null;
  saveFile?: () => void;
  getWorkspace?: () => string;
};

function setBridge(b: FakeNative | undefined) {
  (window as unknown as { AxvNative?: FakeNative }).AxvNative = b;
}

describe("M379 collectSharedLibs：native listDir 真实形状", () => {
  beforeEach(() => { setBridge(undefined); });
  afterEach(() => { setBridge(undefined); });

  it("目录不存在（{\"ok\":false}）→ 返回 []（旧实现这里必炸 is not iterable）", async () => {
    setBridge({
      saveFile() {}, getWorkspace() { return ""; },
      listDir: () => JSON.stringify({ ok: false }),
      readBase64: () => null,
    });
    const r = await collectSharedLibs();
    expect(r).toEqual([]);
  });

  it("正常形状 {ok:true,items:[{name,kind}]}：只收 jar/aar 文件，跳过目录", async () => {
    setBridge({
      saveFile() {}, getWorkspace() { return ""; },
      listDir: () => JSON.stringify({
        ok: true,
        items: [
          { name: "gson-2.10.jar", kind: "file", path: "/AndroidUIIDE/libs/gson-2.10.jar", size: 100 },
          { name: "sub", kind: "dir", path: "/AndroidUIIDE/libs/sub", size: 0 },
          { name: "readme.txt", kind: "file", path: "/AndroidUIIDE/libs/readme.txt", size: 3 },
        ],
      }),
      readBase64: (p: string) => (p.endsWith("gson-2.10.jar") ? "AQID" : null),
    });
    const r = await collectSharedLibs();
    expect(r.length).toBe(1);
    expect(r[0].rel).toBe("shared/gson-2.10.jar");
    expect(r[0].base64).toBe("AQID");
  });

  it("畸形返回（对象但没有 items / JSON 坏了 / 纯数组）→ 不炸，返回 []", async () => {
    setBridge({
      saveFile() {}, getWorkspace() { return ""; },
      listDir: () => JSON.stringify({ ok: true }),
    });
    expect(await collectSharedLibs()).toEqual([]);

    setBridge({
      saveFile() {}, getWorkspace() { return ""; },
      listDir: () => "not-json{{{",
    });
    expect(await collectSharedLibs()).toEqual([]);
  });

  it("readBase64 失败/空 → 跳过该文件，不炸", async () => {
    setBridge({
      saveFile() {}, getWorkspace() { return ""; },
      listDir: () => JSON.stringify({ ok: true, items: [{ name: "x.aar", kind: "file", path: "/AndroidUIIDE/libs/x.aar", size: 9 }] }),
      readBase64: () => "",
    });
    expect(await collectSharedLibs()).toEqual([]);
  });
});
