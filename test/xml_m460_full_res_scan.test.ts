// M460：全量 res 扫描（fullScan）
// 用户 ReturnSystem2 项目：Java 里 R.raw.ring_* 引用 6 个音频，但没有任何 XML 引用它们
// → 旧收集器（只跟随 XML 引用）全漏包 → ECJ 编译 R.raw 报 cannot be resolved → 「Java 编译失败」
// → AIDE/AS 是整个 res 目录全打，所以它们没问题。fullScan=true 修复此差异。
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
  <application android:icon="@mipmap/ic_launcher" android:label="@string/app_name" />
</manifest>`;

const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />`;

/** 模拟 ReturnSystem2 场景：raw 音频 + menu + xml 目录都只被 Java 引用，XML 引用链完全碰不到 */
function baseFiles(): Record<string, string> {
  return {
    "app/src/main/AndroidManifest.xml": MANIFEST,
    "app/src/main/res/layout/activity_main.xml": LAYOUT,
    "app/src/main/res/values/strings.xml": `<resources><string name="app_name">Test</string></resources>`,
    // 只被 Java 引用的资源（XML 引用链之外）
    "app/src/main/res/raw/ring_scan_ok.mp3": "img:QUJDRA==",
    "app/src/main/res/raw/ring_warning.wav": "img:V0FW",
    "app/src/main/res/menu/bottom_app_bar_menu.xml": `<?xml version="1.0" encoding="utf-8"?><menu />`,
    "app/src/main/res/xml/file_paths.xml": `<?xml version="1.0" encoding="utf-8"?><paths />`,
    "app/src/main/res/drawable/qr_d.png": "img:UE5H",
    // 被 XML 引用的资源（回归：引用跟随仍正常）
    "app/src/main/res/mipmap-hdpi/ic_launcher.png": "img:SUNI",
  };
}

describe("M460 全量 res 扫描", () => {
  it("fullScan=true：Java 专属资源（raw/menu/xml/drawable png）全部进包", async () => {
    const r = await collectProjectRes(
      memIo(baseFiles()),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      800,
      [MANIFEST],
      true,
    );
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p === "raw/ring_scan_ok.mp3"), "缺 raw/ring_scan_ok.mp3").toBe(true);
    expect(paths.some((p) => p === "raw/ring_warning.wav")).toBe(true);
    expect(paths.some((p) => p === "menu/bottom_app_bar_menu.xml")).toBe(true);
    expect(paths.some((p) => p === "xml/file_paths.xml")).toBe(true);
    expect(paths.some((p) => p === "drawable/qr_d.png")).toBe(true);
    // 二进制带真实 base64
    const mp3 = r.files.find((f) => f.path === "raw/ring_scan_ok.mp3");
    expect(mp3?.base64).toBe("QUJDRA==");
    // 引用跟随的回归：mipmap/ic_launcher（manifest 引用）仍收
    expect(paths.some((p) => /^mipmap-hdpi\/ic_launcher\.png$/.test(p))).toBe(true);
    // 全收了 → 不该有 missing
    expect(r.missing.filter((m) => !m.startsWith("mipmap/ic_launcher"))).toEqual([]);
  });

  it("fullScan=false（默认）：Java 专属资源不进包（旧行为，渲染预览不受影响）", async () => {
    const r = await collectProjectRes(
      memIo(baseFiles()),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      160,
      [MANIFEST],
    );
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p === "raw/ring_scan_ok.mp3")).toBe(false);
    expect(paths.some((p) => p === "menu/bottom_app_bar_menu.xml")).toBe(false);
    // 但 XML 引用链里的仍收
    expect(paths.some((p) => /^mipmap-hdpi\/ic_launcher\.png$/.test(p))).toBe(true);
  });

  it("fullScan=true：values 仍由专门逻辑处理（projectValueDefs 去重不被破坏）", async () => {
    const files = baseFiles();
    files["app/src/main/res/values/colors.xml"] = `<resources><color name="brand">#123456</color></resources>`;
    const r = await collectProjectRes(
      memIo(files),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      800,
      [MANIFEST],
      true,
    );
    const paths = r.files.map((f) => f.path);
    // values/colors.xml 照常进包
    expect(paths.some((p) => p === "values/colors.xml")).toBe(true);
    // manifest 引用 @string/app_name 不应为 missing（values 索引正常）
    expect(r.missing).not.toContain("string/app_name");
  });

  it("fullScan=true：budget 截断不崩溃（超大项目限流）", async () => {
    const files = baseFiles();
    for (let i = 0; i < 50; i++) files[`app/src/main/res/raw/pad_${i}.dat`] = "img:Ng==";
    const r = await collectProjectRes(
      memIo(files),
      "app/src/main/res/layout/activity_main.xml",
      [{ path: "layout/activity_main.xml", text: LAYOUT }],
      20, // 故意小预算
      [MANIFEST],
      true,
    );
    // budget 限制的是「新增」数（输入的布局文件不计入 added）
    expect(r.added).toBeLessThanOrEqual(20);
  });
});
