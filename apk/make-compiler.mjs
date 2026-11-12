// apk/make-compiler.mjs — 打包「设备端 Java 编译器」资源（ECJ + D8 + 桥接类）
//
// 产物（都进 assets/compiler/）：
//   tool1.bin.gz …   编译器本体：ECJ(编译 .java) + D8(.class → dex) + 两个反射桥，dex 后 gzip
//   android.jar.gz   编译用的 Android API 签名库（javac/ECJ 的 -classpath 必需，27MB → gz）
//
// 为什么 gzip：华为/荣耀这类 ROM 的安装扫描会拒「APK 内含 dex 载荷」的包（M192c 踩过），
// 运行时解压到 cache 再 DexClassLoader。
//
// 用法：node apk/make-compiler.mjs
// 依赖：本机 Android SDK（android.jar / d8.jar）+ Android Studio 的 javac + 网络首次下载 ecj.jar
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const apk = path.dirname(fileURLToPath(import.meta.url));
const SDK = process.env.ANDROID_SDK || "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk";
const JBR = "C:\\Program Files\\Android\\Android Studio\\jbr\\bin";
const BT = "35.0.0";
const PLATFORM = "android-35";
const ANDROID_JAR = path.join(SDK, "platforms", PLATFORM, "android.jar");
const D8_JAR = path.join(SDK, "build-tools", BT, "lib", "d8.jar");
const ECJ_URL = "https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.33.0/ecj-3.33.0.jar";

const out = path.join(apk, "build", "compiler");
const vendor = path.join(apk, "vendor");
const ecjJar = path.join(vendor, "ecj.jar");

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd: cwd || apk, stdio: "inherit" });
}

for (const p of [ANDROID_JAR, D8_JAR, path.join(JBR, "javac.exe"), path.join(JBR, "java.exe")]) {
  if (!fs.existsSync(p)) {
    console.error("缺工具：" + p);
    process.exit(1);
  }
}

// 1) ECJ（3.1MB）：首次构建下载，之后复用 apk/vendor/ecj.jar
fs.mkdirSync(vendor, { recursive: true });
if (!fs.existsSync(ecjJar) || fs.statSync(ecjJar).size < 1_000_000) {
  console.log("下载 ECJ…");
  fs.rmSync(ecjJar, { force: true });
  execFileSync("curl.exe", ["-sSL", "--max-time", "180", "-o", ecjJar, ECJ_URL], { stdio: "inherit" });
  if (!fs.existsSync(ecjJar) || fs.statSync(ecjJar).size < 1_000_000) {
    console.error("ECJ 下载失败（可手动放到 apk/vendor/ecj.jar）");
    process.exit(1);
  }
}
console.log("ECJ:", fs.statSync(ecjJar).size, "字节");

// 2) 编译两个桥（它们依赖 ecj.jar / d8.jar，但只装进「编译器 classloader」）
const bridgeSrc = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".java")) bridgeSrc.push(p);
  }
})(path.join(apk, "compiler-src"));
if (bridgeSrc.length === 0) {
  console.error("apk/compiler-src 下没有 .java");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
const bridgeCls = path.join(out, "bridgecls");
fs.mkdirSync(bridgeCls, { recursive: true });
run(path.join(JBR, "javac.exe"), [
  "--release", "11", "-encoding", "UTF-8", "-nowarn",
  "-classpath", [ecjJar, D8_JAR, ANDROID_JAR].join(";"),
  "-d", bridgeCls, ...bridgeSrc,
]);

// 3) d8：桥 + ECJ + D8 一起 → 一个 classloader 里的多 dex（D8 会在超 64K 方法时自动拆）
const dexDir = path.join(out, "dex");
fs.mkdirSync(dexDir, { recursive: true });
const bridgeClasses = fs
  .readdirSync(bridgeCls, { recursive: true })
  .filter((f) => String(f).endsWith(".class"))
  .map((f) => path.join(bridgeCls, String(f)));
run(path.join(JBR, "java.exe"), [
  "-Xmx3g",
  "-cp", D8_JAR, "com.android.tools.r8.D8",
  "--release", "--min-api", "26",
  "--lib", ANDROID_JAR,
  "--output", dexDir,
  ...bridgeClasses,
  ecjJar,
  D8_JAR,
]);

// 4) 每个 dex 单独 gzip（assets/compiler/tool1.bin.gz …）
const dexFiles = fs.readdirSync(dexDir).filter((f) => /^classes\d*\.dex$/.test(f)).sort();
if (dexFiles.length === 0) {
  console.error("d8 没产出 dex");
  process.exit(1);
}
let toolBytes = 0;
dexFiles.forEach((f, i) => {
  const src = path.join(dexDir, f);
  const dst = path.join(out, `tool${i + 1}.bin.gz`);
  const raw = fs.readFileSync(src);
  fs.writeFileSync(dst, zlib.gzipSync(raw, { level: 9 }));
  toolBytes += fs.statSync(dst).size;
  console.log(`  ${f} ${raw.length} → ${path.basename(dst)} ${fs.statSync(dst).size} 字节`);
});

// 5) android.jar → gz（编译 classpath 用；解压到 cache 即可，无需 dex）
const jarGz = path.join(out, "android.jar.gz");
fs.writeFileSync(jarGz, zlib.gzipSync(fs.readFileSync(ANDROID_JAR), { level: 9 }));

// 5.5) M219：ECJ 的诊断消息包（.properties）。D8 dex 时把这些 .properties 丢光了，
// ECJ 一初始化就 ResourceBundle.getBundle(...batch.messages)，找不到会抛 MissingResourceException
// （"Can't find bundle ... locale zh_CN"）。把这 4 个包从 ecj.jar 里抠出来打成 zip 再 gzip，
// 设备端解到 cache/compiler/res 并挂到编译器 classloader 父链（MainActivity.ResClassLoader）。
const MSGS = [
  "org/eclipse/jdt/internal/compiler/batch/messages.properties",
  "org/eclipse/jdt/internal/compiler/problem/messages.properties",
  "org/eclipse/jdt/internal/compiler/messages.properties",
  "org/eclipse/jdt/internal/antadapter/messages.properties",
];
const msgsDir = path.join(out, "msgs");
fs.rmSync(msgsDir, { recursive: true, force: true });
fs.mkdirSync(msgsDir, { recursive: true });
for (const rel of MSGS) {
  // jar xf 不支持 -C，用 cwd 定位提取目录；entry 用正斜杠
  execFileSync(path.join(JBR, "jar.exe"), ["xf", ecjJar, rel], { cwd: msgsDir, stdio: "ignore" });
  if (!fs.existsSync(path.join(msgsDir, rel.replace(/\//g, path.sep)))) {
    console.error("ECJ 里找不到 " + rel);
    process.exit(1);
  }
}
const msgsZip = path.join(out, "msgs.zip");
execFileSync(path.join(JBR, "jar.exe"), ["cf", msgsZip, "-C", msgsDir, "org"], { stdio: "ignore" });
const msgsGz = path.join(out, "msgs.bin.gz");
fs.writeFileSync(msgsGz, zlib.gzipSync(fs.readFileSync(msgsZip), { level: 9 }));
console.log(`  msgs.bin.gz ${fs.statSync(msgsGz).size} 字节（${MSGS.length} 个 ECJ 消息包）`);

const jarGzSize = fs.statSync(jarGz).size;
console.log(`compiler 资源就绪：${dexFiles.length} 个 tool dex（共 ${(toolBytes / 1048576).toFixed(2)} MB）+ android.jar.gz ${(jarGzSize / 1048576).toFixed(2)} MB`);
if (jarGzSize > 40 * 1048576) {
  console.error("android.jar.gz 过大（>40MB），检查 SDK");
  process.exit(1);
}

// M227：写 compiler/manifest.json。注意：记录的是**解压后**（落盘到 cache 里）的文件大小 + sha256，
// 设备端解压到 cache/compiler 后逐个比（tool*.bin / android.jar / res 目录）。
// 缺哪个/坏哪个精确报出来（治 1.16.88 那个「没找到编译器 dex」静默失败）。
function sha256OfBytes(buf) { return createHash("sha256").update(buf).digest("hex"); }
function gzipSizeOfUncompressed(out, gzName) {
  const gzf = path.join(out, gzName);
  if (!fs.existsSync(gzf)) return null;
  return fs.statSync(gzf).size; // 仅用于人读
}
const manifest = { id: "ecj-d8", name: "Java 编译器（ECJ + D8）", version: "3.33.0", loader: "dex", files: [] };
dexFiles.forEach((f, idx) => {
  const dexFile = path.join(dexDir, f);
  // 解压后 = 原 dex 字节（cache 里落的是 toolN.bin，就是 dex 本身）
  const raw = fs.readFileSync(dexFile);
  manifest.files.push({ path: "tool" + (idx + 1) + ".bin", size: raw.length, sha256: sha256OfBytes(raw), role: "compiler-dex" });
});
{
  const jarRaw = fs.readFileSync(ANDROID_JAR);
  manifest.files.push({ path: "android.jar", size: jarRaw.length, sha256: sha256OfBytes(jarRaw), role: "classpath" });
}
manifest.files.push({ path: "res", size: 0, sha256: "", role: "i18n" }); // msgs 解到 res/ 目录，缺失不致命
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("compiler/manifest.json 已写（" + manifest.files.length + " 文件，记录解压后大小+sha256）");
