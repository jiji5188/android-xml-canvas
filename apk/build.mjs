// apk/build.mjs — 不用 Gradle，直接用 SDK 的 aapt2/javac/d8/zipalign/apksigner 组装壳 APK
// 用法：node apk/build.mjs
// 需要本机装了 Android SDK（默认 C:\Users\admin\AppData\Local\Android\Sdk）
// 和 Android Studio 自带 JDK（jbr）；assets/www 会先从仓库 out/ 拷贝进来
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 脚本自身所在的 apk/ 目录（不依赖 process.cwd()，从哪调都行）
const apk = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apk, "..");
const SDK = process.env.ANDROID_SDK || "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk";
const JBR = "C:\\Program Files\\Android\\Android Studio\\jbr\\bin";
const BT = "35.0.0";
const PLATFORM = "android-35";

function run(cmd, args, cwd) {
  const full = cmd.startsWith("node") || cmd.endsWith("mjs") ? process.execPath : cmd;
  const a = cmd.endsWith(".mjs") ? args : args;
  console.log("$", cmd, args.join(" "));
  execFileSync(full, cmd.endsWith(".mjs") ? a : a, { cwd: cwd || apk, stdio: "inherit" });
}

const btExe = (n) => path.join(SDK, "build-tools", BT, n);
const jbrExe = (n) => path.join(JBR, n + ".exe");

// 0) 前置检查
for (const p of [btExe("aapt2.exe"), btExe("lib/d8.jar"), btExe("lib/apksigner.jar"), btExe("zipalign.exe"), jbrExe("javac"), jbrExe("keytool"), jbrExe("jar"), path.join(SDK, "platforms", PLATFORM, "android.jar")]) {
  if (!fs.existsSync(p)) {
    console.error("缺 SDK 工具：" + p);
    process.exit(1);
  }
}

// 1) 仓库 out/ 必须存在（先 npm run build 过）
const outDir = path.join(repoRoot, "out");
if (!fs.existsSync(path.join(outDir, "xml", "index.html"))) {
  console.error("先跑一次 next build 生成 out/（仓库根：npm run build）");
  process.exit(1);
}

// 2) 拷静态站进 assets/www
const www = path.join(apk, "assets", "www");
fs.rmSync(path.join(apk, "assets"), { recursive: true, force: true });
fs.cpSync(outDir, www, { recursive: true });
// M151：把外部资源包（aapt2 产物）一起放进 assets，供 PreviewActivity 加载。
// 源头：D:\android-xml-canvas\foundation\out\preview-res.apk（foundation/build.mjs 生成）
const previewRes = path.join(repoRoot, "..", "foundation", "out", "preview-res.apk");
if (fs.existsSync(previewRes)) {
  fs.copyFileSync(previewRes, path.join(www, "preview-res.apk"));
  console.log("资源包已带入：", fs.statSync(previewRes).size, "字节");
} else {
  console.warn("⚠ 未找到 foundation/out/preview-res.apk，PreviewActivity 会报资源缺失");
}
console.log("assets 拷贝完成：", fs.readdirSync(www).length, "个顶层项");

// 3) aapt2 compile + link（-A 把 assets 打进去）
fs.rmSync(path.join(apk, "build"), { recursive: true, force: true });
fs.mkdirSync(path.join(apk, "build"), { recursive: true });
run(btExe("aapt2.exe"), ["compile", "--dir", "res", "-o", "build/compiled.zip"], apk);
run(btExe("aapt2.exe"), [
  "link", "-o", "build/base.apk",
  "-I", path.join(SDK, "platforms", PLATFORM, "android.jar"),
  "--manifest", "AndroidManifest.xml",
  "-R", "build/compiled.zip",
  "--auto-add-overlay",
  "--java", "build/gen",
  "--min-sdk-version", "24",
  "--target-sdk-version", "34",
], apk);

// 4) javac（src 下所有 .java 都编，M151 起不止 MainActivity）
const javaSrc = [];
(function walkJava(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJava(p);
    else if (e.name.endsWith(".java")) javaSrc.push(p);
  }
})(path.join(apk, "src"));
run(jbrExe("javac"), [
  "--release", "11", "-classpath", path.join(SDK, "platforms", PLATFORM, "android.jar"),
  "-d", "build/classes",
  ...javaSrc,
  "build/gen/com/jiji/axv/R.java",
], apk);

// 5) d8 → dex（把 classes + gen 下所有 .class 喂给 D8）
{
  function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith(".class")) acc.push(p);
    }
    return acc;
  }
  const classes = [...walk(path.join(apk, "build/classes")), ...walk(path.join(apk, "build/gen"))];
  fs.mkdirSync(path.join(apk, "build/dex"), { recursive: true });
  run(jbrExe("java"), [
    "-cp", btExe("lib/d8.jar"), "com.android.tools.r8.D8",
    "--lib", path.join(SDK, "platforms", PLATFORM, "android.jar"),
    "--min-api", "24",
    "--output", "build/dex",
    ...classes,
  ], apk);
}

// 6) 把 classes.dex 塞进 base.apk（用 keytool 里带的 jar 不行，直接 zip 命令或 node 打 zip）
//    用 zip（build-tools 不带，系统一般也没有）→ 退化成 PowerShell Compress-Archive 不可靠，
//    改用 Java 的 jar 命令（jbr 里有 jar.exe）：jar uf base.apk classes.dex
run(jbrExe("jar"), ["uf", "build/base.apk", "-C", "build/dex", "classes.dex"], apk);

// 6.2) M192：预编译两个「设备端要用」的 dex，后面当 assets 塞进去
//  - shell.dex ：一键打包生成的 APK 里那个只显示布局的 Activity（设备上没有 javac/d8，
//                项目的 Java 编译不了，这个壳让用户在真机上看到成品）
//  - signer.dex：apksig（官方签名实现）+ SigningBridge 一起 dex，设备端靠 DexClassLoader
//                加载后签 v2/v3 —— 比自己拼 ASN.1 签名块可靠得多
{
  const androidJar = path.join(SDK, "platforms", PLATFORM, "android.jar");
  const apksignerJar = btExe("lib/apksigner.jar");

  const shellSrc = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".java")) shellSrc.push(p);
    }
  })(path.join(apk, "shell-src"));
  fs.mkdirSync(path.join(apk, "build/shellcls"), { recursive: true });
  run(jbrExe("javac"), [
    "--release", "11", "-encoding", "UTF-8", "-classpath", androidJar,
    "-d", "build/shellcls", ...shellSrc,
  ], apk);
  fs.mkdirSync(path.join(apk, "build/shelldex"), { recursive: true });
  run(jbrExe("java"), [
    "-cp", btExe("lib/d8.jar"), "com.android.tools.r8.D8",
    "--lib", androidJar, "--min-api", "24", "--output", "build/shelldex",
    ...fs.readdirSync(path.join(apk, "build/shellcls"), { recursive: true })
      .filter((f) => String(f).endsWith(".class"))
      .map((f) => path.join("build/shellcls", String(f))),
  ], apk);

  const signerSrc = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".java")) signerSrc.push(p);
    }
  })(path.join(apk, "signer-src"));
  fs.mkdirSync(path.join(apk, "build/signcls"), { recursive: true });
  run(jbrExe("javac"), [
    "--release", "11", "-encoding", "UTF-8", "-classpath", apksignerJar,
    "-d", "build/signcls", ...signerSrc,
  ], apk);
  fs.mkdirSync(path.join(apk, "build/signdex"), { recursive: true });
  run(jbrExe("java"), [
    "-cp", btExe("lib/d8.jar"), "com.android.tools.r8.D8",
    "--lib", androidJar, "--min-api", "24", "--output", "build/signdex",
    ...fs.readdirSync(path.join(apk, "build/signcls"), { recursive: true })
      .filter((f) => String(f).endsWith(".class"))
      .map((f) => path.join("build/signcls", String(f))),
    apksignerJar,
  ], apk);
}

// 6.5) assets 必须用正斜杠：aapt2 在 Windows 上会写成反斜杠（AssetManager 读不到，白屏），
//      .NET ZipArchive 追加又会写 data descriptor（启动闪退）——用 append-assets.mjs 纯手写 STORE
// M155：顺手把 framework 资源桩（只含 attr 的最小 android 包）也打进去，
//      设备端 aapt2 link 的 -I 用它 —— 手机上 framework-res.apk 常常读不到，
//      android.jar 里的 resources.arsc 又会被手机版 aapt2 判为非法。
const fwStub = path.join(apk, "build", "framework-res-stub.apk.gz");
const fwRaw = path.join(apk, "build", "framework-res-stub.apk");
run(process.execPath, [path.join(apk, "make-fw-stub.mjs"), path.join(SDK, "platforms", PLATFORM), fwStub, fwRaw, btExe("aapt2.exe")], apk);
run(process.execPath, [path.join(apk, "append-assets.mjs"), path.join(apk, "build", "base.apk"), path.join(apk, "assets", "www"),
  "--add", path.join(apk, "lib", "arm64-v8a", "libaapt2.so"), "lib/arm64-v8a/libaapt2.so",
  "--add", fwStub, "assets/fw/framework-res-stub.apk.gz",
  "--add", path.join(apk, "build", "shelldex", "classes.dex"), "assets/shell/shell.dex",
  "--add", path.join(apk, "build", "signdex", "classes.dex"), "assets/apksig/signer.dex"], apk);

// 7) zipalign + 签名
const keystore = path.join(apk, "debug.keystore");
if (!fs.existsSync(keystore)) {
  run(jbrExe("keytool"), [
    "-genkeypair", "-v", "-keystore", keystore,
    "-storepass", "android", "-keypass", "android",
    "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000",
    "-dname", "CN=Android Debug,O=Android,C=US",
  ], apk);
}
const apksignerJar = path.join(SDK, "build-tools", BT, "lib", "apksigner.jar");
const signArgs = (extra) => ["-jar", apksignerJar, ...extra];
run(btExe("zipalign.exe"), ["-f", "4", "build/base.apk", "build/aligned.apk"], apk);
run(jbrExe("java"), signArgs([
  "sign", "--ks", keystore,
  "--ks-pass", "pass:android", "--key-pass", "pass:android",
  "--ks-key-alias", "androiddebugkey",
  "--out", "build/app.apk",
  "build/aligned.apk",
]), apk);

const final = path.join(apk, "build", "app.apk");
console.log("\n=== 完成：", final, " 大小", (fs.statSync(final).size / 1048576).toFixed(2) + " MB", "===");
run(jbrExe("java"), signArgs(["verify", "--verbose", final]), apk);
