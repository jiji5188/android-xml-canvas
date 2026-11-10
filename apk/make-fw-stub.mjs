// apk/make-fw-stub.mjs —— 造一个「最小 android 资源包」，给设备上的 aapt2 当 -I 用。
//
// 为什么不能直接用 android.jar 里的 resources.arsc：
//   android.jar 的 arsc 是给 javac 看的桩，手机端 aapt2 加载时会报
//   error: illegal map type 'string' / failed to parse value for resource android:string/...
//   然后 error: failed to load include path ...，link 直接失败。（桌面 aapt2 反而宽容能过。）
//
// 做法（AOSP 的思路 + M212 扩展）：
//   1) 资源源：platforms/<v>/data/res/values/attrs.xml（+ attrs_manifest.xml）——真 attrs 定义
//   2) ID 来源：同目录 public-final.xml（带真实 public ID）
//   3) M212：把 public-final.xml 里**所有**公开资源（drawable/color/style/dimen/string/bool/...）
//      都声明成占位条目（drawable/item 用 @null，color 用 #00000000，style 加一个 dummy item 防止被丢弃），
//      这样 @android:drawable/ic_menu_camera、@android:color/darker_gray 这类引用在 link 时就能解析。
//      桩里的值只用来骗过 aapt2，**不随 APK 走**；真正的图/色在运行时由设备 framework-res 按 ID 解析。
//
// 产物 ~250 KB（attrs + 全量 public 占位），ID 与真机框架完全一致。
//
// 用法：node apk/make-fw-stub.mjs <platformDir> <out.apk.gz> [raw.apk] <aapt2.exe>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

/** 能做占位声明的资源类型（见 M212 实验）：raw/menu 等没定义的不在这里 */
const PLACEHOLDER_TYPES = new Set([
  "style",
  "color",
  "drawable",
  "mipmap",
  "anim",
  "animator",
  "layout",
  "interpolator",
  "transition",
  "xml",
  "string",
  "dimen",
  "bool",
  "integer",
  "fraction",
  "id",
  "array",
]);

function main() {
  const args = process.argv.slice(2);
  const aapt2 = process.env.AAPT2 || args.find((a) => /aapt2(\.exe)?$/i.test(a));
  const rest = args.filter((a) => a !== aapt2);
  const [platformDir, gzOut, rawOut] = rest;
  if (!platformDir || !gzOut || !aapt2) {
    console.error("用法: node apk/make-fw-stub.mjs <platformDir> <out.apk.gz> [raw.apk] <aapt2.exe>");
    process.exit(2);
  }

  const resSrc = path.join(platformDir, "data", "res", "values");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "axv-fw-"));
  const vals = path.join(work, "res", "values");
  fs.mkdirSync(vals, { recursive: true });

  // 1) 拷 attrs 真源（带 format：flag/enum/引用关系），同时收集真实存在的 attr 名
  const existingAttrs = new Set();
  for (const f of ["attrs.xml", "attrs_manifest.xml"]) {
    const p = path.join(resSrc, f);
    if (!fs.existsSync(p)) continue;
    fs.copyFileSync(p, path.join(vals, f));
    const xml = fs.readFileSync(p, "utf8");
    const ar = /<attr\s+name="([^"]+)"/g;
    let am;
    while ((am = ar.exec(xml)) !== null) existingAttrs.add(am[1]);
  }

  // 2) 读 public-final.xml：拿全量公开 ID（name/id 顺序不定，两种写法都认）
  const pubSrc = fs.readFileSync(path.join(resSrc, "public-final.xml"), "utf8");
  const pubRe =
    /<public\s+type="([^"]+)"\s+(?:name="([^"]+)"\s+id="(0x[0-9a-fA-F]{8})"|id="(0x[0-9a-fA-F]{8})"\s+name="([^"]+)")/g;
  const entries = [];
  let m;
  while ((m = pubRe.exec(pubSrc)) !== null) {
    entries.push({ type: m[1], name: m[2] || m[5], id: m[3] || m[4] });
  }

  // 3) 生成 public.xml（固定 ID）+ 占位 values 文件
  const pubLines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"];
  const valLines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"];
  for (const e of entries) {
    if (e.type === "attr") {
      if (existingAttrs.has(e.name)) {
        pubLines.push(`  <public type="attr" name="${e.name}" id="${e.id}" />`);
      }
      continue;
    }
    if (!PLACEHOLDER_TYPES.has(e.type)) continue;
    pubLines.push(`  <public type="${e.type}" name="${e.name}" id="${e.id}" />`);
    switch (e.type) {
      case "style":
        // 空的 <style name/> 会被 aapt2 当「没值」丢掉，引用直接报 not found；
        // 加一个 dummy item（boolean 值最稳）让它真的落进 arsc
        valLines.push(
          `  <style name="${e.name}" parent=""><item name="android:enabled">false</item></style>`
        );
        break;
      case "color":
        valLines.push(`  <color name="${e.name}">#00000000</color>`);
        break;
      case "string":
        valLines.push(`  <string name="${e.name}"></string>`);
        break;
      case "dimen":
        valLines.push(`  <dimen name="${e.name}">0px</dimen>`);
        break;
      case "bool":
        valLines.push(`  <bool name="${e.name}">false</bool>`);
        break;
      case "integer":
        valLines.push(`  <integer name="${e.name}">0</integer>`);
        break;
      case "fraction":
        valLines.push(`  <item type="fraction" name="${e.name}">0%</item>`);
        break;
      case "id":
        valLines.push(`  <item type="id" name="${e.name}" />`);
        break;
      case "array":
        valLines.push(`  <string-array name="${e.name}" />`);
        break;
      default:
        // drawable/mipmap/anim/animator/layout/interpolator/transition/xml
        valLines.push(`  <item type="${e.type}" name="${e.name}">@null</item>`);
        break;
    }
  }
  pubLines.push("</resources>", "");
  valLines.push("</resources>", "");
  fs.writeFileSync(path.join(vals, "public.xml"), pubLines.join("\n"));
  fs.writeFileSync(path.join(vals, "fw_placeholders.xml"), valLines.join("\n"));

  // 4) 编译 + 链接成 package=android 的资源包
  fs.writeFileSync(
    path.join(work, "AndroidManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="android">\n  <uses-sdk android:minSdkVersion="24" />\n  <application android:hasCode="false" />\n</manifest>\n`
  );
  const compiled = path.join(work, "fw.zip");
  execFileSync(aapt2, ["compile", "--dir", path.join(work, "res"), "-o", compiled], { stdio: "inherit" });
  const rawApk = path.join(work, "fw.apk");
  execFileSync(
    aapt2,
    ["link", "-o", rawApk, "--manifest", path.join(work, "AndroidManifest.xml"), "--min-sdk-version", "24", compiled],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  const apkBytes = fs.readFileSync(rawApk);
  if (rawOut) {
    fs.mkdirSync(path.dirname(rawOut), { recursive: true });
    fs.writeFileSync(rawOut, apkBytes);
  }
  const gz = zlib.gzipSync(apkBytes, { level: 9 });
  fs.mkdirSync(path.dirname(gzOut), { recursive: true });
  fs.writeFileSync(gzOut, gz);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(
    `framework 资源桩: ${gzOut}  ${(gz.length / 1024).toFixed(1)} KB gz（apk ${(apkBytes.length / 1024).toFixed(1)} KB，${entries.length} 条 public ID）`
  );
}

main();
