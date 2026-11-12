// apk/make-plugin.mjs — 把「编译器/模板」资源打成插件（manifest + 文件 + zip）
//
// 首版：从 apk/build/compiler（make-compiler.mjs 的产物）生成 ecj-d8 插件。
// 产物：
//   plugins/compilers/ecj-d8/manifest.json        清单（files = 包内文件；external = 外置资源）
//   plugins/compilers/ecj-d8/files/<原文件名>     打包进 zip 的实际字节
//   build/ecj-d8-<ver>.zip                       插件包（**不含 android.jar**，只有 4.25MB）
//   build/ecj-d8-android-jar-<ver>.tar.gz         外置 classpath 包（android.jar.gz，24MB，单独上传）
//
// 为什么 android.jar 单列：它占插件包 91.9%（23.8MB），且是 Google SDK 组件。
// 拆成 external 后：APK 可以瘦到 ~16MB，首次编译时才按需下载。
//
// 用法：node apk/make-plugin.mjs ecj-d8
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const apk = path.dirname(fileURLToPath(import.meta.url));
const pluginsDir = path.resolve(apk, "..", "plugins");
const buildDir = path.join(apk, "build");

// 大文件（android.jar 24MB）候选 URL：jsDelivr 限 20MB 会 403，故放 ghfast 代理 + gh-proxy + raw
// 小文件（manifest/zip 4MB）原生端按 PLUGIN_BASES 前缀走（jsDelivr 优先），manifest 里不写 files 的 url
const EXTERNAL_MIRRORS = [
  "https://ghfast.top/https://raw.githubusercontent.com/jiji5188/axv-plugins/main",
  "https://gh-proxy.com/https://raw.githubusercontent.com/jiji5188/axv-plugins/main",
  "https://raw.githubusercontent.com/jiji5188/axv-plugins/main",
];

// 各插件的来源目录 + 版本 + 文件角色
const SPEC = {
  "ecj-d8": {
    name: "Java 编译器（ECJ + D8）",
    version: "3.33.0",
    src: path.join(buildDir, "compiler"),
    // ★ android.jar.gz 不打包进 zip，走 external
    exclude: ["android.jar.gz"],
    roleOf: (n) => (/^tool\d+\.bin\.gz$/.test(n) ? "compiler-dex" : n === "msgs.bin.gz" ? "i18n" : undefined),
    loader: "dex",
  },
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const which = process.argv[2] || "ecj-d8";
const spec = SPEC[which];
if (!spec) {
  console.error("未知插件 " + which + "（可选：" + Object.keys(SPEC).join(" / ") + "）");
  process.exit(1);
}

const srcDir = spec.src;
if (!fs.existsSync(srcDir)) {
  console.error("源目录不存在：" + srcDir + "（先跑 node apk/build.mjs 或 node apk/make-compiler.mjs）");
  process.exit(1);
}

const exclude = new Set(spec.exclude || []);
const filesIn = fs.readdirSync(srcDir).filter((n) => n.endsWith(".gz") && !exclude.has(n));
const sorted = filesIn.sort((a, b) => {
  const na = Number(a.match(/^tool(\d+)\.bin\.gz$/)?.[1] || 999);
  const nb = Number(b.match(/^tool(\d+)\.bin\.gz$/)?.[1] || 999);
  if (na !== nb) return na - nb;
  if (/^tool\d+\.bin\.gz$/.test(a) !== /^tool\d+\.bin\.gz$/.test(b)) return /^tool\d+\.bin\.gz$/.test(a) ? -1 : 1;
  return a.localeCompare(b);
});

const entries = sorted.map((n) => {
  const p = path.join(srcDir, n);
  return { path: n, size: fs.statSync(p).size, sha256: sha256(p), role: spec.roleOf(n) };
});

// 外置资源（android.jar）：单独一个 tar.gz 包，manifest 里记 url + size + sha256
const externals = [];
let extBundle = null;
for (const ex of exclude) {
  const p = path.join(srcDir, ex);
  if (!fs.existsSync(p)) { console.warn("⚠ 外置文件不存在，跳过：" + p); continue; }
  externals.push({
    path: ex,
    url: EXTERNAL_MIRRORS.map((base) => base + "/" + which + "/" + spec.version + "/" + ex),
    size: fs.statSync(p).size,
    sha256: sha256(p),
    role: "classpath",
  });
  extBundle = p;
}

const manifest = { id: which, name: spec.name, version: spec.version, loader: spec.loader, files: entries };
if (externals.length > 0) manifest.external = externals;

// 写 plugins/<id>/manifest.json + files/
const outDir = path.join(pluginsDir, "compilers", which);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "files"), { recursive: true });
for (const e of entries) fs.copyFileSync(path.join(srcDir, e.path), path.join(outDir, "files", e.path));
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("已生成 " + outDir + "（包内 " + entries.length + " 文件 + 外置 " + externals.length + " 个）：");
for (const e of entries) console.log("  [包内] " + e.path.padEnd(16) + String(e.size).padStart(10) + "  " + e.role + "  " + e.sha256.slice(0, 12) + "…");
for (const e of externals) console.log("  [外置] " + e.path.padEnd(16) + String(e.size).padStart(10) + "  " + e.role + "  " + e.sha256.slice(0, 12) + "…");

const jarExe = path.join(process.env.JBR || "C:\\Program Files\\Android\\Android Studio\\jbr\\bin", "jar.exe");

// 打 zip：manifest.json + files/<each>（不含 android.jar）
const zipPath = path.join(buildDir, which + "-" + spec.version + ".zip");
execFileSync(jarExe, ["cf", zipPath, "-C", outDir, "."], { stdio: "inherit" });
console.log("\n已打包 " + zipPath + "（" + (fs.statSync(zipPath).size / 1048576).toFixed(2) + "MB）");

// 外置包：把 android.jar.gz 放到 plugins/<id>/external/ 供上传
if (extBundle) {
  const extDir = path.join(outDir, "external");
  fs.mkdirSync(extDir, { recursive: true });
  const dst = path.join(extDir, path.basename(extBundle));
  fs.copyFileSync(extBundle, dst);
  console.log("外置包就绪 " + dst + "（" + (fs.statSync(dst).size / 1048576).toFixed(2) + "MB）");
  console.log("  上传到仓库路径：" + which + "/" + spec.version + "/" + path.basename(extBundle));
}
