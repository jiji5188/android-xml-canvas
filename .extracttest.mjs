import { execFileSync } from "node:child_process";

// 临时脚本：把 APK 解压出来，模拟 AssetManager 的读取路径
const fs = require("node:fs");
const path = require("node:path");

const APK = path.resolve("apk/build/app.apk");
const EXTRACT = path.resolve("apk/extracted");

// 清空旧目录
if (fs.existsSync(EXTRACT)) fs.rmSync(EXTRACT, { recursive: true, force: true });
fs.mkdirSync(EXTRACT, { recursive: true });

// 解压
execFileSync("powershell", [
  "-NoProfile", "-Command",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
  "$z=[System.IO.Compression.ZipFile]::OpenRead('" + APK.replace(/\\/g, "/") + "');" +
  "$z.Entries | ForEach-Object {" +
  "  $dest='" + EXTRACT.replace(/\\/g, "/") + "/' + $_.FullName;" +
  "  $dir=Split-Path $dest -Parent;" +
  "  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null };" +
  "  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($z,$_.FullName,(Join-Path $dest),'True');",
  "}" +
  ";$z.Dispose()",
]);

// 检查路径
const checks = [
  "assets/www/xml/index.html",
  "assets/www/index.html",
  "assets/www/_next/static/chunks/0cz1d0mv5g_q7.js",
  "classes.dex",
  "AndroidManifest.xml",
];

for (const c of checks) {
  const p = path.join(EXTRACT, c);
  console.log(c, fs.existsSync(p) ? "OK" : "MISSING");
}

// 统计 assets
let assetCount = 0;
for (const f of fs.readdirSync(path.join(EXTRACT, "assets"), { recursive: true })) {
  if (f.endsWith(".html") || f.endsWith(".js") || f.endsWith(".css") || f.endsWith(".png") || f.endsWith(".ttf") || f.endsWith(".json")) assetCount++;
}
console.log("asset files:", assetCount);
