// apk/make-plugin.mjs — 把「编译器/模板」资源打成插件（manifest + 文件 + zip）
//
// 首版：从 apk/build/compiler（make-compiler.mjs 的产物）生成 ecj-d8 插件。
// 产物：
//   plugins/compilers/ecj-d8/manifest.json   （逐文件 sha256 + 大小 + 角色）
//   plugins/compilers/ecj-d8/files/<原文件名>  （打包进 zip 的实际字节）
//   build/ecj-d8-<version>.zip               （上传 GitHub Release 的附件）
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

// 各插件的来源目录 + 版本 + 文件角色
const SPEC = {
  "ecj-d8": {
    name: "Java 编译器（ECJ + D8）",
    version: "3.33.0",
    src: path.join(buildDir, "compiler"),
    files: [
      // 顺序即 tool 编号（make-compiler 产出 tool1/tool2...）
    ],
    roleOf: (n) => (/^tool\d+\.bin\.gz$/.test(n) ? "compiler-dex" : n === "android.jar.gz" ? "classpath" : n === "msgs.bin.gz" ? "i18n" : undefined),
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

// 收集 tool 编号
const filesIn = fs.readdirSync(srcDir).filter((n) => n.endsWith(".gz") || n === "android.jar.gz" || n === "msgs.bin.gz");
const sorted = filesIn.sort((a, b) => {
  const na = Number(a.match(/^tool(\d+)\.bin\.gz$/)?.[1] || 999);
  const nb = Number(b.match(/^tool(\d+)\.bin\.gz$/)?.[1] || 999);
  if (na !== nb) return na - nb;
  // 非 tool 的排后面，按字母
  if (/^tool\d+\.bin\.gz$/.test(a) !== /^tool\d+\.bin\.gz$/.test(b)) return /^tool\d+\.bin\.gz$/.test(a) ? -1 : 1;
  return a.localeCompare(b);
});

const entries = sorted.map((n) => {
  const p = path.join(srcDir, n);
  return { path: n, size: fs.statSync(p).size, sha256: sha256(p), role: spec.roleOf(n) };
});

const manifest = { id: which, name: spec.name, version: spec.version, loader: spec.loader, files: entries };

// 写 plugins/<id>/manifest.json + files/
const outDir = path.join(pluginsDir, "compilers", which);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "files"), { recursive: true });
for (const e of entries) fs.copyFileSync(path.join(srcDir, e.path), path.join(outDir, "files", e.path));
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("已生成 " + outDir + "（" + entries.length + " 个文件）：");
for (const e of entries) console.log("  " + e.path.padEnd(18) + String(e.size).padStart(11) + "  " + e.role + "  " + e.sha256.slice(0, 12) + "…");

// 打 zip：manifest.json + files/<each>
const zipPath = path.join(buildDir, which + "-" + spec.version + ".zip");
execFileSync(path.join(process.env.JBR || "C:\\Program Files\\Android\\Android Studio\\jbr\\bin", "jar.exe"), ["cf", zipPath, "-C", outDir, "."], { stdio: "inherit" });
console.log("\n已打包 " + zipPath + "（" + (fs.statSync(zipPath).size / 1048576).toFixed(1) + "MB），上传到 GitHub Release jiji5188/axv-plugins 的 tag " + which + "-" + spec.version + "）");
