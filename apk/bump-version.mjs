import fs from "fs";

// 1) AndroidManifest：versionCode + 1，versionName 同步成 lib/version.ts 的值
let s = fs.readFileSync("apk/AndroidManifest.xml", "utf8");

const cur = s.match(/android:versionCode="(\d+)"/);
if (!cur) throw new Error("AndroidManifest 里找不到 versionCode");
const nextCode = Number(cur[1]) + 1;

const curName = s.match(/android:versionName="([^"]*)"/);
const nameNow = curName ? curName[1] : "1.0";
const parts = nameNow.split(".").map((n) => Number(n));
while (parts.length < 3) parts.push(0);
// 1.13 -> 1.14；1.99 -> 2.0
parts[parts.length - 1] += 1;
if (parts[parts.length - 1] >= 100) {
  parts[parts.length - 1] = 0;
  parts[parts.length - 2] += 1;
}
const nextName = parts.join(".");

s = s.replace(/android:versionCode="\d+"/, `android:versionCode="${nextCode}"`);
s = s.replace(/android:versionName="[^"]*"/, `android:versionName="${nextName}"`);
fs.writeFileSync("apk/AndroidManifest.xml", s);

// 2) lib/version.ts：界面显示的版本号，跟 manifest 保持同一值
const vs = fs.readFileSync("lib/version.ts", "utf8");
fs.writeFileSync("lib/version.ts", vs.replace(/APP_VERSION = "[^"]*"/, `APP_VERSION = "${nextName}"`));

console.log(`versionCode -> ${nextCode}, versionName -> ${nextName}`);
