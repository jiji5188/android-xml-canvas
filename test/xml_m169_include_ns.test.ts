// M169：<include> 的 layout 属性必须序列化成「无命名空间」形式。
//
// 根因（AOSP LayoutInflater.parseInclude）：
//   int layout = attrs.getAttributeResourceValue(null, ATTR_LAYOUT, 0);
//   if (layout == 0) { value = attrs.getAttributeValue(null, ATTR_LAYOUT);
//     if (value == null || value.length() <= 0) throw new InflateException(
//       "You must specify a layout in the include tag: <include layout=\"@layout/layoutID\" />") }
// 命名空间是 null —— 写成 android:layout="…" 真机一律取不到（真机报的就是这条异常）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { exportLayoutXml, exportChecks } from "../lib/xml/export";
import { fixIncludeLayoutNs } from "../lib/xml/native-render";

const AAPT2_CANDIDATES = [
  process.env.AAPT2,
  "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk\\build-tools\\35.0.0\\aapt2.exe",
  "aapt2",
].filter(Boolean) as string[];

function findAapt2(): string | null {
  for (const p of AAPT2_CANDIDATES) {
    try {
      if (p !== "aapt2" && !fs.existsSync(p)) continue;
      execFileSync(p, ["version"], { stdio: "pipe" });
      return p;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

const SRC_ANDROID_PREFIX = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <include
      android:layout="@layout/toolbar"
      android:id="@+id/inc" />
</LinearLayout>`;

const SRC_NO_PREFIX = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <include layout="@layout/toolbar" />
</LinearLayout>`;

describe("M169 · include 的 layout 属性命名空间", () => {
  it("导出时 include 的 layout 去掉 android: 前缀", () => {
    const out = exportLayoutXml(SRC_ANDROID_PREFIX);
    expect(out).toContain('layout="@layout/toolbar"');
    expect(out).not.toContain('android:layout="@layout/toolbar"');
    // 其他属性照旧要带前缀，别误伤
    expect(out).toContain('android:id="@+id/inc"');
    expect(out).toContain('android:layout_width="match_parent"');
  });

  it("本来就无前缀的写法保持不变", () => {
    const out = exportLayoutXml(SRC_NO_PREFIX);
    expect(out).toContain('layout="@layout/toolbar"');
    expect(out).not.toContain("android:layout=");
  });

  it("没写 layout 的 include 导出时被剔除（真机必崩）", () => {
    const src = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />
  <include
      android:id="@+id/header"
      android:layout_width="match_parent"
      android:layout_height="wrap_content" />
</LinearLayout>`;
    const out = exportLayoutXml(src);
    expect(out).not.toContain("<include");
    expect(out).toContain("<TextView");
    // exportChecks 要给用户提示
    const chk = exportChecks(src);
    expect(chk.notes.join("\n")).toContain("include");
  });

  it("layout 写成 @layout/（空名）也算无效", () => {
    const src = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <include layout="@layout/" />
</LinearLayout>`;
    expect(exportLayoutXml(src)).not.toContain("<include");
  });

  it("fixIncludeLayoutNs 只纠正 include 里的 layout，不碰 layout_width/margin", () => {
    const src =
      '<include android:layout="@layout/x" android:layout_width="1dp" android:layout_margin="2dp" />';
    const out = fixIncludeLayoutNs(src);
    expect(out).toContain('layout="@layout/x"');
    expect(out).not.toContain('android:layout="');
    expect(out).toContain('android:layout_width="1dp"');
    expect(out).toContain('android:layout_margin="2dp"');
    // 普通控件里的 android:layout_width 不动
    const plain = '<TextView android:layout_width="1dp" />';
    expect(fixIncludeLayoutNs(plain)).toBe(plain);
  });

  it("fixIncludeLayoutNs 删掉没写 layout 的自闭合 include", () => {
    const src = '<LinearLayout>\n  <include android:id="@+id/h" />\n  <include layout="@layout/ok" />\n</LinearLayout>';
    const out = fixIncludeLayoutNs(src);
    expect(out).not.toContain('@+id/h');
    expect(out).toContain('layout="@layout/ok"');
  });

  it("aapt2 编译后 include 的 layout 属性确实落在无命名空间上", () => {
  const aapt2 = findAapt2();
  if (!aapt2) {
    console.warn("跳过：本机没有 aapt2");
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "axv-inc-"));
  fs.mkdirSync(path.join(work, "res", "layout"), { recursive: true });
  const head = '<?xml version="1.0" encoding="utf-8"?>';
  fs.writeFileSync(
    path.join(work, "res", "layout", "toolbar.xml"),
    `${head}\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="wrap_content" />\n`,
  );
  fs.writeFileSync(path.join(work, "res", "layout", "act.xml"), exportLayoutXml(SRC_ANDROID_PREFIX));
  const man = path.join(work, "AndroidManifest.xml");
  fs.writeFileSync(
    man,
    `${head}\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.axv.inctest"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" /><application android:hasCode="false" /></manifest>\n`,
  );
  const jar = "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk\\platforms\\android-35\\android.jar";
  if (!fs.existsSync(jar)) {
    console.warn("跳过：本机没有 android.jar");
    fs.rmSync(work, { recursive: true, force: true });
    return;
  }
  const czip = path.join(work, "c.zip");
  execFileSync(aapt2, ["compile", "--dir", path.join(work, "res"), "-o", czip], { stdio: "pipe" });
  const apk = path.join(work, "out.apk");
  execFileSync(
    aapt2,
    ["link", "-o", apk, "-I", jar, "--manifest", man, "--auto-add-overlay", czip],
    { stdio: "pipe" },
  );
  const dump = execFileSync(aapt2, ["dump", "xmltree", apk, "--file", "res/layout/act.xml"], {
    encoding: "utf8",
  });
  fs.rmSync(work, { recursive: true, force: true });
  // 无命名空间 → dump 里是 "A: layout=@0x…"；带命名空间会是 "A: http://…/android:layout(0x010100f2)=…"
  const incLine = dump.split("\n").find((l) => /A: .*layout=@0x/.test(l));
  expect(incLine).toBeTruthy();
    expect(incLine).not.toContain("schemas.android.com/apk/res/android:layout");
  });
});
