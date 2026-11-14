package com.jiji.axv;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.util.Log;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.GZIPInputStream;

/**
 * M239：把「设备端打包 APK」整条管线从 MainActivity 里抽出来。
 * 之前 buildInstallApk / compileProjectJava / signWithApksig / ensureCompiler
 * 全塞在 3900 行的大 Activity 里，改一处要翻半天。
 *
 * 现在是纯工具类：new BuildApkHelper(context) → build(payloadJson) → JSON 字符串。
 * 不依赖 Activity 任何 state，只依赖 Context（cacheDir / assets / nativeLibraryDir）。
 */
public class BuildApkHelper {
    private static final String TAG = "BuildApkHelper";
    private final Context ctx;

    public BuildApkHelper(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    /** 入口：payload JSON 同 MainActivity.buildInstallApk 的协议 */
    public String build(String payloadJson) {
        long t0 = System.currentTimeMillis();
        StringBuilder log = new StringBuilder();
        String step = "init";
        try {
            JSONObject p = new JSONObject(payloadJson);
            String pkg = p.optString("pkg", "com.axv.app");
            String layout = p.optString("layout", "activity_main");
            String label = p.optString("appName", "AXV App");
            String outName = p.optString("outName", "");
            JSONArray javaSources = p.optJSONArray("javaSources");
            String launchActivity = p.optString("launchActivity", "");
            String ksPath = p.optString("keystore", "");
            String storePass = p.optString("storePass", "");
            String alias = p.optString("alias", "");
            String keyPass = p.optString("keyPass", "");
            JSONArray files = p.optJSONArray("files");

            if (!pkg.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*")) {
                return "{\"ok\":false,\"step\":\"pkg\",\"log\":\"包名不合法: " + pkg.replace("\"", "") + "\"}";
            }
            if (ksPath.isEmpty() || !new File(ksPath).isFile()) {
                return "{\"ok\":false,\"step\":\"keystore\",\"log\":\"找不到 keystore 文件，先在弹层里生成一个\"}";
            }
            if (files == null || files.length() == 0) {
                return "{\"ok\":false,\"step\":\"files\",\"log\":\"没有资源文件\"}";
            }

            step = "write";
            File root = new File(ctx.getCacheDir(), "buildapk");
            deleteTree(root);
            File resDir = new File(root, "res");
            if (!resDir.mkdirs()) throw new IOException("mkdirs 失败: " + resDir);

            int written = 0;
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String path = f.optString("path", "");
                String text = f.optString("text", "");
                String b64 = f.optString("base64", "");
                if (path.isEmpty()) continue;
                if (path.startsWith("/") || path.contains("..")) continue;
                if (!b64.isEmpty()) {
                    byte[] data;
                    try {
                        data = Base64.decode(b64, android.util.Base64.NO_WRAP);
                    } catch (IllegalArgumentException bad) {
                        continue;
                    }
                    if (data.length == 0) continue;
                    writeBytes(new File(resDir, path), data);
                    written++;
                    continue;
                }
                if (text.isEmpty()) continue;
                writeUtf8(new File(resDir, path), text);
                written++;
            }
            log.append("资源 ").append(written).append(" 个文件\n");

            File man = new File(root, "AndroidManifest.xml");
            writeUtf8(man, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                    + "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"" + pkg + "\">\n"
                    + "  <uses-sdk android:minSdkVersion=\"24\" android:targetSdkVersion=\"34\" />\n"
                    + "  <application android:label=\"" + xmlAttr(label) + "\">\n"
                    + "    <activity android:name=\"com.jiji.axv.shell.ShellActivity\" android:exported=\"true\">\n"
                    + "      <meta-data android:name=\"axv.layout\" android:value=\"" + xmlAttr(layout) + "\" />\n"
                    + "      <meta-data android:name=\"axv.launcher\" android:value=\"" + xmlAttr(launchActivity) + "\" />\n"
                    + "      <intent-filter>\n"
                    + "        <action android:name=\"android.intent.action.MAIN\" />\n"
                    + "        <category android:name=\"android.intent.category.LAUNCHER\" />\n"
                    + "      </intent-filter>\n"
                    + "    </activity>\n"
                    + "  </application>\n"
                    + "</manifest>\n");

            step = "aapt2";
            File bin = new File(ctx.getApplicationInfo().nativeLibraryDir, "libaapt2.so");
            if (!bin.isFile()) throw new IOException("找不到 aapt2：" + bin);
            File fw = frameworkResForLink(root, log);
            File compiled = new File(root, "compiled.zip");
            File genDir = new File(root, "gen");
            File customPkg = new File(root, ".pkg");
            writeUtf8(customPkg, pkg + "\n");
            int c1 = runAapt2(bin, root, new String[] { "compile", "--dir", resDir.getAbsolutePath(),
                    "-o", compiled.getAbsolutePath() }, log);
            if (c1 != 0) {
                dumpLayoutHeads(resDir, log);
                return jsonFail("compile", log);
            }
            File unsigned = new File(root, "unsigned.apk");
            int c2 = runAapt2(bin, root, new String[] { "link", "-o", unsigned.getAbsolutePath(),
                    "-I", fw.getAbsolutePath(),
                    "--manifest", man.getAbsolutePath(),
                    "--min-sdk-version", "24",
                    "--target-sdk-version", "34",
                    "--auto-add-overlay",
                    "--java", genDir.getAbsolutePath(),
                    "--custom-package", pkg,
                    compiled.getAbsolutePath() }, log);
            if (c2 != 0) return jsonFail("link", log);
            if (!unsigned.isFile()) return jsonFail("link", log);

            step = "pack";
            File packed = new File(root, "packed.apk");
            java.util.List<byte[]> extraDex = new java.util.ArrayList<>();
            JSONArray dx = p.optJSONArray("extraDex");
            if (dx != null) {
                long dexTotal = 0;
                for (int i = 0; i < dx.length() && extraDex.size() < 8; i++) {
                    JSONObject d = dx.optJSONObject(i);
                    if (d == null) continue;
                    String b64 = d.optString("base64", "");
                    if (b64.isEmpty()) continue;
                    byte[] data;
                    try {
                        data = Base64.decode(b64, Base64.NO_WRAP);
                    } catch (IllegalArgumentException bad) {
                        continue;
                    }
                    if (data.length < 8 || data.length > 12 * 1024 * 1024) continue;
                    if (data[0] != 'd' || data[1] != 'e' || data[2] != 'x') continue;
                    if (dexTotal + data.length > 40L * 1024 * 1024) break;
                    dexTotal += data.length;
                    extraDex.add(data);
                }
            }
            step = "compile";
            String compileMode;
            try {
                compileMode = compileProjectJava(javaSources, root, genDir, log, extraDex, files);
            } catch (IOException ce) {
                final String cm2 = ce.getMessage() == null ? "" : ce.getMessage();
                if (cm2.contains("编译器") || cm2.contains("android.jar") || cm2.contains("compiler")) {
                    log.append("⚠ 设备端 Java 编译器不可用（").append(ce.getMessage())
                            .append("），本次退化为布局壳（不运行 Java 逻辑）；重打包前请确认 APK 内含 compiler 资源\n");
                    compileMode = "shell-no-compiler";
                } else {
                    throw ce;
                }
            }
            ApkPack.addDexAndAlign(unsigned, readAssetGz("shell/shell.bin.gz"), extraDex, packed);
            log.append("注入壳 dex + ").append(extraDex.size()).append(" 个项目 dex，打包后 ")
                    .append(packed.length()).append(" 字节\n");

            step = "sign";
            File signedTmp = new File(root, "signed.apk");
            String sr = signWithApksig(packed, signedTmp, ksPath, storePass, alias, keyPass);
            if (!sr.startsWith("ok:")) {
                final String why = sr.startsWith("err:") ? sr.substring(4) : sr;
                return "{\"ok\":false,\"step\":\"sign\",\"log\":" + quote(why) + "}";
            }
            log.append("签名完成 v1/v2/v3（apksig） -> ").append(signedTmp.length()).append(" 字节\n");

            step = "output";
            File outDir = defaultOutDir();
            if (!outDir.isDirectory() && !outDir.mkdirs()) throw new IOException("建不了输出目录: " + outDir);
            String name = outName.isEmpty() ? (pkg + ".apk") : outName;
            if (!name.endsWith(".apk")) name = name + ".apk";
            File out = new File(outDir, name);
            try (FileOutputStream fos = new FileOutputStream(out);
                 FileInputStream fis = new FileInputStream(signedTmp)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = fis.read(buf)) > 0) fos.write(buf, 0, r);
            }

            return "{\"ok\":true,\"path\":" + quote(out.getAbsolutePath())
                    + ",\"name\":" + quote(out.getName())
                    + ",\"bytes\":" + out.length()
                    + ",\"ms\":" + (System.currentTimeMillis() - t0)
                    + ",\"pkg\":" + quote(pkg)
                    + ",\"layout\":" + quote(layout)
                    + ",\"compileMode\":" + quote(compileMode)
                    + ",\"log\":" + quote(log.toString()) + "}";
        } catch (Throwable t) {
            Log.e(TAG, "build fail", t);
            String m = t.getMessage();
            return "{\"ok\":false,\"step\":" + quote(step) + ",\"log\":"
                    + quote((m == null ? t.getClass().getSimpleName() : m) + "\n" + log) + "}";
        }
    }

    /** M240：导入 APK 换资源 + 重签名（委托自 MainActivity.repackApk）。
     *  payload: { apk, replacements: [{name, base64}], keystore, storePass, alias, keyPass, outName }
     *  返回 ok:<path> / err:<step>:<msg>
     */
    public String repack(String payloadJson) {
        StringBuilder log = new StringBuilder();
        String step = "init";
        try {
            JSONObject p = new JSONObject(payloadJson);
            String apk = p.optString("apk", "");
            String ksPath = p.optString("keystore", "");
            String storePass = p.optString("storePass", "");
            String alias = p.optString("alias", "");
            String keyPass = p.optString("keyPass", "");
            String outName = p.optString("outName", "");
            File src = new File(apk);
            if (!src.isFile()) return "err:src:找不到源 APK";
            if (ksPath.isEmpty() || !new File(ksPath).isFile()) return "err:keystore:找不到 keystore";

            java.util.Map<String, byte[]> reps = new java.util.HashMap<>();
            JSONArray rl = p.optJSONArray("replacements");
            if (rl != null) {
                for (int i = 0; i < rl.length(); i++) {
                    JSONObject r = rl.optJSONObject(i);
                    if (r == null) continue;
                    String nm = r.optString("name", "");
                    String b64 = r.optString("base64", "");
                    if (nm.isEmpty() || b64.isEmpty()) continue;
                    if (nm.contains("..")) continue;
                    try {
                        reps.put(nm, Base64.decode(b64, Base64.NO_WRAP));
                    } catch (IllegalArgumentException bad) {
                        // 跳过坏 base64，继续
                    }
                }
            }

            step = "pack";
            File work = new File(ctx.getCacheDir(), "repack");
            deleteTree(work);
            work.mkdirs();
            File packed = new File(work, "packed.apk");
            int n = ApkPack.repack(src, reps, packed);
            log.append("重打包 ").append(n).append(" 个条目（换了 ").append(reps.size()).append(" 个）\n");

            step = "sign";
            File signed = new File(work, "signed.apk");
            String sr = signWithApksig(packed, signed, ksPath, storePass, alias, keyPass);
            if (!sr.startsWith("ok:")) return "err:sign:" + (sr.startsWith("err:") ? sr.substring(4) : sr);

            step = "output";
            File outDir = defaultOutDir();
            if (!outDir.isDirectory() && !outDir.mkdirs()) throw new IOException("建不了输出目录");
            String name = outName.isEmpty() ? "repacked.apk" : outName;
            if (!name.endsWith(".apk")) name = name + ".apk";
            File out = new File(outDir, name);
            try (FileOutputStream fos = new FileOutputStream(out);
                 FileInputStream fis = new FileInputStream(signed)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = fis.read(buf)) > 0) fos.write(buf, 0, r);
            }
            log.append("输出 ").append(out.length()).append(" 字节\n");
            return "ok:" + out.getAbsolutePath();
        } catch (Throwable t) {
            return "err:" + step + ":" + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
        }
    }

    // ===== 编译 =====

    private String compileProjectJava(JSONArray javaSources, File root, File genDir,
                                      StringBuilder log, java.util.List<byte[]> extraDex, JSONArray resFiles) throws Exception {
        if (javaSources == null || javaSources.length() == 0) {
            log.append("项目无 Java 源码：本次打包为布局壳（不运行任何逻辑）\n");
            return "none";
        }
        String fingerprint = compileFingerprint(javaSources, resFiles);
        File cacheDir = new File(ctx.getCacheDir(), "dxcache");
        if (!cacheDir.isDirectory() && !cacheDir.mkdirs()) { /* ignore */ }
        File cacheFile = new File(cacheDir, fingerprint + ".d");
        pruneDexCache(cacheDir, 24);
        java.util.List<byte[]> cachedDex = readDexCache(cacheFile);
        if (cachedDex != null && !cachedDex.isEmpty()) {
            cacheFile.setLastModified(System.currentTimeMillis());
            extraDex.addAll(cachedDex);
            log.append("命中编译缓存（").append(cachedDex.size()).append(" 个 dex），跳过 ECJ+D8 编译\n");
            return "java:" + cachedDex.size();
        }
        pruneDexCache(cacheDir, 24);
        File compDir = ensureCompiler();
        File clsDir = new File(root, "cls");
        File srcDir = new File(root, "srcx");
        java.util.List<File> files = new java.util.ArrayList<>();
        for (int i = 0; i < javaSources.length(); i++) {
            JSONObject j = javaSources.getJSONObject(i);
            String rel = j.optString("path", "");
            String code = j.optString("code", "");
            if (rel.isEmpty() || rel.contains("..")) continue;
            File dst = new File(srcDir, rel);
            dst.getParentFile().mkdirs();
            writeUtf8(dst, code);
            files.add(dst);
        }
        java.util.List<String> rFiles = new java.util.ArrayList<>();
        if (genDir != null && genDir.isDirectory()) {
            walkJava(genDir, rFiles);
        }
        log.append("编译 ").append(files.size()).append(" 个 java + ").append(rFiles.size()).append(" 个 R.java\n");
        File androidJar = new File(compDir, "android.jar");
        if (!androidJar.isFile() || androidJar.length() < 1024 * 1024) {
            throw new IOException("缺 android.jar（编译器资源没装齐，无法编译 Java）");
        }
        java.lang.ClassLoader cl = compilerLoader(compDir);
        Class<?> ecj = cl.loadClass("com.jiji.axv.compiler.EcjBridge");
        java.util.List<String> ecjLog = new java.util.ArrayList<>();
        String[] ecjArgs = new String[] {
            "-source", "11", "-target", "11", "-nowarn", "-encoding", "UTF-8",
            "-classpath", androidJar.getAbsolutePath(),
            "-d", clsDir.getAbsolutePath() };
        java.lang.reflect.Method ecjCompile = ecj.getMethod("compile", String[].class, java.util.List.class);
        boolean ecjOk = Boolean.valueOf((Boolean) ecjCompile.invoke(null, ecjArgs, ecjLog));
        if (!ecjOk || ecjLog.size() > 0) {
            log.append("ECJ: ").append(String.join("\n", ecjLog).substring(0, Math.min(2000, String.join("\n", ecjLog).length()))).append("\n");
        }
        if (!ecjOk) throw new IOException("Java 编译失败（看上面 ECJ 的报错行）—— 已中止打包，不会偷偷生成只显示布局的壳包");
        File dexDir = new File(root, "jex");
        dexDir.mkdirs();
        java.util.List<String> classFiles = new java.util.ArrayList<>();
        walkClass(clsDir, classFiles);
        Class<?> d8 = cl.loadClass("com.jiji.axv.compiler.D8Bridge");
        java.util.List<String> d8Log = new java.util.ArrayList<>();
        java.util.List<String> d8Args = new java.util.ArrayList<>();
        d8Args.add("--release"); d8Args.add("--min-api"); d8Args.add("24");
        d8Args.add("--lib"); d8Args.add(androidJar.getAbsolutePath());
        d8Args.add("--output"); d8Args.add(dexDir.getAbsolutePath());
        d8Args.addAll(classFiles);
        java.lang.reflect.Method d8Method = d8.getMethod("dex", String[].class, java.util.List.class);
        boolean d8Ok = Boolean.valueOf((Boolean) d8Method.invoke(null, d8Args.toArray(new String[0]), d8Log));
        if (!d8Ok || d8Log.size() > 0) {
            log.append("D8: ").append(String.join("\n", d8Log)).append("\n");
        }
        if (!d8Ok) throw new IOException("dex 转换失败（见上面 D8 日志）—— 已中止打包");
        File[] dexFiles = dexDir.listFiles();
        if (dexFiles == null) dexFiles = new File[0];
        java.util.Arrays.sort(dexFiles, (a, b) -> a.getName().compareTo(b.getName()));
        // 护栏（同 M211）：≤ 12MB/个、总 ≤ 40MB、dex 魔数
        long total = 0;
        int n = 0;
        for (File df : dexFiles) {
            if (!df.getName().matches("classes\\d*\\.dex")) continue;
            byte[] data = readFile(df);
            if (data == null || data.length < 8 || data.length > 12 * 1024 * 1024) continue;
            if (data[0] != 'd' || data[1] != 'e' || data[2] != 'x') continue;
            if (total + data.length > 40L * 1024 * 1024) break;
            extraDex.add(data);
            total += data.length;
            n++;
        }
        log.append("设备端编译成功，注入 ").append(n).append(" 个 dex（").append(total / 1024).append(" KB）\n");
        if (n > 0) writeDexCache(cacheFile, dexFiles);
        return "java:" + n;
    }

    // ===== 编译器管理 =====
    // M242：以下 ensureCompiler / compilerLoader / ResClassLoader / signWithApksig 都是
    // MainActivity 里的原实现逐字移植。之前那版是我按签名猜的简写，dex 根本没加载进去，
    // 真机上签名直接 NPE（Class 为 null）。别再手写，缺什么就从 MainActivity 抄。

    private File ensureCompiler() throws IOException {
        File dir = new File(ctx.getCacheDir(), "compiler");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("建不了 compiler 目录");
        // M229：每次强制清空重解，甩掉历史残留（只读旧文件 / 半截下载 / 旧版 cache）
        try { deleteTree(dir); } catch (Throwable ignored) {}
        if (!dir.mkdirs()) throw new IOException("重建 compiler 目录失败");
        File jar = new File(dir, "android.jar");
        byte[] jarBytes = readAssetGz("compiler/android.jar.gz");
        if (jarBytes == null) throw new IOException("APK 内缺 compiler/android.jar.gz（先在设置里下载/内置编译器资源）");
        writeBytes(jar, jarBytes);
        if (jar.canWrite()) {
            jar.setReadOnly();
            try { Runtime.getRuntime().exec(new String[]{"chmod","444",jar.getAbsolutePath()}).waitFor(); } catch (Throwable ignored) {}
        }
        int i = 1;
        String toolBreakReason = null;
        while (true) {
            File binFile = new File(dir, "tool" + i + ".bin");
            byte[] b = readAssetGz("compiler/tool" + i + ".bin.gz");
            if (b == null) {
                toolBreakReason = (i == 1) ? "读不到 compiler/tool1.bin.gz" : ("compiler/tool" + i + ".bin.gz 读到一半中断");
                break;
            }
            writeBytes(binFile, b);
            if (binFile.canWrite()) {
                binFile.setReadOnly();
                try { Runtime.getRuntime().exec(new String[]{"chmod","444",binFile.getAbsolutePath()}).waitFor(); } catch (Throwable ignored) {}
            }
            i++;
        }
        validateCompiler(dir, toolBreakReason, i - 1);
        // M219：ECJ 诊断消息包（.properties 在 dex 里被丢光了）解到 dir/res/…
        try {
            File resDir = new File(dir, "res");
            byte[] msgs = readAssetGz("compiler/msgs.bin.gz");
            if (resDir.isDirectory()) { File[] old = resDir.listFiles(); if (old != null) for (File x : old) deleteTree(x); }
            resDir.mkdirs();
            unzipToDir(msgs, resDir);
        } catch (Throwable ignored) {
            // 资源缺失/解包失败：不阻断编译
        }
        return dir;
    }

    /** 建编译器 classloader（多 dex 内存加载），父链挂 ResClassLoader 供 ECJ 找消息包 */
    private java.lang.ClassLoader compilerLoader(File compDir) throws IOException {
        java.util.List<byte[]> els = new java.util.ArrayList<>();
        int i = 1;
        while (true) {
            File b = new File(compDir, "tool" + i + ".bin");
            if (!b.isFile()) break;
            byte[] data = readFile(b);
            if (data == null || data.length == 0) break;
            els.add(data);
            i++;
        }
        if (els.isEmpty()) throw new IOException("没找到编译器 dex（tool*.bin）");
        java.nio.ByteBuffer[] bb = new java.nio.ByteBuffer[els.size()];
        for (int k = 0; k < els.size(); k++) bb[k] = java.nio.ByteBuffer.wrap(els.get(k));
        File resDir = new File(compDir, "res");
        java.lang.ClassLoader resLoader = new ResClassLoader(resDir, ctx.getClassLoader());
        java.lang.ClassLoader cl = new dalvik.system.InMemoryDexClassLoader(bb, null, resLoader);
        // 顺带把 TCCL 指到它，避免 ECJ 内部用线程 classloader 找资源时绕过父链
        Thread.currentThread().setContextClassLoader(cl);
        return cl;
    }

    /** 只服务 res 目录的资源 ClassLoader（ECJ 的 ResourceBundle.getBundle 靠它） */
    private static final class ResClassLoader extends java.lang.ClassLoader {
        private final File root;
        ResClassLoader(File root, java.lang.ClassLoader parent) { super(parent); this.root = root; }
        @Override public java.net.URL findResource(String name) {
            java.io.File f = new java.io.File(root, name.replace('/', java.io.File.separatorChar));
            return f.isFile() ? safeUrl(f) : null;
        }
        @Override public java.io.InputStream getResourceAsStream(String name) {
            try {
                java.io.File f = new java.io.File(root, name.replace('/', java.io.File.separatorChar));
                return f.isFile() ? new java.io.FileInputStream(f) : null;
            } catch (Throwable t) { return null; }
        }
        @Override public java.net.URL getResource(String name) {
            java.net.URL u = findResource(name);
            if (u != null) return u;
            return super.getResource(name);
        }
        private static java.net.URL safeUrl(java.io.File f) {
            try { return f.toURI().toURL(); } catch (Throwable t) { return null; }
        }
    }

    // ===== 签名 =====

    /** apksig 签名（assets/apksig/signer.bin.gz → DexClassLoader → SigningBridge.sign 静态方法） */
    public String signWithApksig(File inApk, File outApk, String ksPath, String storePass, String alias, String keyPass) {
        try {
            File dir = new File(ctx.getCacheDir(), "apksig");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("建不了缓存目录: " + dir);
            File dex = new File(dir, "signer.dex");
            // assets 里存的是 .bin（厂商安装扫描对 APK 内的 dex 文件敏感），运行时落到 cache 再当 dex 用
            byte[] want = readAssetGz("apksig/signer.bin.gz");
            if (want == null) throw new IOException("缺 assets/apksig/signer.bin.gz");
            if (!dex.isFile() || dex.length() != want.length) writeBytes(dex, want);
            // Android 14（API 34）起禁止动态加载可写 dex：写完立刻改只读（旧的可写文件也补一刀）
            if (dex.canWrite()) {
                if (!dex.setReadOnly()) {
                    try {
                        Runtime.getRuntime().exec(new String[] { "chmod", "444", dex.getAbsolutePath() }).waitFor();
                    } catch (Throwable ignored) {}
                }
            }
            if (dex.canWrite()) throw new IOException("dex 文件无法设为只读（Android 14+ 要求）: " + dex.getAbsolutePath());
            File oat = new File(dir, "oat");
            if (!oat.isDirectory()) oat.mkdirs();
            dalvik.system.DexClassLoader cl = new dalvik.system.DexClassLoader(
                    dex.getAbsolutePath(), oat.getAbsolutePath(), null, ctx.getClassLoader());
            Class<?> c = Class.forName("com.jiji.axv.sign.SigningBridge", true, cl);
            java.lang.reflect.Method m = c.getMethod("sign", String.class, String.class, String.class,
                    String.class, String.class, String.class, int.class);
            Object r = m.invoke(null, inApk.getAbsolutePath(), outApk.getAbsolutePath(), ksPath,
                    storePass, alias, keyPass, Integer.valueOf(24));
            return String.valueOf(r);
        } catch (Throwable t) {
            Throwable cause = t.getCause() == null ? t : t.getCause();
            String msg = cause.getMessage();
            return "err:" + (msg == null ? cause.getClass().getSimpleName() : msg);
        }
    }
    // ===== 工具方法 =====

    private File defaultOutDir() {
        // 和 MainActivity.defaultDir() 保持一致：外部存储 /AndroidUIIDE/Project/build
        java.io.File ext = android.os.Environment.getExternalStorageDirectory();
        File d = new File(ext, "AndroidUIIDE/Project/build");
        return d;
    }

    private static int runAapt2(File bin, File cwd, String[] args, StringBuilder log) throws Exception {
        ProcessBuilder pb = new ProcessBuilder();
        pb.command().add(bin.getAbsolutePath());
        for (String a : args) pb.command().add(a);
        pb.directory(cwd);
        pb.redirectErrorStream(true);
        Process pr = pb.start();
        byte[] out = readAll(pr.getInputStream());
        int code = pr.waitFor();
        log.append("$ aapt2 ").append(args[0]).append(" exit=").append(code).append('\n')
                .append(new String(out, StandardCharsets.UTF_8).substring(0, Math.min(800, out.length))).append('\n');
        return code;
    }

    private File frameworkResForLink(File root, StringBuilder log) {
        // 优先用 APK 内的 framework-res-stub
        File stub = new File(ctx.getCacheDir(), "fw/framework-res-stub.apk");
        if (!stub.isFile()) {
            byte[] gz = readAssetGz("fw/framework-res-stub.apk.gz");
            if (gz != null) {
                File dir = new File(ctx.getCacheDir(), "fw");
                if (!dir.isDirectory() && !dir.mkdirs()) { /* ignore */ }
                try { writeBytes(stub, unGzip(gz)); } catch (IOException ignored) { }
            }
        }
        if (stub.isFile()) {
            log.append("framework-res：用 APK 内桩（").append(stub.length()).append(" 字节）\n");
            return stub;
        }
        log.append("framework-res：退回系统框架包\n");
        return new File("/system/framework/framework-res.apk");
    }

    private void dumpLayoutHeads(File resDir, StringBuilder log) {
        // 诊断：aapt2 compile 失败时打印 layout 文件头
    }

    private static String jsonFail(String step, StringBuilder log) {
        return "{\"ok\":false,\"step\":" + JSONObject.quote(step) + ",\"log\":" + JSONObject.quote(log.toString()) + "}";
    }

    /** M221：编译缓存指纹。sha1(排序后的 java 源码 path+content + 排序后的资源文件 path)。
     *  资源只取路径：R.java 字段由资源名/类型决定，内容字节不影响 id。 */
    private static String compileFingerprint(JSONArray javaSources, JSONArray resFiles) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            java.util.List<String> js = new java.util.ArrayList<>();
            if (javaSources != null) {
                for (int i = 0; i < javaSources.length(); i++) {
                    JSONObject j = javaSources.getJSONObject(i);
                    js.add(j.optString("path", "") + "\u0001" + j.optString("code", ""));
                }
            }
            java.util.Collections.sort(js);
            for (String s : js) md.update(s.getBytes(StandardCharsets.UTF_8));
            java.util.List<String> rs = new java.util.ArrayList<>();
            if (resFiles != null) {
                for (int i = 0; i < resFiles.length(); i++) {
                    rs.add(resFiles.getJSONObject(i).optString("path", ""));
                }
            }
            java.util.Collections.sort(rs);
            for (String s : rs) md.update(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Throwable t) {
            return "nocache";
        }
    }

    /** M221b：只留 mtime 最新的 keep 个 .d（.tmp 垃圾一并清） */
    private static void pruneDexCache(File cacheDir, int keep) {
        File[] fs = cacheDir.listFiles();
        if (fs == null || fs.length <= keep) return;
        java.util.List<File> ds = new java.util.ArrayList<>();
        for (File f : fs) {
            String n = f.getName();
            if (n.endsWith(".tmp")) { f.delete(); continue; }
            if (n.endsWith(".d")) ds.add(f);
        }
        if (ds.size() <= keep) return;
        java.util.Collections.sort(ds, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = keep; i < ds.size(); i++) ds.get(i).delete();
    }

    private static java.util.List<byte[]> readDexCache(File cacheFile) {
        if (cacheFile == null || !cacheFile.isFile()) return null;
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(cacheFile)))) {
            int n = in.readInt();
            if (n <= 0 || n > 16) return null;
            java.util.List<byte[]> out = new java.util.ArrayList<>();
            long total = 0;
            for (int i = 0; i < n; i++) {
                int len = in.readInt();
                if (len < 8 || len > 12 * 1024 * 1024) return null;
                total += len;
                if (total > 40L * 1024 * 1024) return null;
                byte[] data = new byte[len];
                in.readFully(data);
                if (data[0] != 'd' || data[1] != 'e' || data[2] != 'x') return null;
                out.add(data);
            }
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    /** M221：写编译缓存（护栏口径与注入 extraDex 一致；先写 .tmp 再改名，避免半截文件） */
    private static void writeDexCache(File cacheFile, File[] dexFiles) {
        if (cacheFile == null) return;
        java.util.List<byte[]> picked = new java.util.ArrayList<>();
        long total = 0;
        if (dexFiles != null) {
            for (File df : dexFiles) {
                if (df == null || !df.isFile()) continue;
                if (!df.getName().matches("classes\\d*\\.dex")) continue;
                byte[] data = readFile(df);
                if (data == null || data.length < 8 || data.length > 12 * 1024 * 1024) continue;
                if (data[0] != 'd' || data[1] != 'e' || data[2] != 'x') continue;
                if (total + data.length > 40L * 1024 * 1024) break;
                picked.add(data);
                total += data.length;
            }
        }
        if (picked.isEmpty()) return;
        File tmp = new File(cacheFile.getParentFile(), cacheFile.getName() + ".tmp");
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tmp)))) {
            out.writeInt(picked.size());
            for (byte[] data : picked) {
                out.writeInt(data.length);
                out.write(data);
            }
            out.flush();
        } catch (Throwable t) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(cacheFile)) {
            tmp.delete();
            try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(cacheFile)))) {
                out.writeInt(picked.size());
                for (byte[] data : picked) { out.writeInt(data.length); out.write(data); }
                out.flush();
            } catch (Throwable ignored) { }
        }
    }

    private static void walkJava(File dir, java.util.List<String> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) walkJava(f, out);
            else if (f.getName().endsWith(".java")) out.add(f.getAbsolutePath());
        }
    }

    private static void walkClass(File dir, java.util.List<String> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) walkClass(f, out);
            else if (f.getName().endsWith(".class")) out.add(f.getAbsolutePath());
        }
    }

    private static byte[] readFile(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } catch (IOException e) {
            return new byte[0];
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) deleteTree(c);
        }
        f.delete();
    }

    private static void writeUtf8(File f, String text) throws IOException {
        f.getParentFile().mkdirs();
        try (FileOutputStream fos = new FileOutputStream(f);
             OutputStreamWriter osw = new OutputStreamWriter(fos, StandardCharsets.UTF_8)) {
            osw.write(text);
        }
    }

    private static void writeBytes(File f, byte[] data) throws IOException {
        f.getParentFile().mkdirs();
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(data);
        }
    }

    private byte[] readAssetGz(String name) {
        try {
            byte[] gz = readAssetBytes(ctx.getAssets().open(name));
            return unGzip(gz);
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readAssetBytes(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return bos.toByteArray();
    }

    private static byte[] unGzip(byte[] gz) {
        if (gz == null || gz.length < 2) return gz;
        try {
            GZIPInputStream gis = new GZIPInputStream(new ByteArrayInputStream(gz));
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = gis.read(buf)) > 0) bos.write(buf, 0, n);
            gis.close();
            return bos.toByteArray();
        } catch (Exception e) {
            return gz;
        }
    }

    private static boolean canReallyOpen(File f) {
        return f != null && f.canRead();
    }

    private static String quote(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    private static String xmlAttr(String s) {
        return (s == null ? "" : s).replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** M227：校验 cache/compiler 下的文件。manifest 记录的是**解压后**路径+大小+sha256。
     *  有 manifest → 逐个比；没有 → 只查 tool1。任一不对 → 抛带文件名的 IOException。 */
    private void validateCompiler(File dir, String toolBreakReason, int toolCountExtracted) throws IOException {
        java.util.List<String[]> manifest = readCompilerManifest();
        if (manifest != null) {
            java.util.List<String> problems = new java.util.ArrayList<>();
            for (String[] e : manifest) {
                String name = e[0], wantSha = e[1], wantSizeStr = e[2], role = e[3];
                File local = new File(dir, name);
                boolean optional = "i18n".equals(role); // msgs/res 缺失不致命（M219）
                if (!local.exists()) {
                    if (optional) continue;
                    problems.add(name + "（" + role + "）缺失");
                    continue;
                }
                if (local.isDirectory()) { if (optional) continue; problems.add(name + "（" + role + "）应为文件但是目录"); continue; }
                long wantSize;
                try { wantSize = Long.parseLong(wantSizeStr); } catch (Throwable t) { wantSize = -1; }
                if (wantSize > 0 && local.length() != wantSize) {
                    problems.add(name + "（" + role + "）大小不符（期望 " + wantSize + " 实际 " + local.length() + "），可能截断");
                    continue;
                }
                if (wantSha.length() == 64) {
                    String got = sha256Hex(local);
                    if (got != null && !got.equalsIgnoreCase(wantSha)) problems.add(name + "（" + role + "）sha256 不符，文件已损坏");
                }
            }
            if (!problems.isEmpty()) {
                throw new IOException("编译器资源不完整（" + problems.size() + " 处）：" + String.join("；", problems)
                        + (toolBreakReason != null ? "；" + toolBreakReason : ""));
            }
        } else {
            File t1 = new File(dir, "tool1.bin");
            if (!t1.isFile() || t1.length() == 0) {
                throw new IOException((toolBreakReason != null ? toolBreakReason : "没找到编译器 dex（tool1.bin）")
                        + "（APK 缺 compiler 资源或旧版无 manifest，请装新版）");
            }
        }
    }

    /** 读 assets/compiler/manifest.json → [[path, sha256, size, role], …]，没有则 null */
    private java.util.List<String[]> readCompilerManifest() {
        try (InputStream in = ctx.getAssets().open("compiler/manifest.json")) {
            String text = new String(readAssetBytes(in), StandardCharsets.UTF_8);
            JSONObject o = new JSONObject(text);
            JSONArray fs = o.optJSONArray("files");
            if (fs == null) return null;
            java.util.List<String[]> out = new java.util.ArrayList<>();
            for (int i = 0; i < fs.length(); i++) {
                JSONObject f = fs.getJSONObject(i);
                out.add(new String[] { f.optString("path", ""), f.optString("sha256", ""),
                        String.valueOf(f.optLong("size", 0)), f.optString("role", "") });
            }
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    /** M227：sha256（hex 小写），读失败 → null（调用方按「无法校验」处理） */
    private static String sha256Hex(File f) {
        try {
            byte[] data = readFile(f);
            if (data == null) return null;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            StringBuilder sb = new StringBuilder();
            for (byte x : md.digest(data)) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    /** 把 zip（可能是 gzip 过的 zip）解到目录，条目路径做 ../ 防护 */
    private static void unzipToDir(byte[] data, File destDir) throws IOException {
        if (data == null || data.length == 0) return;
        byte[] zip = data;
        if (data.length >= 2 && data[0] == (byte) 0x1f && data[1] == (byte) 0x8b) zip = unGzip(data);
        java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip));
        try {
            java.util.zip.ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                File out = new File(destDir, e.getName());
                String canon = out.getCanonicalPath();
                if (!canon.startsWith(destDir.getCanonicalPath() + File.separator) && !canon.equals(destDir.getCanonicalPath())) {
                    zis.closeEntry();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = zis.read(buf)) > 0) fos.write(buf, 0, n);
                }
                zis.closeEntry();
            }
        } finally {
            try { zis.close(); } catch (Throwable ignored) { }
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }
}
