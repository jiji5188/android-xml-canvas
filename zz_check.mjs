import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
console.log("package.json version:", pkg.version);
// find version in apk sources
const b = fs.readFileSync("apk/build.mjs", "utf8");
const m = b.match(/versionName\s*[:=]\s*["']?([0-9][0-9.]+)/);
console.log("build.mjs versionName ref:", m && m[1]);
const vc = b.match(/versionCode\s*[:=]\s*["']?(\d+)/);
console.log("build.mjs versionCode ref:", vc && vc[1]);
