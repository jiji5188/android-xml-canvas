import { describe, it, expect } from "vitest";
import { findLauncherActivity } from "@/lib/xml/find-launcher";
import type { AiFileIo } from "@/lib/xml/ai-tools";

/** 极简假 IO：files 是 rel → 文本 */
function mkIo(files: Record<string, string>): AiFileIo {
  return {
    async list(rel: string) {
      const prefix = rel.replace(/\/+$/, "") + "/";
      const names = new Set<string>();
      for (const k of Object.keys(files)) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          names.add(rest.split("/")[0]);
        }
      }
      return { ok: true, items: [...names].map((n) => ({ name: n, dir: !files[prefix + n] })) };
    },
    async read(rel: string) {
      const t = files[rel];
      return t == null ? { ok: false, error: "not found" } : { ok: true, text: t };
    },
  } as unknown as AiFileIo;
}

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application android:label="Demo">
    <activity android:name=".OtherActivity" android:exported="false" />
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;

describe("M213 findLauncherActivity", () => {
  it("从根清单里找 launcher，并把 .Name 补成全限定名", async () => {
    const io = mkIo({ "AndroidManifest.xml": MANIFEST });
    expect(await findLauncherActivity(io)).toBe("com.example.demo.MainActivity");
  });

  it("清单在 app/src/main/ 也能找到", async () => {
    const io = mkIo({ "app/src/main/AndroidManifest.xml": MANIFEST });
    expect(await findLauncherActivity(io)).toBe("com.example.demo.MainActivity");
  });

  it("没有 launcher（只有普通 activity）→ 返回空串，交给壳 Activity", async () => {
    const io = mkIo({
      "AndroidManifest.xml": `<manifest package="com.x"><application><activity android:name=".A" /></application></manifest>`,
    });
    expect(await findLauncherActivity(io)).toBe("");
  });

  it("完全没有清单 → 空串", async () => {
    expect(await findLauncherActivity(mkIo({}))).toBe("");
  });

  it("io 为 null → 空串（网页版无项目时）", async () => {
    expect(await findLauncherActivity(null)).toBe("");
  });

  it("已是全限定名时不重复拼包名", async () => {
    const io = mkIo({
      "AndroidManifest.xml": `<manifest package="com.x"><application>
        <activity android:name="com.x.Home">
          <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
        </activity></application></manifest>`,
    });
    expect(await findLauncherActivity(io)).toBe("com.x.Home");
  });
});
