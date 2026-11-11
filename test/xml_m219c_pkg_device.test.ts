// @vitest-environment jsdom
/**
 * M219c 真机路径集成测试：用内存版 window.AxvNative（writeText/readText/listDir/renameEntry）
 * 跑完整 syncPkgInSource —— 验证「写盘 + 目录移动 + 跨包引用」在设备路径上真的生效。
 * 不是纯函数测试，是用假桥模拟 Android WebView 的真实调用序列。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { syncPkgInSource } from "@/lib/xml/pkg-sync";
import { nativeProjectSource } from "@/lib/xml/project-browse";
import type { ProjectSaveRoot } from "@/lib/xml/project-save";
import type { FileOpsCtx } from "@/lib/xml/file-ops";

const ROOT = "/proj";

/** 内存文件系统：绝对路径 → 文本 */
let FS: Map<string, string>;

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
function norm(p: string): string {
  return p.replace(/\/+/g, "/").replace(/\/$/, "");
}
function dirsOf(files: Iterable<string>): Set<string> {
  const s = new Set<string>([ROOT]);
  for (const f of files) {
    let d = parentOf(f);
    while (d && d.length >= ROOT.length) {
      s.add(d);
      if (d === ROOT || d === "/") break;
      d = parentOf(d);
    }
  }
  return s;
}

function b64enc(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}
function b64dec(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}

function installFakeBridge() {
  const bridge = {
    saveFile: () => "ok:/x",
    getWorkspace: () => ROOT,
    writeText: (abs: string, b64: string) => {
      FS.set(norm(abs), b64dec(b64));
      return "ok";
    },
    readText: (abs: string) => FS.get(norm(abs)) ?? "",
    listDir: (abs: string) => {
      const dir = norm(abs);
      const dirs = dirsOf(FS.keys());
      if (!dirs.has(dir)) return JSON.stringify({ ok: false, error: "no such dir" });
      const items: { name: string; kind: string; path: string }[] = [];
      for (const f of FS.keys()) {
        if (parentOf(f) === dir) items.push({ name: f.slice(f.lastIndexOf("/") + 1), kind: "file", path: f });
      }
      for (const d of dirs) {
        if (d === dir) continue;
        if (parentOf(d) === dir) items.push({ name: d.slice(d.lastIndexOf("/") + 1), kind: "dir", path: d });
      }
      return JSON.stringify({ ok: true, items });
    },
    renameEntry: (from: string, to: string) => {
      const f = norm(from), t = norm(to);
      const dirs = dirsOf(FS.keys());
      const moving = [...FS.keys()].filter((k) => k === f || k.startsWith(f + "/"));
      const isDir = dirs.has(f);
      if (moving.length === 0 && !isDir) return JSON.stringify({ ok: false, error: "not found" });
      for (const k of moving) {
        const v = FS.get(k)!;
        FS.delete(k);
        FS.set(t + k.slice(f.length), v);
      }
      return JSON.stringify({ ok: true });
    },
  };
  (window as unknown as { AxvNative: unknown }).AxvNative = bridge;
}

function seed() {
  FS = new Map<string, string>();
  const put = (rel: string, text: string) => FS.set(`${ROOT}/${rel}`, text);
  put("app/src/main/java/com/old/MainActivity.java", [
    "package com.old;",
    "import com.old.R;",
    "import android.os.Bundle;",
    "public class MainActivity extends Activity {",
    "  protected void onCreate(Bundle b) { setContentView(R.layout.activity_main); }",
    "}",
  ].join("\n"));
  put("app/src/main/java/com/old/model/User.java", [
    "package com.old.model;",
    "import com.old.MainActivity;",
    "public class User { MainActivity m; }",
  ].join("\n"));
  // 另一个包，引用了旧包（关键：不在旧包目录里，M209 漏掉的正是这种）
  put("app/src/main/java/com/util/Helper.java", [
    "package com.util;",
    "import com.old.MainActivity;",
    "public class Helper { void f() { new com.old.MainActivity(); } }",
  ].join("\n"));
  put("app/src/main/AndroidManifest.xml",
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.old">\n' +
    '  <application android:name="com.old.App" android:label="x"/>\n' +
    '  <activity android:name=".MainActivity"/>\n' +
    "</manifest>\n");
  put("app/build.gradle", 'android { namespace "com.old" defaultConfig { applicationId "com.old" } }\n');
  put("app/src/main/res/values/strings.xml", '<resources><string name="app_name">Demo</string></resources>\n');
}

let ctx: FileOpsCtx;
let saveRoot: ProjectSaveRoot;

beforeEach(() => {
  seed();
  installFakeBridge();
  ctx = { backend: "native", root: ROOT };
  saveRoot = { kind: "native", base: ROOT };
});
afterEach(() => {
  delete (window as unknown as { AxvNative?: unknown }).AxvNative;
});

describe("M219c 设备路径：syncPkgInSource 真写盘 + 真移目录", () => {
  it("旧包目录整体移到新包路径，内容与目录一致", async () => {
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "com.old", "com.new", saveRoot, ctx);

    // 目录已移动
    expect([...FS.keys()].some((k) => k.includes("/com/old/"))).toBe(false);
    expect(FS.has(`${ROOT}/app/src/main/java/com/new/MainActivity.java`)).toBe(true);
    expect(FS.has(`${ROOT}/app/src/main/java/com/new/model/User.java`)).toBe(true);

    // package 声明与 import 都改了
    const main = FS.get(`${ROOT}/app/src/main/java/com/new/MainActivity.java`)!;
    expect(main).toContain("package com.new;");
    expect(main).toContain("import com.new.R;");
    expect(main).toContain("import android.os.Bundle;"); // 非本包 import 不动

    const user = FS.get(`${ROOT}/app/src/main/java/com/new/model/User.java`)!;
    expect(user).toContain("package com.new.model;");
    expect(user).toContain("import com.new.MainActivity;");

    expect(r.moved).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("旧包目录之外的引用文件也被改写（M209 的漏点）", async () => {
    const src = nativeProjectSource("demo", [], ROOT);
    await syncPkgInSource(src, "com.old", "com.new", saveRoot, ctx);
    const helper = FS.get(`${ROOT}/app/src/main/java/com/util/Helper.java`)!;
    expect(helper).toContain("import com.new.MainActivity;");
    expect(helper).toContain("new com.new.MainActivity()");
    expect(helper).toContain("package com.util;"); // 自己包名不动
  });

  it("AndroidManifest 的 package / android:name 同步，相对写法不动", async () => {
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "com.old", "com.new", saveRoot, ctx);
    const mf = FS.get(`${ROOT}/app/src/main/AndroidManifest.xml`)!;
    expect(mf).toContain('package="com.new"');
    expect(mf).toContain('android:name="com.new.App"');
    expect(mf).toContain('android:name=".MainActivity"'); // 相对写法保留
    expect(r.manifests.length).toBe(1);
  });

  it("返回的文件清单与实际被改的盘上文件一致", async () => {
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "com.old", "com.new", saveRoot, ctx);
    // main + model/User + util/Helper = 3 个 java/kt
    const javaChanged = r.files.filter((f) => /\.(java|kt)$/.test(f)).sort();
    expect(javaChanged).toEqual([
      "app/src/main/java/com/old/MainActivity.java",
      "app/src/main/java/com/old/model/User.java",
      "app/src/main/java/com/util/Helper.java",
    ]);
    expect(r.foundSrc).toBe(true);
  });

  it("嵌套改名不动目录（com.old → com.old.app），但内容照改", async () => {
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "com.old", "com.old.app", saveRoot, ctx);
    expect(r.moved).toBe(false);
    expect(r.moveWarn).toBe("pkg-nested-rename");
    // 文件还在旧目录（没移），但 package 已改
    const main = FS.get(`${ROOT}/app/src/main/java/com/old/MainActivity.java`)!;
    expect(main).toContain("package com.old.app;");
  });

  it("没有 app/ 前缀的 src/main/java 布局也能同步", async () => {
    FS = new Map<string, string>();
    FS.set(`${ROOT}/src/main/java/org/demo/A.java`, "package org.demo;\nclass A {}\n");
    FS.set(`${ROOT}/src/main/java/org/other/B.java`, "package org.other;\nimport org.demo.A;\n");
    installFakeBridge();
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "org.demo", "org.sample", saveRoot, ctx);
    expect(FS.has(`${ROOT}/src/main/java/org/sample/A.java`)).toBe(true);
    expect(FS.get(`${ROOT}/src/main/java/org/sample/A.java`)!).toContain("package org.sample;");
    expect(FS.get(`${ROOT}/src/main/java/org/other/B.java`)!).toContain("import org.sample.A;");
    expect(r.moved).toBe(true);
  });

  it("空 oldPkg 直接不动（防意外全量替换）", async () => {
    const before = JSON.stringify([...FS.entries()].sort());
    const src = nativeProjectSource("demo", [], ROOT);
    const r = await syncPkgInSource(src, "", "com.new", saveRoot, ctx);
    expect(r.files.length).toBe(0);
    expect(JSON.stringify([...FS.entries()].sort())).toBe(before);
  });
});
