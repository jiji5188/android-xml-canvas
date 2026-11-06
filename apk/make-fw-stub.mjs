// apk/make-fw-stub.mjs —— 造一个「最小 android 资源包」，给设备上的 aapt2 当 -I 用。
//
// 为什么不能直接用 android.jar 里的 resources.arsc：
//   android.jar 的 arsc 是给 javac 看的桩，手机端 aapt2 加载时会报
//   error: illegal map type 'string' / failed to parse value for resource android:string/...
//   然后 error: failed to load include path ...，link 直接失败。（桌面 aapt2 反而宽容能过。）
//
// 做法（AOSP 的思路）：只编 attrs.xml，用 public-final.xml 里的真 ID 声明 <public>：
//   - 资源源：platforms/<v>/data/res/values/attrs.xml（+ attrs_manifest.xml）
//   - ID 来源：同目录 public-final.xml（只取实际存在的 attr），生成为 res/values/public.xml
//   - manifest package 写 "android"，aapt2 会自动给包 ID 0x01（不需要 --package-id，
//     那个参数也不允许传 0x01）
// 产物 ~170 KB，里面只有 attr 定义，但 ID 与真机框架完全一致
// （ID 不一致的话 inflate 出来的控件属性会全乱）。
//
// 用法：node apk/make-fw-stub.mjs <platformDir> <out.apk.gz> [raw.apk] <aapt2.exe>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

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

  // 1) 拷 attrs 源，同时收集真实存在的 attr 名
  const existing = new Set();
  for (const f of ["attrs.xml", "attrs_manifest.xml"]) {
    const p = path.join(resSrc, f);
    if (!fs.existsSync(p)) continue;
    fs.copyFileSync(p, path.join(vals, f));
    const xml = fs.readFileSync(p, "utf8");
    const ar = /<attr\s+name="([^"]+)"/g;
    let am;
    while ((am = ar.exec(xml)) !== null) existing.add(am[1]);
  }

  // 2) public-final.xml → public.xml（只列存在的 attr；缺了的话 android:xxx 会被判 private）
  const pubSrc = fs.readFileSync(path.join(resSrc, "public-final.xml"), "utf8");
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"];
  const re = /<public\s+type="attr"\s+name="([^"]+)"\s+id="(0x[0-9a-fA-F]{8})"/g;
  let m;
  let n = 0;
  while ((m = re.exec(pubSrc)) !== null) {
    if (!existing.has(m[1])) continue;
    lines.push(`  <public type="attr" name="${m[1]}" id="${m[2]}" />`);
    n++;
  }
  lines.push("</resources>", "");
  fs.writeFileSync(path.join(vals, "public.xml"), lines.join("\n"));

  // 3) 编译 + 链接成 package=android 的资源包
  fs.writeFileSync(
    path.join(work, "AndroidManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="android">\n  <uses-sdk android:minSdkVersion="24" />\n  <application android:hasCode="false" />\n</manifest>\n`,
  );
  const compiled = path.join(work, "fw.zip");
  execFileSync(aapt2, ["compile", "--dir", path.join(work, "res"), "-o", compiled], { stdio: "inherit" });
  const rawApk = path.join(work, "fw.apk");
  execFileSync(
    aapt2,
    ["link", "-o", rawApk, "--manifest", path.join(work, "AndroidManifest.xml"), "--min-sdk-version", "24", compiled],
    { stdio: ["ignore", "inherit", "inherit"] },
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
    `framework 资源桩: ${gzOut}  ${(gz.length / 1024).toFixed(1)} KB gz（apk ${(apkBytes.length / 1024).toFixed(1)} KB，${n} 条 public attr 固定 ID）`,
  );
}

main();
