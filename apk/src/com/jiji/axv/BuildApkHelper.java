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
        d8Method.invoke(null, d8Args.toArray(new String[0]), d8Log);
        log.append("D8: ").append(String.join("\n", d8Log)).append("\n");
        File[] dexFiles = dexDir.listFiles();
        java.util.Arrays.sort(dexFiles, (a, b) -> a.getName().compareTo(b.getName()));
        int n = 0;
        if (dexFiles != null) {
            for (File df : dexFiles) {
                if (!df.getName().matches("classes\\d*\\.dex")) continue;
                byte[] data = readFile(df);
                if (data.length < 8 || data.length > 12 * 1024 * 1024) continue;
                if (data[0] != 'd' || data[1] != 'e' || data[2] != 'x') continue;
                extraDex.add(data);
                n++;
            }
        }
        log.append("设备端编译成功，注入 ").append(n).append(" 个 dex（").append(
                extraDex.stream().mapToLong(d -> d.length).sum() / 1024).append(" KB）\n");
        if (n > 0) writeDexCache(cacheFile, dexFiles);
        return "java:" + n;
    }

    // ===== 编译器管理 =====

    private File ensureCompiler() throws IOException {
        File dir = new File(ctx.getCacheDir(), "compiler");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("建不了 compiler 缓存目录");
        String manifestJson;
        try (InputStream in = ctx.getAssets().open("compiler/manifest.json")) {
            manifestJson = new String(readAssetBytes(in), StandardCharsets.UTF_8);
        } catch (IOException e) {
            manifestJson = null;
        }
        if (manifestJson == null) {
            throw new IOException("没找到 compiler/manifest.json（旧包没有 manifest：至少保证有 tool dex）");
        }
        try { new JSONObject(manifestJson); } catch (org.json.JSONException ignored) { }
        JSONObject mf = null;
        String wantSha = mf.optString("sha256", "");
        String toolBreakReason = null;
        int toolCountExtracted = 0;
        for (int i = 1; i <= 2; i++) {
            String key = "tool" + i + ".bin.gz";
            byte[] gz = readAssetGz("compiler/" + key);
            if (gz == null) {
                toolBreakReason = "缺 " + key;
                break;
            }
            byte[] raw = unGzip(gz);
            if (raw.length < 8) { toolBreakReason = key + " 解压后太小"; break; }
            File f = new File(dir, "tool" + i + ".bin");
            writeBytes(f, raw);
            toolCountExtracted++;
        }
        if (toolBreakReason != null) throw new IOException(toolBreakReason + "（APK 缺 compiler 资源或旧版无 manifest）");
        byte[] androidGz = readAssetGz("compiler/android.jar.gz");
        if (androidGz != null) {
            writeBytes(new File(dir, "android.jar"), unGzip(androidGz));
        }
        byte[] msgsGz = readAssetGz("compiler/msgs.bin.gz");
        if (msgsGz != null) {
            writeBytes(new File(dir, "msgs.bin"), unGzip(msgsGz));
        }
        validateCompiler(dir, toolBreakReason, toolCountExtracted);
        return dir;
    }

    private java.lang.ClassLoader compilerLoader(File compDir) throws IOException {
        java.util.List<byte[]> els = new java.util.ArrayList<>();
        for (int i = 1; i <= 2; i++) {
            File tool = new File(compDir, "tool" + i + ".bin");
            if (!tool.isFile()) continue;
            els.add(readFile(tool));
        }
        if (els.isEmpty()) throw new IOException("没找到编译器 dex（tool*.bin）");
        File msgDir = new File(compDir, "msgs");
        byte[] msgs = null;
        File msgFile = new File(compDir, "msgs.bin");
        if (msgFile.isFile()) msgs = readFile(msgFile);
        if (msgs != null) {
            File msgDest = new File(msgDir, "batchmessages.properties");
            if (!msgDest.isFile() || msgDest.length() != msgs.length) {
                msgDir.mkdirs();
                writeBytes(msgDest, msgs);
            }
        }
        return new ResClassLoader(els, msgDir);
    }

    static class ResClassLoader extends java.lang.ClassLoader {
        private final File root;
        ResClassLoader(java.util.List<byte[]> dexBlobs, File resRoot) {
            super(ResClassLoader.class.getClassLoader());
            this.root = resRoot;
            loadAll(dexBlobs);
        }
        private void loadAll(java.util.List<byte[]> blobs) {
            for (byte[] b : blobs) defineClass(null, b, 0, b.length);
        }
        @Override
        protected Class<?> findClass(String name) {
            byte[] b = findClassBytes(name);
            if (b == null) return null;
            return defineClass(name, b, 0, b.length);
        }
        private byte[] findClassBytes(String name) {
            return null;
        }
    }

    // ===== 签名 =====

    /** M240：repack 也用得到，提成 public 供 MainActivity 委托 */
    public String signWithApksig(File inApk, File outApk, String ksPath, String storePass, String alias, String keyPass) {
        File dir = new File(ctx.getCacheDir(), "apksig");
        if (!dir.isDirectory() && !dir.mkdirs()) return "err:建不了 apksig 目录";
        File dex = new File(dir, "signer.dex");
        byte[] want = readAssetGz("apksig/signer.bin.gz");
        if (want == null) return "err:缺 apksig/signer.bin.gz";
        if (!dex.isFile() || dex.length() != want.length) {
            try { writeBytes(dex, want); } catch (IOException ex) { return "err:write dex failed"; }
        }
        if (Build.VERSION.SDK_INT >= 34) {
            if (dex.canWrite()) {
                if (!dex.setReadOnly()) {
                    Process ch = null;
                    try {
                        ch = Runtime.getRuntime().exec(new String[] { "chmod", "444", dex.getAbsolutePath() });
                        ch.waitFor();
                    } catch (Exception ignored) {
                    }
                }
                if (dex.canWrite()) return "err:dex 文件无法设为只读（Android 14+ 要求）: " + dex.getAbsolutePath();
            }
        }
        File oat = new File(dir, "oat");
        java.lang.ClassLoader cl;
        try {
            cl = new DexClassLoader2(dex.getAbsolutePath(), oat.getAbsolutePath(), null, ctx.getClassLoader());
        } catch (Throwable t) {
            return "err:加载 apksig 失败：" + t.getMessage();
        }
        try {
            Class<?> sb = cl.loadClass("com.jiji.axv.sign.SigningBridge");
            Object inst = sb.getConstructor().newInstance();
            java.lang.reflect.Method m = sb.getMethod("sign", File.class, File.class, String.class, String.class, String.class, String.class, boolean.class, boolean.class, boolean.class);
            String r = String.valueOf(m.invoke(inst, inApk, outApk, ksPath, storePass, alias, keyPass, true, true, true));
            return r;
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    // DexClassLoader 的简单封装（避免直接 import dalvik）
    private static class DexClassLoader2 extends java.lang.ClassLoader {
        DexClassLoader2(String dexPath, String oatDir, String libDir, ClassLoader parent) {
            super(parent);
            try {
                Class<?> cl = Class.forName("dalvik.system.BaseDexClassLoader");
                java.lang.reflect.Constructor<?> ctor = cl.getConstructor(String.class, String.class, String.class, ClassLoader.class);
                Object inst = ctor.newInstance(dexPath, oatDir, libDir, parent);
                // 把 parent 的已加载类委托给自己
            } catch (Exception ignored) {
            }
        }
        @Override
        protected Class<?> findClass(String name) {
            return null;
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

    private static String compileFingerprint(JSONArray javaSources, JSONArray resFiles) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (int i = 0; i < javaSources.length(); i++) {
                JSONObject j = javaSources.getJSONObject(i);
                md.update(j.optString("path", "").getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0);
                md.update(j.optString("code", "").getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0);
            }
            if (resFiles != null) {
                for (int i = 0; i < resFiles.length(); i++) {
                    JSONObject f = resFiles.getJSONObject(i);
                    md.update(f.optString("path", "").getBytes(StandardCharsets.UTF_8));
                    md.update((byte) 0);
                }
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "fallback_" + System.nanoTime();
        }
    }

    private static void pruneDexCache(File cacheDir, int keep) {
        File[] files = cacheDir.listFiles((d, n) -> n.endsWith(".d"));
        if (files == null || files.length <= keep) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = keep; i < files.length; i++) files[i].delete();
    }

    private static java.util.List<byte[]> readDexCache(File cacheFile) {
        if (!cacheFile.isFile()) return null;
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(cacheFile)))) {
            int n = in.readInt();
            if (n <= 0 || n > 16) return null;
            java.util.List<byte[]> out = new java.util.ArrayList<>();
            for (int i = 0; i < n; i++) {
                int len = in.readInt();
                if (len < 8 || len > 12 * 1024 * 1024) return null;
                byte[] data = new byte[len];
                in.readFully(data);
                out.add(data);
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeDexCache(File cacheFile, File[] dexFiles) {
        if (dexFiles == null) return;
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(cacheFile)))) {
            out.writeInt(dexFiles.length);
            for (File df : dexFiles) {
                if (!df.getName().matches("classes\\d*\\.dex")) continue;
                byte[] data = readFile(df);
                if (data.length < 8 || data.length > 12 * 1024 * 1024) continue;
                out.writeInt(data.length);
                out.write(data);
            }
        } catch (Exception ignored) {
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

    private boolean validateCompiler(File dir, String toolBreakReason, int toolCountExtracted) {
        // 校验 tool dex 魔数 + android.jar 大小
        for (int i = 1; i <= toolCountExtracted; i++) {
            File tool = new File(dir, "tool" + i + ".bin");
            if (!tool.isFile() || tool.length() < 8) return false;
            try {
                byte[] head = new byte[3];
                try (FileInputStream in = new FileInputStream(tool)) {
                    in.read(head);
                }
                if (head[0] != 'd' || head[1] != 'e' || head[2] != 'x') return false;
            } catch (IOException ignored) {
                return false;
            }
        }
        File aj = new File(dir, "android.jar");
        if (aj.isFile() && aj.length() < 1024 * 1024) return false;
        return true;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }
}
