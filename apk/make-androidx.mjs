// apk/make-androidx.mjs — M267：收集 androidx 库（jar/aar）到 apk/assets/androidx/
// 来源（按优先级）：
//   1) 已存在的 apk/assets/androidx/（上次收集的结果，增量补）
//   2) 本机 Gradle 缓存 transforms-3（classes.jar）
//   3) 本机 Gradle 缓存 modules-2（aar/jar 原件）
// 设备端 BuildApkHelper.ensureAndroidx() 会把这些文件解压（aar 取 classes.jar）到 cache，
// 自动拼进 ECJ/D8 classpath。依赖 androidx 的项目不用手动拷 aar。
//
// 用法：node apk/make-androidx.mjs [--full]
// 依赖：本机 Gradle 缓存（~/.gradle/caches）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const apkDir = path.dirname(fileURLToPath(import.meta.url));
// 输出到 apk/vendor/androidx/（build.mjs 再拷进 assets/androidx/，aapt2 link 打进去）
const outDir = path.join(apkDir, "vendor", "androidx");

// 常用 androidx 库（1.0.0 时代，编译兼容性最好）
const WANT = [
  "annotation-1.0.0",
  "annotation-experimental-1.0.0",
  "activity-1.0.0",
  "appcompat-1.0.0",
  "asynclayoutinflater-1.0.0",
  "cardview-1.0.0",
  "collection-1.0.0",
  "constraintlayout-1.0.0",
  "coordinatorlayout-1.0.0",
  "core-1.0.0",
  "cursoradapter-1.0.0",
  "customview-1.0.0",
  "documentfile-1.0.0",
  "drawerlayout-1.0.0",
  "exifinterface-1.0.0",
  "fragment-1.0.0",
  "interpolator-1.0.0",
  "legacy-support-core-utils-1.0.0",
  "lifecycle-common-2.0.0",
  "lifecycle-livedata-2.0.0",
  "lifecycle-livedata-core-2.0.0",
  "lifecycle-runtime-2.0.0",
  "lifecycle-service-2.0.0",
  "lifecycle-viewmodel-2.0.0",
  "loader-1.0.0",
  "localbroadcastmanager-1.0.0",
  "percentlayout-1.0.0",
  "print-1.0.0",
  "recyclerview-1.0.0",
  "savedstate-1.0.0",
  "swiperefreshlayout-1.0.0",
  "transition-1.0.0",
  "vectordrawable-1.0.0",
  "viewpager-1.0.0",
  "viewpager2-1.0.0",
];

const full = process.argv.includes("--full");

// --- 来源 1：已有 outDir（非 full 时直接保留）---
if (full) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 已有文件清单
const have = new Map(); // name -> size
for (const f of fs.readdirSync(outDir)) {
  if (!/\.(jar|aar)$/.test(f)) continue;
  const name = f.replace(/\.(jar|aar)$/, "");
  have.set(name, fs.statSync(path.join(outDir, f)).size);
}

// --- 来源 2/3：Gradle 缓存 ---
const home = os.homedir();
const tsDir = path.join(home, ".gradle", "caches", "transforms-3");
const m2Dir = path.join(home, ".gradle", "caches", "modules-2", "files-2.1");

function findInTransforms(name) {
  if (!fs.existsSync(tsDir)) return null;
  for (const d of fs.readdirSync(tsDir)) {
    const jar = path.join(tsDir, d, "transformed", name, "jars", "classes.jar");
    if (fs.existsSync(jar)) return jar;
  }
  return null;
}

function findInModules(name) {
  if (!fs.existsSync(m2Dir)) return null;
  const art = name.split("-")[0];
  const groupDir = path.join(m2Dir, "androidx." + art);
  if (!fs.existsSync(groupDir)) return null;
  const walk = (dir, depth) => {
    if (depth > 5) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const r = walk(p, depth + 1);
        if (r) return r;
      } else if (e.name.endsWith(".aar") || e.name.endsWith(".jar")) {
        return p;
      }
    }
    return null;
  };
  return walk(groupDir, 0);
}

let added = 0, skipped = 0, totalBytes = 0;
for (const name of WANT) {
  // 已有 → 跳过
  if (!full && have.has(name)) {
    totalBytes += have.get(name);
    skipped++;
    continue;
  }
  const src = findInTransforms(name) || findInModules(name);
  if (!src) {
    console.log("缺 " + name + "（缓存里没有，跳过）");
    continue;
  }
  const data = fs.readFileSync(src);
  const ext = src.endsWith(".aar") ? "aar" : "jar";
  fs.writeFileSync(path.join(outDir, name + "." + ext), data);
  totalBytes += data.length;
  added++;
  console.log("  + " + name + "." + ext + "  " + (data.length / 1024).toFixed(0) + "KB");
}

const files = fs.readdirSync(outDir).filter((f) => /\.(jar|aar)$/.test(f));
const allBytes = files.reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`\n收集完成：新增 ${added} / 跳过 ${skipped} / 共 ${files.length} 个文件，${(allBytes / 1024).toFixed(0)}KB`);
console.log("输出目录：" + outDir);
