import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import {
  normalizeColor,
  splitVector,
  buildLauncherForeground,
  buildAppIcon,
  buildAdaptiveIcon,
  checkManifestIcon,
  parseAppIconConfig,
} from "../lib/xml/app-icon";
import { buildResBundle } from "../lib/xml/bundle";

const SRC = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:name="ic_star">
    <path android:pathData="M12,2L15,9L22,9L16,14L18,21L12,17L6,21L8,14L2,9L9,9Z" android:fillColor="#FFEB3B" />
</vector>`;

describe("M171 应用图标生成", () => {
  it("颜色规范化", () => {
    expect(normalizeColor("#fff")).toBe("#ffffffff");
    expect(normalizeColor("#8f0")).toBe("#ff88ff00");
    expect(normalizeColor("3FBFA0")).toBe("#ff3fbfa0");
    expect(normalizeColor("#80FF0000")).toBe("#80ff0000");
    expect(normalizeColor("red")).toBeNull();
    expect(normalizeColor("#12345")).toBeNull();
  });

  it("拆 vector：拿到 viewport 与内部节点", () => {
    const v = splitVector(SRC);
    expect(v?.vw).toBe(24);
    expect(v?.vh).toBe(24);
    expect(v?.inner).toContain("pathData");
    expect(splitVector("<shape/>")).toBeNull();
  });

  it("前景：108 视口 + group 缩放居中，内容默认占 72%", () => {
    const fg = buildLauncherForeground(SRC, 72)!;
    expect(fg).toContain('android:viewportWidth="108"');
    expect(fg).toContain('android:width="108dp"');
    // 72/24 = 3，居中平移 (108-72)/2 = 18
    expect(fg).toContain('android:scaleX="3"');
    expect(fg).toContain('android:translateX="18"');
    expect(fg).toContain("M12,2L15,9L22,9L16,14L18,21L12,17L6,21L8,14L2,9L9,9Z");
    // 不能把原 <vector> 头带进来（develop 里嵌套 vector 会编译不过）
    expect((fg.match(/<vector/g) || []).length).toBe(1);
  });

  it("内容尺寸被夹到 40~108", () => {
    const a = buildLauncherForeground(SRC, 5)!;
    expect(a).toContain('android:scaleX="1.667"'); // 40/24
    const b = buildLauncherForeground(SRC, 500)!;
    expect(b).toContain('android:scaleX="4.5"'); // 108/24
  });

  it("整套文件：4 个，adaptive-icon 只在 mipmap-anydpi-v26", () => {
    const r = buildAppIcon({ fgSourceXml: SRC, bgColor: "#3FBFA0" });
    expect(r.error).toBeUndefined();
    const paths = r.files.map((f) => f.path);
    expect(paths).toEqual([
      "drawable/ic_launcher_foreground.xml",
      "drawable/ic_launcher_background.xml",
      "mipmap-anydpi-v26/ic_launcher.xml",
      "mipmap-anydpi-v26/ic_launcher_round.xml",
    ]);
    const ad = r.files.find((f) => f.path === "mipmap-anydpi-v26/ic_launcher.xml")!.text;
    expect(ad).toContain('<background android:drawable="@drawable/ic_launcher_background" />');
    expect(ad).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground" />');
    expect(r.bgColor).toBe("#ff3fbfa0");
  });

  it("非法输入给出 error 而不是抛出", () => {
    expect(buildAppIcon({ fgSourceXml: "<shape/>", bgColor: "#fff" }).error).toContain("vector");
    expect(buildAppIcon({ fgSourceXml: SRC, bgColor: "nope" }).error).toContain("背景色");
    expect(buildAppIcon({ fgSourceXml: SRC, bgColor: "#fff", fgName: "Bad Name" }).error).toContain(
      "前景资源名",
    );
  });

  it("清单检查：缺 icon / 指错 / 缺 roundIcon", () => {
    const good = `<application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" />`;
    expect(checkManifestIcon(good)).toEqual([]);
    const noIcon = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="x" /></manifest>`;
    expect(checkManifestIcon(noIcon).length).toBe(2);
    const wrong = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@drawable/logo" /></manifest>`;
    expect(checkManifestIcon(wrong).join()).toContain("@drawable/logo");
  });
});

/* ---- bundle：extraRes 按原路径进包（M171 的 mipmap 就靠这个进去） ---- */
describe("M171 bundle.extraRes", () => {
  it("mipmap-anydpi-v26 不被搬到 drawable/，且不去重同名 drawable", () => {
    const r = buildAppIcon({ fgSourceXml: SRC, bgColor: "#3FBFA0" });
    const extraRes: Record<string, string> = {};
    for (const f of r.files) extraRes[f.path] = f.text;
    const entries = buildResBundle({
      layoutXml: `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />`,
      layoutName: "activity_main.xml",
      extraRes,
    });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("mipmap-anydpi-v26/ic_launcher.xml");
    expect(paths).toContain("mipmap-anydpi-v26/ic_launcher_round.xml");
    expect(paths).toContain("drawable/ic_launcher_foreground.xml");
    expect(paths).toContain("drawable/ic_launcher_background.xml");
    const ad = entries.find((e) => e.path === "mipmap-anydpi-v26/ic_launcher.xml")!.text;
    expect(ad).toContain("<adaptive-icon");
  });
});

/* ---- M174：生成的配置能反读回来（刷新/重开后面板回填） ---- */
describe("M174 parseAppIconConfig", () => {
  const toRes = (bg: string, dp?: number) => {
    const r = buildAppIcon({ fgSourceXml: SRC, bgColor: bg, contentDp: dp });
    expect(r.error).toBeUndefined();
    const res: Record<string, string> = {};
    for (const f of r.files) res[f.path] = f.text;
    return { res, gen: r };
  };

  it("读回背景色与尺寸", () => {
    const { res } = toRes("#3FBFA0", 64);
    expect(parseAppIconConfig(res)).toEqual({ bgColor: "#ff3fbfa0", contentDp: 64 });
  });

  it("前景里带 axv:contentDp 标记，缺标记时回落 72", () => {
    const fg = buildLauncherForeground(SRC, 96)!;
    expect(fg).toContain("axv:contentDp=96");
    const { res } = toRes("#ffffff", 72);
    const noMark: Record<string, string> = {};
    for (const [k, v] of Object.entries(res)) noMark[k] = v.replace(/<!-- axv:contentDp=\d+ -->\n?/, "");
    expect(parseAppIconConfig(noMark)).toEqual({ bgColor: "#ffffffff", contentDp: 72 });
  });

  it("没有 adaptive-icon / 背景不是纯色 → 返回 null（不报错）", () => {
    expect(parseAppIconConfig(null)).toBeNull();
    expect(parseAppIconConfig({})).toBeNull();
    expect(parseAppIconConfig({ "mipmap-anydpi-v26/ic_launcher.xml": "<adaptive-icon/>" })).toBeNull();
  });

  it("生成结果带上实际 clamp 后的 contentDp", () => {
    expect(buildAppIcon({ fgSourceXml: SRC, bgColor: "#fff", contentDp: 5 }).contentDp).toBe(40);
    expect(buildAppIcon({ fgSourceXml: SRC, bgColor: "#fff", contentDp: 500 }).contentDp).toBe(108);
    expect(buildAppIcon({ fgSourceXml: SRC, bgColor: "#fff" }).contentDp).toBe(72);
  });
});

/* ---- 端到端：用本机 aapt2 + framework 桩验证生成的包能 link（minSdk 24） ---- */
const AAPT2 = "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk\\build-tools\\35.0.0\\aapt2.exe";
const STUB_GZ = "C:\\Users\\admin\\.openclaw\\workspace\\tmp-fwstub.apk.gz";
const canRun = process.platform === "win32" && fs.existsSync(AAPT2) && fs.existsSync(STUB_GZ);

describe.skipIf(!canRun)("M171 端到端 aapt2 link（minSdk 24）", () => {
  it("生成的 adaptive-icon 能通过 link，且资源表里有 mipmap/ic_launcher", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "axv-appicon-"));
    const stub = path.join(work, "fw.apk");
    fs.writeFileSync(stub, zlib.gunzipSync(fs.readFileSync(STUB_GZ)));
    const res = path.join(work, "res");
    const r = buildAppIcon({ fgSourceXml: SRC, bgColor: "#3FBFA0" });
    expect(r.error).toBeUndefined();
    for (const f of r.files) {
      const p = path.join(res, f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.text);
    }
    fs.mkdirSync(path.join(res, "layout"), { recursive: true });
    fs.writeFileSync(
      path.join(res, "layout", "activity_main.xml"),
      `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />\n`,
    );
    const man = path.join(work, "AndroidManifest.xml");
    fs.writeFileSync(
      man,
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.axv.icon"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" /><application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" android:hasCode="false" /></manifest>\n`,
    );
    const run = (args: string[]) =>
      execFileSync(AAPT2, args, { encoding: "utf8", stdio: "pipe" });
    run(["compile", "--dir", res, "-o", path.join(work, "c.zip")]);
    run([
      "link",
      "-o",
      path.join(work, "out.apk"),
      "-I",
      stub,
      "--manifest",
      man,
      "--package-id",
      "0x80",
      "--min-sdk-version",
      "24",
      "--auto-add-overlay",
      path.join(work, "c.zip"),
    ]);
    const dump = run(["dump", "resources", path.join(work, "out.apk")]);
    expect(dump).toContain("mipmap/ic_launcher");
    expect(dump).toContain("mipmap/ic_launcher_round");
    expect(dump).toContain("drawable/ic_launcher_foreground");
    expect(dump).toContain("drawable/ic_launcher_background");
  });
});
