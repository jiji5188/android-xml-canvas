// test/xml_m188c_signing_read.test.ts — M188c：读项目文件 + 没有 build.gradle 时生成模板
// 起因：APK 里点「写入 build.gradle」永远报「项目里没有 app/build.gradle」，
//      根因是代码去摸 window.__axvBridge（真实是 window.AxvNative）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultAppGradle, readSigningFromGradle, type SigningParams } from "../lib/xml/signing";

const P: SigningParams = {
  alias: "release",
  keyPassword: "secret123",
  storeFile: ".axv/release.keystore",
  algorithm: "RSA",
  keySize: 2048,
  validityDays: 10000,
  v1: true,
  v2: true,
  v3: true,
};

describe("M188c defaultAppGradle", () => {
  it("生成带签名配置的完整 build.gradle", () => {
    const r = defaultAppGradle(P, "com.acme.demo");
    expect(r.ok).toBe(true);
    expect(r.next).toContain("id 'com.android.application'");
    expect(r.next).toContain("namespace 'com.acme.demo'");
    expect(r.next).toContain("applicationId 'com.acme.demo'");
    expect(r.next).toContain("minSdk 24");
    expect(r.next).toContain("signingConfigs {");
    expect(r.next).toContain("keyAlias 'release'");
    expect(r.next).toContain("storePassword 'secret123'");
    expect(r.next).toContain("signingConfig signingConfigs.release");
  });

  it("不传包名时用 com.example.app 兜底", () => {
    expect(defaultAppGradle(P).next).toContain("namespace 'com.example.app'");
  });

  it("参数不合法时不生成", () => {
    const r = defaultAppGradle({ ...P, alias: "" });
    expect(r.ok).toBe(false);
    expect(r.next).toBe("");
  });

  it("生成的模板能被 readSigningFromGradle 读回来", () => {
    const back = readSigningFromGradle(defaultAppGradle(P, "com.acme.demo").next);
    expect(back?.alias).toBe("release");
    expect(back?.keyPassword).toBe("secret123");
    expect(back?.v1).toBe(true);
    expect(back?.v2).toBe(true);
    expect(back?.v3).toBe(true);
  });
});

describe("M188c readProjectFile", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("native 根：走 bridge.readText 读内容", async () => {
    const readText = vi.fn(() => "plugins { }");
    (globalThis as { window?: unknown }).window = {
      AxvNative: { saveFile: () => "ok", getWorkspace: () => "w", pickWorkspace: () => {}, readText },
    };
    const { readProjectFile } = await import("../lib/xml/project-save");
    const txt = await readProjectFile({ kind: "native", base: "/sdcard/P/MyApp" }, "app/build.gradle");
    expect(txt).toBe("plugins { }");
    expect(readText).toHaveBeenCalledWith("/sdcard/P/MyApp/app/build.gradle");
  });

  it("native 根：读不到返回 null", async () => {
    (globalThis as { window?: unknown }).window = {
      AxvNative: { saveFile: () => "ok", getWorkspace: () => "w", pickWorkspace: () => {}, readText: () => null },
    };
    const { readProjectFile } = await import("../lib/xml/project-save");
    expect(await readProjectFile({ kind: "native", base: "/sdcard/P/X" }, "app/build.gradle")).toBeNull();
  });

  it("root 为 null 直接 null，不炸", async () => {
    const { readProjectFile } = await import("../lib/xml/project-save");
    expect(await readProjectFile(null, "app/build.gradle")).toBeNull();
  });

  it("handle 根：逐级 getDirectoryHandle → getFile → text", async () => {
    const file = { text: async () => "android { }" };
    const appDir = { getFileHandle: async () => ({ getFile: async () => file }) };
    const root = { getDirectoryHandle: async (n: string) => (n === "app" ? appDir : null) };
    (globalThis as { window?: unknown }).window = undefined;
    const { readProjectFile } = await import("../lib/xml/project-save");
    expect(await readProjectFile({ kind: "handle", handle: root }, "app/build.gradle")).toBe("android { }");
  });

  it("handle 根：目录不存在返回 null", async () => {
    const root = { getDirectoryHandle: async () => { throw new Error("nope"); } };
    const { readProjectFile } = await import("../lib/xml/project-save");
    expect(await readProjectFile({ kind: "handle", handle: root }, "app/build.gradle")).toBeNull();
  });
});
