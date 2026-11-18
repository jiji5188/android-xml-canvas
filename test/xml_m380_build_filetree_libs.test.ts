// M380：打包侧两处补齐
//  ① fileTree(dir:) 声明的目录也要扫库（以前只扫 app/src/main/libs）
//  ② manifest 里的 @mipmap/app 等资源引用也要参与资源收集（否则 aapt2 link 报 not found）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ftDirToProjectRel, matchFileTreeInclude } from "../lib/xml/libs-utils";
import { collectProjectLibs } from "../lib/xml/project-libs";
import { refsIn } from "../lib/xml/res-collect";

type FakeNative = {
  listDir?: (p: string) => string | null;
  readBase64?: (p: string) => string | null;
  saveFile?: () => void;
};

describe("M380 fileTree 目录解析", () => {
  it("app/build.gradle：libs → app/libs；../libs → libs", () => {
    expect(ftDirToProjectRel("libs", "app/build.gradle")).toBe("app/libs");
    expect(ftDirToProjectRel("../libs", "app/build.gradle")).toBe("libs");
    expect(ftDirToProjectRel("./libs", "app/build.gradle")).toBe("app/libs");
  });

  it("根目录 build.gradle：libs → libs", () => {
    expect(ftDirToProjectRel("libs", "build.gradle")).toBe("libs");
  });

  it("跑出项目根 / 绝对路径 → 空串（不猜）", () => {
    expect(ftDirToProjectRel("../../outside", "app/build.gradle")).toBe("");
    expect(ftDirToProjectRel("/sdcard/libs", "app/build.gradle")).toBe("");
  });

  it("include 过滤：*.jar 后缀；空 = 全过", () => {
    expect(matchFileTreeInclude("a.jar", ["*.jar"])).toBe(true);
    expect(matchFileTreeInclude("a.aar", ["*.jar"])).toBe(false);
    expect(matchFileTreeInclude("a.aar", [])).toBe(true);
    expect(matchFileTreeInclude("a.jar", ["**/*.jar"])).toBe(true);
  });
});

describe("M380 collectProjectLibs 扫 fileTree 目录", () => {
  const setBridge = (b: FakeNative | undefined) => {
    (window as unknown as { AxvNative?: FakeNative }).AxvNative = b;
  };
  beforeEach(() => setBridge(undefined));
  afterEach(() => setBridge(undefined));

  it("库在 ../libs（fileTree 声明）→ 也能收进来，rel 用解析后的项目相对路径", async () => {
    const files: Record<string, string> = {
      "/root/libs/gson.jar": "R1JDSA==",
      "/root/app/src/main/libs/local.jar": "TE9DQUw=",
    };
    setBridge({
      saveFile() {},
      listDir: (p) => JSON.stringify({ ok: true, items: Object.keys(files).filter((f) => f.startsWith(p + "/")).map((f) => ({ name: f.split("/").pop(), kind: "file", path: f })) }),
      readBase64: (p) => files[p] ?? null,
    });
    const gradle = `dependencies {\n  implementation fileTree(dir: '../libs', include: ['*.jar'])\n}`;
    const r = await collectProjectLibs(null, "/root", gradle, "app/build.gradle");
    const rels = r.libs.map((l) => l.rel).sort();
    expect(rels).toEqual(["app/src/main/libs/local.jar", "libs/gson.jar"]);
  });

  it("标准位置找不到库时，fileTree 目录照样能收（旧实现这里返回空）", async () => {
    const files: Record<string, string> = { "/root/libs/only.jar": "T05MWQ==" };
    setBridge({
      saveFile() {},
      listDir: (p) => JSON.stringify({ ok: true, items: Object.keys(files).filter((f) => f.startsWith(p + "/")).map((f) => ({ name: f.split("/").pop(), kind: "file", path: f })) }),
      readBase64: (p) => files[p] ?? null,
    });
    const r = await collectProjectLibs(null, "/root", `implementation fileTree(dir: '../libs')`, "app/build.gradle");
    expect(r.libs.map((l) => l.rel)).toEqual(["libs/only.jar"]);
  });

  it("include 只写了 *.jar → 同目录的 aar 不收", async () => {
    const files: Record<string, string> = { "/root/libs/a.jar": "QQ==", "/root/libs/b.aar": "Qg==" };
    setBridge({
      saveFile() {},
      listDir: (p) => JSON.stringify({ ok: true, items: Object.keys(files).filter((f) => f.startsWith(p + "/")).map((f) => ({ name: f.split("/").pop(), kind: "file", path: f })) }),
      readBase64: (p) => files[p] ?? null,
    });
    const r = await collectProjectLibs(null, "/root", `implementation fileTree(dir: '../libs', include: ['*.jar'])`, "app/build.gradle");
    expect(r.libs.map((l) => l.rel)).toEqual(["libs/a.jar"]);
  });
});

describe("M380 manifest 引用参与资源收集", () => {
  it("refsIn 能从 manifest 文本里认出 @mipmap/app 与 @mipmap/app_round", () => {
    const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.momo.ReturnSystem">\n  <application android:icon="@mipmap/app" android:roundIcon="@mipmap/app_round" android:label="@string/app_name">\n  </application>\n</manifest>`;
    const refs = refsIn(manifest);
    const keys = refs.map((r) => `${r.type}/${r.name}`);
    expect(keys).toContain("mipmap/app");
    expect(keys).toContain("mipmap/app_round");
    expect(keys).toContain("string/app_name");
  });
});
