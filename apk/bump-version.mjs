import fs from "fs";
let s = fs.readFileSync("apk/AndroidManifest.xml", "utf8");
s = s.replace(/android:versionCode="(\d+)"/, (m, n) => `android:versionCode="${Number(n) + 1}"`);
fs.writeFileSync("apk/AndroidManifest.xml", s);
console.log("versionCode ->", s.match(/android:versionCode="(\d+)"/)[1]);
