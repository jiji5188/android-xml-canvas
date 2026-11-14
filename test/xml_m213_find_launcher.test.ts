import { describe, it, expect } from "vitest";
import { deriveLauncherFromSources, findLauncherActivity } from "@/lib/xml/find-launcher";
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

  // M258：两个开标签相同的 <activity>，旧版 indexOf(act) 会全指到第一个 → 块切错，
  //  现在按当前匹配起点切块，能正确取到带 MAIN/LAUNCHER 的那个
  it("M258：同名开标签的两个 activity，取到真正带 launcher 的那个", async () => {
    const io = mkIo({
      "AndroidManifest.xml": `<manifest package="com.x"><application>
        <activity android:name=".Second">
          <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
        </activity>
        <activity android:name=".NotLauncher" android:exported="false" />
      </application></manifest>`,
    });
    expect(await findLauncherActivity(io)).toBe("com.x.Second");
  });

  // M258：<activity-alias> 带 MAIN/LAUNCHER，真入口在 targetActivity
  it("M258：activity-alias 的 launcher 解析到 targetActivity", async () => {
    const io = mkIo({
      "AndroidManifest.xml": `<manifest package="com.x"><application>
        <activity android:name=".MainActivity" android:exported="true" />
        <activity-alias android:name=".LauncherAlias" android:targetActivity=".MainActivity" android:exported="true">
          <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
        </activity-alias>
      </application></manifest>`,
    });
    expect(await findLauncherActivity(io)).toBe("com.x.MainActivity");
  });
});

describe("M258 deriveLauncherFromSources（清单没 launcher 时的兑底）", () => {
  it("从 extends AppCompatActivity 的源码推入口，优先 Main/Home 类名", () => {
    const fqn = deriveLauncherFromSources(
      [
        { path: "app/src/main/java/com/myapp/Helper.java", code: "package com.myapp;\npublic class Helper {}" },
        {
          path: "app/src/main/java/com/myapp/MainActivity.java",
          code: "package com.myapp;\npublic class MainActivity extends AppCompatActivity { void f(){ setContentView(1); } }",
        },
      ],
      "com.myapp",
    );
    expect(fqn).toBe("com.myapp.MainActivity");
  });

  it("路径不规范时用 package 声明 + 文件名拼", () => {
    const fqn = deriveLauncherFromSources(
      [{ path: "MainActivity.java", code: "package com.demo;\npublic class MainActivity extends Activity {}" }],
      "com.demo",
    );
    expect(fqn).toBe("com.demo.MainActivity");
  });

  it("没有 Activity 子类 → 空串（退壳 inflate）", () => {
    expect(deriveLauncherFromSources([{ path: "a/src/main/java/com/x/Util.java", code: "package com.x; class Util {}" }])).toBe("");
  });

  it("abstract Activity 不算入口", () => {
    expect(
      deriveLauncherFromSources([{ path: "src/main/java/com/x/Base.java", code: "package com.x; public abstract class Base extends Activity {}" }]),
    ).toBe("");
  });
});
