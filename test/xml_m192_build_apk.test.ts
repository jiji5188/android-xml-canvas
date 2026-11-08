// @vitest-environment jsdom
// M192：一键打包桥（设备端 aapt2 + 壳 dex + apksig）—— 纯 JS 侧协议测试
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildApk, hasBuildApk, installApk } from "@/lib/xml/native-apk";

type Win = { AxvNative?: Record<string, unknown>; __axvBuildApk?: (id: string, json: string) => void };

function win(): Win {
  return window as unknown as Win;
}

const files = [{ path: "layout/activity_main.xml", text: "<LinearLayout />" }];

beforeEach(() => {
  const w = win();
  delete w.AxvNative;
  delete w.__axvBuildApk;
});

describe("M192 native-apk 桥", () => {
  it("网页版（没有 AxvNative）→ hasBuildApk=false，buildApk 直接给 env 错误", async () => {
    expect(hasBuildApk()).toBe(false);
    const r = await buildApk({
      pkg: "com.demo.app",
      layout: "activity_main",
      files,
      keystore: "/x/ks.p12",
      storePass: "123456",
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe("env");
  });

  it("有桥 → 把 payload 原样交给原生，回调后解析结果", async () => {
    const sent: { id: string; payload: string }[] = [];
    win().AxvNative = {
      buildInstallApkAsync: (id: string, payload: string) => {
        sent.push({ id, payload });
        // 原生侧从别的线程回调
        setTimeout(() => {
          win().__axvBuildApk?.(
            id,
            JSON.stringify({ ok: true, path: "/sdcard/build/com.demo.app.apk", bytes: 204800, ms: 1234 }),
          );
        }, 0);
      },
    };
    expect(hasBuildApk()).toBe(true);

    const r = await buildApk({
      pkg: "com.demo.app",
      layout: "activity_main",
      appName: "Demo",
      files,
      keystore: "/sdcard/proj/.axv/release.p12",
      storePass: "123456",
      alias: "release",
      outName: "demo.apk",
    });

    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(204800);
    expect(r.path).toContain("com.demo.app.apk");
    expect(sent.length).toBe(1);
    const payload = JSON.parse(sent[0].payload);
    expect(payload.pkg).toBe("com.demo.app");
    expect(payload.layout).toBe("activity_main");
    expect(payload.appName).toBe("Demo");
    expect(payload.keystore).toBe("/sdcard/proj/.axv/release.p12");
    expect(payload.files[0].path).toBe("layout/activity_main.xml");
  });

  it("原生回的不是 JSON → 不抛异常，包成 log", async () => {
    win().AxvNative = {
      buildInstallApkAsync: (id: string) => {
        setTimeout(() => win().__axvBuildApk?.(id, "<html>oops"), 0);
      },
    };
    const r = await buildApk({ pkg: "a.b", layout: "activity_main", files, keystore: "/k", storePass: "x" });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("不是合法 JSON");
  });

  it("原生抛异常 → 返回 env 错误，不卡死", async () => {
    win().AxvNative = {
      buildInstallApkAsync: () => {
        throw new Error("bridge boom");
      },
    };
    const r = await buildApk({ pkg: "a.b", layout: "activity_main", files, keystore: "/k", storePass: "x" });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("bridge boom");
  });

  it("installApk：没有桥时给提示，有桥时调一次", () => {
    expect(installApk("/x.apk").ok).toBe(false);
    const fn = vi.fn();
    win().AxvNative = { installApk: fn };
    expect(installApk("/sdcard/build/a.apk").ok).toBe(true);
    expect(fn).toHaveBeenCalledWith("/sdcard/build/a.apk");
  });
});
