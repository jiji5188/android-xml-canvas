// M459b：mipmap adaptive XML + 密度 PNG 必须都收集
// 用户报：项目配了图标，APK 桌面仍显示系统默认绿机器人
// 根因：findDirFile 按字母序先命中 mipmap-anydpi-v26/ic_launcher.xml 就 break，
//       minSdk<26 时 API 24/25 设备读不到 anydpi-v26，需要密度 PNG 做 fallback → 全丢
import { describe, expect, it } from "vitest";
import { collectProjectRes } from "@/lib/xml/res-collect";
import type { AiFileIo } from "@/lib/xml/ai-tools";

/** 内存版 io：files 是 rel→内容 的映射（base64 用 img: 前缀） */
function memIo(files: Record<string, string>): AiFileIo {
  const dirs = new Set<string>();
  for (const rel of Object.keys(files)) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    rootLabel: () => "test-proj",
    async read(rel: string) {
      const v = files[rel];
      if (v === undefined || v.startsWith("img:")) return { ok: false, text: "" };
      return { ok: true, text: v };
    },
    async readBase64(rel: string) {
      const v = files[rel];
      if (v === undefined || !v.startsWith("img:")) return { ok: false, base64: "" };
      return { ok: true, base64: v.slice(4) };
    },
    async list(rel: string) {
      if (rel === "") {
        const items = [...dirs].filter((d) => !d.includes("/")).map((d) => ({ name: d, kind: "dir" as const, rel: d }));
        return { ok: true, items };
      }
      const prefix = rel.endsWith("/") ? rel : rel + "/";
      const items: { name: string; kind: "file" | "dir"; rel: string }[] = [];
      const seen = new Set<string>();
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (rest.includes("/")) continue;
        if (seen.has(rest)) continue;
        seen.add(rest);
        items.push({ name: rest, kind: "dir", rel: d });
      }
      for (const rel2 of Object.keys(files)) {
        if (!rel2.startsWith(prefix)) continue;
        const rest = rel2.slice(prefix.length);
        if (rest.includes("/")) continue;
        items.push({ name: rest, kind: "file", rel: rel2 });
      }
      if (!items.length) return { ok: false };
      return { ok: true, items };
    },
    async write() {
      return { ok: true };
    },
  } as AiFileIo;
}

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.test.app">
  <application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" android:label="@string/app_name" />
</manifest>`;

const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" />
</LinearLayout>`;

function baseFiles(): Record<string, string> {
  return {
    "app/src/main/AndroidManifest.xml": MANIFEST,
    "app/src/main/res/values/strings.xml": `<resources><string name="app_name">Test</string></resources>`,
    "app/src/main/res/layout/activity_main.xml": LAYOUT,
    // adaptive XML（任何密度之外）
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background" />
  <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`,
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml": `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background" />
  <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`,
    // 密度 PNG（AIDE 打出来的标准结构：5 个密度 × 2 个图标）
    "app/src/main/res/mipmap-hdpi/ic_launcher.png": "img:AAAA",
    "app/src/main/res/mipmap-xhdpi/ic_launcher.png": "img:BBBB",
    "app/src/main/res/mipmap-xxhdpi/ic_launcher.png": "img:CCCC",
    "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png": "img:DDDD",
    "app/src/main/res/mipmap-mdpi/ic_launcher.png": "img:EEEE",
    "app/src/main/res/mipmap-hdpi/ic_launcher_round.png": "img:FFFF",
    "app/src/main/res/mipmap-xhdpi/ic_launcher_round.png": "img:GGGG",
    "app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png": "img:HHHH",
    "app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png": "img:IIII",
    "app/src/main/res/mipmap-mdpi/ic_launcher_round.png": "img:JJJJ",
    "app/src/main/res/drawable/ic_launcher_background.xml": `<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#26A69A"/></shape>`,
    "app/src/main/res/drawable/ic_launcher_foreground.xml": `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#FFF" android:pathData="M0,0h108v108h-108z"/></vector>`,
  };
}

describe("M459b mipmap 密度 PNG 收集", () => {
  it("adaptive XML + 5 密度 PNG 全部进包（不再只收 anydpi-v26）", async () => {
    const files = baseFiles();
    const r = await collectProjectRes(
      memIo(files),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      200,
      [MANIFEST],
    );
    const paths = r.files.map((f) => f.path);
    console.log("收集到:", paths.filter((p) => p.includes("mipmap")).join("\n  "));

    // adaptive XML 在
    expect(paths.some((p) => p === "mipmap-anydpi-v26/ic_launcher.xml")).toBe(true);
    // 5 个密度 PNG 都在（这是修复的核心）
    for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      expect(paths.some((p) => p === `mipmap-${d}/ic_launcher.png`), `缺 mipmap-${d}/ic_launcher.png`).toBe(true);
    }
    // round 同样
    expect(paths.some((p) => p === "mipmap-anydpi-v26/ic_launcher_round.xml")).toBe(true);
    for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      expect(paths.some((p) => p === `mipmap-${d}/ic_launcher_round.png`), `缺 mipmap-${d}/ic_launcher_round.png`).toBe(true);
    }
    // 密度 PNG 必须带真实 base64（不是空文本）
    const hdpi = r.files.find((f) => f.path === "mipmap-hdpi/ic_launcher.png");
    expect(hdpi?.base64).toBe("AAAA");
  });

  it("只有自适应 XML、无密度 PNG 时不报错（老项目兼容）", async () => {
    const files = baseFiles();
    for (const k of Object.keys(files)) if (/mipmap-.*\.png$/.test(k)) delete files[k];
    const r = await collectProjectRes(
      memIo(files),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      200,
      [MANIFEST],
    );
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p === "mipmap-anydpi-v26/ic_launcher.xml")).toBe(true);
    expect(r.missing.filter((m) => m.startsWith("mipmap/"))).toEqual([]);
  });

  it("只有密度 PNG、无自适应 XML 时也收（纯 PNG 图标项目）", async () => {
    const files = baseFiles();
    for (const k of Object.keys(files)) if (/mipmap-anydpi/.test(k)) delete files[k];
    const r = await collectProjectRes(
      memIo(files),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      200,
      [MANIFEST],
    );
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p === "mipmap-hdpi/ic_launcher.png")).toBe(true);
    expect(paths.some((p) => p === "mipmap-xxxhdpi/ic_launcher.png")).toBe(true);
  });
});
