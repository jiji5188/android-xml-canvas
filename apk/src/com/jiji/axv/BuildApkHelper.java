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

    /** M298：调试包默认签名（放在 /AndroidUIIDE/ 下，没有就自动生成） */
    private static final String DEBUG_KESTORE_NAME = "axv-debug.keystore";
    private static final String DEBUG_ALIAS = "androiddebugkey";
    private static final String DEBUG_STORE_PASS = "android";

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
            JSONArray libs = p.optJSONArray("libs");
            String launchActivity = p.optString("launchActivity", "");
            String manifestText = p.optString("manifestText", "");
            // M286：JS 侧已把 provider 节点插进项目清单；只有合成清单的分支才需要 Java 侧再插一次
            boolean axvLog = p.optBoolean("axvLog", false);
            String ksPath = p.optString("keystore", "");
            String storePass = p.optString("storePass", "");
            String alias = p.optString("alias", "");
            String keyPass = p.optString("keyPass", "");
            JSONArray files = p.optJSONArray("files");

            if (!pkg.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*")) {
                return "{\"ok\":false,\"step\":\"pkg\",\"log\":\"包名不合法: " + pkg.replace("\"", "") + "\"}";
            }
            if (ksPath.isEmpty() || !new File(ksPath).isFile()) {
                // M298：调试包不再要求用户先生成 keystore —— 自动用 /AndroidUIIDE/axv-debug.keystore
                // （没有就现场生成）。发布包（JS 侧传了 keystore）保持原校验。
                File dbg = ensureDebugKeystore(log);
                if (dbg == null) {
                    return "{\"ok\":false,\"step\":\"keystore\",\"log\":\"没有可用的调试签名，且自动生成失败（看构建日志）。请在签名弹层里指定 keystore\"}";
                }
                ksPath = dbg.getAbsolutePath();
                storePass = DEBUG_STORE_PASS;
                alias = DEBUG_ALIAS;
                keyPass = DEBUG_STORE_PASS;
                log.append("使用调试签名：").append(ksPath).append('\n');
            }
            if (files == null || files.length() == 0) {
                return "{\"ok\":false,\"step\":\"files\",\"log\":\"没有资源文件\"}";
            }

            step = "write";
            File root = new File(ctx.getCacheDir(), "buildapk");
            deleteTree(root);
            File resDir = new File(root, "res");
            if (!resDir.mkdirs()) throw new IOException("mkdirs 失败: " + resDir);

            // M354：appcompat / material aar 自带全套 attr/style（colorAccent/Theme.AppCompat…），
            // 无条件生成的 axv_attrs.xml / axv_stub.xml 桩会与 aar overlay 撞名 → aapt2 link exit=1。
            // 检测到这类 aar 就跳过这两个桩文件（允许 aapt2 出一批 without-required-default 警告，不阻断）。
            boolean hasCompatLib = false;
            if (libs != null) {
                for (int k = 0; k < libs.length(); k++) {
                    JSONObject lj = libs.optJSONObject(k);
                    if (lj == null) continue;
                    String lp = lj.optString("path", "").toLowerCase();
                    if (lp.contains("appcompat") || lp.contains("material")) {
                        hasCompatLib = true;
                        break;
                    }
                }
            }
            if (hasCompatLib) {
                log.append("检测到 AppCompat/Material aar → 跳过 axv_attrs.xml/axv_stub.xml 桩（避免与 aar 撞名，允许无默认值警告）\n");
            }

            int written = 0;
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String path = f.optString("path", "");
                String text = f.optString("text", "");
                String b64 = f.optString("base64", "");
                if (path.isEmpty()) continue;
                if (path.startsWith("/") || path.contains("..")) continue;
                if (hasCompatLib && (path.equals("values/axv_attrs.xml") || path.equals("values/axv_stub.xml"))) {
                    continue; // M354：有 appcompat 时不写这两个桩，让 aar 的权威定义生效
                }
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

            // M416：所有 aar 的 res 合并到同一目录树（values XML 拼接，其它覆盖），
            //  解决 aapt2 link「conflicting value for configuration」（两个 aar 都声明同名 styleable）。
            //  旧 M350 的独立 overlay 方案在 appcompat + material 同存时撞 styleable 结构冲突。
            File aarMerged = mergeAarResTree(libs, root, log);

            File man = new File(root, "AndroidManifest.xml");
            // M262：优先用项目里的 AndroidManifest.xml 原文（aapt2 link 会直接读它，不再合成只含 ShellActivity 的清单）。
            // M263：项目清单缺 package 属性时自动补上（aapt2 正规清单必需，否则报 warning/error）。
            // 项目没清单 / 没把 manifestText 传过来 → 退回合成清单（老行为，布局壳还能跑）。
            String manContent;
            if (manifestText == null || manifestText.trim().isEmpty()) {
                manContent = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
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
                        + "</manifest>\n";
                manContent = ensureManifestPkg(manContent, pkg, log);
                // M286：合成清单分支里把运行日志 provider 也挂上（JS 侧对已有清单已插过，不会重复）
                if (axvLog) {
                    String prov =
                            "    <provider\n"
                                    + "        android:name=\"" + pkg + ".axvlog.AxvLogProvider\"\n"
                                    + "        android:authorities=\"" + pkg + ".axvlog.provider\"\n"
                                    + "        android:exported=\"false\"\n"
                                    + "        android:initOrder=\"1000\" />\n";
                    int appEnd = manContent.lastIndexOf("</application>");
                    if (appEnd > 0) {
                        manContent = manContent.substring(0, appEnd) + prov + manContent.substring(appEnd);
                    }
                    log.append("已注入 AXV 运行日志抽屉（provider 挂到合成清单）\n");
                }
            } else {
                // 项目清单没有 MAIN/LAUNCHER 时，把 ShellActivity 注进去兜底（老行为），否则装完没有图标/打不开
                String content = manifestText;
                boolean hasLauncher =
                        content.contains("android.intent.action.MAIN") &&
                                content.contains("android.intent.category.LAUNCHER");
                if (!hasLauncher) {
                    String shellBlock =
                            "    <activity android:name=\"com.jiji.axv.shell.ShellActivity\" android:exported=\"true\">\n"
                                    + "      <meta-data android:name=\"axv.layout\" android:value=\"" + xmlAttr(layout) + "\" />\n"
                                    + "      <meta-data android:name=\"axv.launcher\" android:value=\"" + xmlAttr(launchActivity) + "\" />\n"
                                    + "      <intent-filter>\n"
                                    + "        <action android:name=\"android.intent.action.MAIN\" />\n"
                                    + "        <category android:name=\"android.intent.category.LAUNCHER\" />\n"
                                    + "      </intent-filter>\n"
                                    + "    </activity>\n";
                    int appIdx = content.lastIndexOf("</application>");
                    if (appIdx > 0) {
                        content = content.substring(0, appIdx) + shellBlock + content.substring(appIdx);
                    } else {
                        int manIdx = content.lastIndexOf("</manifest>");
                        if (manIdx > 0) {
                            content = content.substring(0, manIdx) + shellBlock + content.substring(manIdx);
                        }
                    }
                }
                manContent = ensureManifestPkg(content, pkg, log);
            }
            writeUtf8(man, manContent);
            log.append("使用 AndroidManifest.xml（").append(manContent.length()).append(" 字符）\n");

            step = "aapt2";
            File bin = new File(ctx.getApplicationInfo().nativeLibraryDir, "libaapt2.so");
            if (!bin.isFile()) throw new IOException("找不到 aapt2：" + bin);
            File fw = frameworkResForLink(root, log);
            File compiled = new File(root, "compiled.zip");
            File genDir = new File(root, "gen");
            File customPkg = new File(root, ".pkg");
            writeUtf8(customPkg, pkg + "\n");
            logStage(log, "资源编译（aapt2 compile）");
            int c1 = runAapt2(bin, root, new String[] { "compile", "--dir", resDir.getAbsolutePath(),
                    "-o", compiled.getAbsolutePath() }, log);
            if (c1 != 0) {
                dumpLayoutHeads(resDir, log);
                return jsonFail("compile", log);
            }
            // M416：aar 合并目录单独 compile 成一个 overlay zip（不再各自独立）
            File aarCompiledZip = null;
            if (aarMerged != null) {
                aarCompiledZip = new File(root, "compiled_aar_mrg.zip");
                int ca = runAapt2(bin, root, new String[] { "compile", "--dir", aarMerged.getAbsolutePath(),
                        "-o", aarCompiledZip.getAbsolutePath() }, log);
                if (ca != 0) {
                    log.append("aar 合并资源编译失败（").append(ca).append("）\n");
                    return jsonFail("compile", log);
                }
            }
            logStage(log, "资源链接（aapt2 link）");
            File unsigned = new File(root, "unsigned.apk");
            java.util.List<String> linkArgs = new java.util.ArrayList<>();
            linkArgs.add("link");
            linkArgs.add("-o"); linkArgs.add(unsigned.getAbsolutePath());
            linkArgs.add("-I"); linkArgs.add(fw.getAbsolutePath());
            linkArgs.add("--manifest"); linkArgs.add(man.getAbsolutePath());
            linkArgs.add("--min-sdk-version"); linkArgs.add("24");
            linkArgs.add("--target-sdk-version"); linkArgs.add("34");
            linkArgs.add("--auto-add-overlay");
            linkArgs.add("--java"); linkArgs.add(genDir.getAbsolutePath());
            linkArgs.add("--custom-package"); linkArgs.add(pkg);
            linkArgs.add(compiled.getAbsolutePath());
            if (aarCompiledZip != null) linkArgs.add(aarCompiledZip.getAbsolutePath());
            int c2 = runAapt2(bin, root, linkArgs.toArray(new String[0]), log);
            if (c2 != 0) return jsonFail("link", log);
            if (!unsigned.isFile()) return jsonFail("link", log);

            // M272：项目可能多个包都引用 R（改包名改一半 / 反编译工程多包共存）。
            // aapt2 只生成 --custom-package 对应的那一个 R.java → 其余包 import xxx.R 全报错。
            // 按客户端给的 rPackages，把生成的 R.java 复制到每个包（内容相同，只改 package 行）。
            JSONArray rPkgs = p.optJSONArray("rPackages");
            if (rPkgs != null && rPkgs.length() > 0) {
                java.util.List<String> genR = new java.util.ArrayList<>();
                walkJava(genDir, genR);
                String rText = null;
                for (String rp : genR) {
                    if (rp.endsWith("/R.java") || rp.endsWith("\\R.java")) {
                        rText = readUtf8(new File(rp));
                        break;
                    }
                }
                if (rText != null) {
                    int made = 0;
                    for (int i = 0; i < rPkgs.length(); i++) {
                        String ep = rPkgs.optString(i, "");
                        if (ep == null || ep.isEmpty() || ep.equals(pkg)) continue;
                        String body = rText.replaceFirst("(?m)^package\\s+[\\w.]+\\s*;", "package " + ep + ";");
                        File dst = new File(genDir, ep.replace('.', '/') + "/R.java");
                        File parent = dst.getParentFile();
                        if (parent != null) parent.mkdirs();
                        writeUtf8(dst, body);
                        made++;
                    }
                    if (made > 0) log.append("R.java 复制到 ").append(made).append(" 个额外包（多包引用 R）\n");
                }
            }

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
            // M267：androidx 插件包（assets/androidx/）→ 解压到 cache，拼进 ECJ classpath
            logStage(log, "androidx 插件包");
            List<String> androidxJars = ensureAndroidx(root, log);
            log.append("androidx 插件包 ").append(androidxJars.size()).append(" 个 class\n");
            String compileMode;
            try {
                compileMode = compileProjectJava(javaSources, root, genDir, log, extraDex, files, libs, androidxJars, pkg);
            } catch (IOException ce) {
                final String cm2 = ce.getMessage() == null ? "" : ce.getMessage();
                appendResMissLog(log);
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
            appendResMissLog(log);

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
            if (ksPath.isEmpty() || !new File(ksPath).isFile()) {
                File dbg = ensureDebugKeystore(log);
                if (dbg == null) return "err:keystore:没有可用的调试签名，且自动生成失败";
                ksPath = dbg.getAbsolutePath();
                storePass = DEBUG_STORE_PASS;
                alias = DEBUG_ALIAS;
                keyPass = DEBUG_STORE_PASS;
            }

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

    /** M405：debug 运行 —— 把项目 Java 编译成 dex 字节（不打包/不签名/不装包）。
     *  payload 与 buildInstallApk 同构（javaSources / libs / rPackages / pkg），但只走到「dex 字节」。
     *  返回 { ok, dex: [base64…], classes, log }；供 DebugRunHelper 动态加载后反射跑 main/debug。
     *  R.java 由调用方（JS）生成好塞进 javaSources（path 以 R.java 结尾），这里不再跑 aapt2。
     */
    public String compileToDex(String payloadJson) {
        StringBuilder log = new StringBuilder();
        String step = "init";
        try {
            JSONObject p = new JSONObject(payloadJson);
            String pkg = p.optString("pkg", "com.axv.app");
            JSONArray javaSources = p.optJSONArray("javaSources");
            JSONArray libs = p.optJSONArray("libs");
            if (javaSources == null || javaSources.length() == 0) {
                return "{\"ok\":false,\"step\":\"sources\",\"log\":\"没有 Java 源码可编译\"}";
            }
            step = "compile";
            File root = new File(ctx.getCacheDir(), "debugrun");
            deleteTree(root);
            if (!root.mkdirs()) throw new IOException("建不了 debugrun 目录");
            // 同 build 的 androidx 插件包（assets/androidx/ → cache，拼 ECJ classpath）
            List<String> androidxJars = ensureAndroidx(root, log);
            log.append("debugrun: androidx 插件包 ").append(androidxJars.size()).append(" 个\n");
            java.util.List<byte[]> extraDex = new java.util.ArrayList<>();
            String cm = compileProjectJava(javaSources, root, null, log, extraDex, null, libs, androidxJars, pkg);
            if (!cm.startsWith("java:")) {
                return "{\"ok\":false,\"step\":\"compile\",\"log\":" + quote(cm) + "}";
            }
            // 把 dex 字节拼成一个 JSON（base64 数组）回给 JS，避免大 payload 走 JNI 同步返回超限
            JSONArray arr = new JSONArray();
            int total = 0;
            for (int i = 0; i < extraDex.size(); i++) {
                byte[] d = extraDex.get(i);
                if (d == null || d.length == 0) continue;
                arr.put(android.util.Base64.encodeToString(d, android.util.Base64.NO_WRAP));
                total += d.length;
            }
            if (arr.length() == 0) {
                return "{\"ok\":false,\"step\":\"dex\",\"log\":\"编译未产出 dex（" + log + "）\"}";
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("step", "done");
            out.put("dex", arr);
            out.put("bytes", total);
            out.put("log", log.toString());
            return out.toString();
        } catch (Throwable t) {
            String m = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
            Log.e(TAG, "compileToDex fail", t);
            return "{\"ok\":false,\"step\":" + quote(step) + ",\"log\":" + quote(m + "\n" + log) + "}";
        }
    }

    private String compileProjectJava(JSONArray javaSources, File root, File genDir,
                                      StringBuilder log, java.util.List<byte[]> extraDex, JSONArray resFiles,
                                      JSONArray libs, List<String> androidxJars, String appPkg) throws Exception {
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
            // M254：格式 java:<classes>:<dex>——缓存命中时 class 数未知记 0（不是「没编译出东西」）
            return "java:0:" + cachedDex.size();
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
        // M278/P0-1：打印完整源码清单（文件名）+ 预检查（收到的 vs 实际落盘的），方便排查漏文件
        int written = files.size();
        int received = javaSources.length();
        if (written < received) {
            log.append("[预检查] 收到 ").append(received).append(" 个源码，实际落盘 ").append(written)
                    .append(" 个，").append(received - written).append(" 个被丢弃（路径含 .. 或为空），请核对项目源码\n");
        }
        StringBuilder fl = new StringBuilder();
        java.util.List<String> names = new java.util.ArrayList<>();
        for (File f : files) {
            String n = f.getName();
            if (!names.contains(n)) { names.add(n); if (fl.length() > 0) fl.append(' '); fl.append(n); }
        }
        log.append("  源码清单（").append(files.size()).append(" 个，去重 ").append(names.size()).append(" 名）：").append(fl.toString()).append("\n");
        File androidJar = new File(compDir, "android.jar");
        if (!androidJar.isFile() || androidJar.length() < 1024 * 1024) {
            throw new IOException("缺 android.jar（编译器资源没装齐，无法编译 Java）");
        }
        // M266：把项目自带的 libs/*.aar 里的 classes.jar 展开，加进 ECJ classpath（解决 androidx/jxl 等引用）
        java.util.List<String> libJars = new java.util.ArrayList<>();
        if (libs != null) {
            for (int i = 0; i < libs.length(); i++) {
                JSONObject lj = libs.optJSONObject(i);
                if (lj == null) continue;
                String libPath = lj.optString("path", "");
                byte[] libData = lj.optJSONArray("data") == null ? null : null;
                // 约定：libs 元素形如 {"path":"libs/bc.jar","base64":"..."} 或 {"path":"libs/androidx-core.aar"}
                String b64 = lj.optString("base64", "");
                if (libPath.isEmpty() || b64.isEmpty()) continue;
                try {
                    byte[] data = Base64.decode(b64, Base64.NO_WRAP);
                    if (data == null || data.length == 0) continue;
                    if (libPath.endsWith(".jar")) {
                        File jf = new File(root, "libs");
                        jf.mkdirs();
                        File dst = new File(jf, libPath.replace('/', java.io.File.separatorChar));
                        dst.getParentFile().mkdirs();
                        writeBytes(dst, data);
                        libJars.add(dst.getAbsolutePath());
                    } else if (libPath.endsWith(".aar")) {
                        // aar 是 zip，取 classes.jar 再展开/当 jar 用
                        File af = new File(root, "libs/aar");
                        af.mkdirs();
                        File dst = new File(af, libPath.substring(0, libPath.length() - 4) + ".aar");
                        writeBytes(dst, data);
                        File innerJar = extractClassesJar(dst, new File(af, libPath.substring(0, libPath.length() - 4) + "-classes.jar"));
                        if (innerJar != null) libJars.add(innerJar.getAbsolutePath());
                    }
                } catch (Throwable ignored) { }
            }
        }
        // 拼 classpath：android.jar + 项目 libs + androidx 插件包（M267）
        StringBuilder cp = new StringBuilder(androidJar.getAbsolutePath());
        for (String j : libJars) cp.append(File.pathSeparator).append(j);
        int androidxCount = 0;
        if (androidxJars != null) {
            for (String a : androidxJars) { cp.append(File.pathSeparator).append(a); androidxCount++; }
        }
        log.append("ECJ classpath：android.jar + ").append(libJars.size()).append(" 项目 libs + ")
                .append(androidxCount).append(" androidx\n");
        java.lang.ClassLoader cl = compilerLoader(compDir);
        Class<?> ecj = cl.loadClass("com.jiji.axv.compiler.EcjBridge");
        java.util.List<String> ecjLog = new java.util.ArrayList<>();
        // ⚠ M243（关键 bug）：以前这里只传选项、**没把源码文件加进去**！
        // ECJ 收到「无源码」→ 打印 usage 然后返回 true；D8 拿到 0 个 .class →
        // 最终显示「已编译 0 个 Java 类」并打出 31KB 的壳包。源码必须显式当参数传。
        java.util.List<String> ecjArgsList = new java.util.ArrayList<>();
        // M245：source/target 回到 11。真正的阻塞是 javax.lang.model.SourceVersion 在
        // Android 运行时缺失（M244 的降到 8 没绕开，ECJ 无条件 link 该类）；现在该桩类
        // 随 compiler dex 一起进 APK，11 可以正常用。
        java.util.Collections.addAll(ecjArgsList, "-source", "11", "-target", "11", "-nowarn",
                "-encoding", "UTF-8", "-classpath", cp.toString(),
                "-d", clsDir.getAbsolutePath());
        // M251：-proc:none 关注解处理器（APT）。ECJ 的 initializeAnnotationProcessorManager 会
        // 加载 javax.annotation.processing.* / javax.tools.*（JDK java.compiler 模块，Android 没有），
        // 报 NoClassDefFoundError: ProcessingEnvironment。我们的 Java 是布局胶水不用 APT，
        // 关掉绕开整组依赖；R.java 是我们自己生成的，不依赖 ECJ APT。
        // 注意：必须是单个 token「-proc:none」（拆开成 -proc / none 两个参数 ECJ 报 Unrecognized）。
        ecjArgsList.add("-proc:none");
        for (File f : files) ecjArgsList.add(f.getAbsolutePath());
        ecjArgsList.addAll(rFiles);
        String[] ecjArgs = ecjArgsList.toArray(new String[0]);
        log.append("ECJ 参数：源码 ").append(files.size()).append(" + R.java ").append(rFiles.size())
                .append("（共 ").append(ecjArgs.length).append(" 个参数）\n");
        logStage(log, "Java 编译（ECJ）");
        java.lang.reflect.Method ecjCompile = ecj.getMethod("compile", String[].class, java.util.List.class);
        boolean ecjOk = Boolean.valueOf((Boolean) ecjCompile.invoke(null, ecjArgs, ecjLog));
        if (!ecjOk || ecjLog.size() > 0) {
            log.append(fmtEcjLog(ecjLog, 60, androidxJars != null && !androidxJars.isEmpty(), appPkg));
        }
        if (!ecjOk) throw new IOException("Java 编译失败（看上面 ECJ 的报错行）—— 已中止打包，不会偷偷生成只显示布局的壳包");
        logStage(log, "dex 链接（D8）");
        File dexDir = new File(root, "jex");
        dexDir.mkdirs();
        java.util.List<String> classFiles = new java.util.ArrayList<>();
        walkClass(clsDir, classFiles);
        // ECJ 说成功但一个 class 都没出 → 参数/源码有问题，必须中止而不是静默出壳包
        if (classFiles.isEmpty()) {
            throw new IOException("ECJ 没产出任何 .class（源码进行了 " + files.size()
                    + " 个，请检查文件是否真的写到了 srcx/ 并带 .java 扩展名）");
        }
        log.append("ECJ 产出 ").append(classFiles.size()).append(" 个 .class\n");
        Class<?> d8 = cl.loadClass("com.jiji.axv.compiler.D8Bridge");
        java.util.List<String> d8Log = new java.util.ArrayList<>();
        java.util.List<String> d8Args = new java.util.ArrayList<>();
        d8Args.add("--release"); d8Args.add("--min-api"); d8Args.add("24");
        // M281：--lib 只能给「单个平台 jar」（android.jar）。以前把 cp.toString()（冒号串）
        // 整条塞给 --lib，R8 当成一个不存在的文件 → NoSuchFileException。修正：
        //   --lib 只传 android.jar；依赖 jar（项目 libs + androidx）当 R8 的「程序输入」一起 dex（R8 直接吃 jar/dex）
        d8Args.add("--lib"); d8Args.add(androidJar.getAbsolutePath());
        d8Args.add("--output"); d8Args.add(dexDir.getAbsolutePath());
        d8Args.addAll(classFiles);
        // M283：去重——同一个 jar 可能被以两个名字进 assets/androidx（历史缓存错位）或 libs/+androidx 重叠，
        // 两个不同路径同内容 → R8 报「Type X defined multiple times」。按「长度+前 64KB 摘要」去重（便宜，不读全文件）。
        java.util.List<String> jarSigs = new java.util.ArrayList<>();
        for (String j : libJars) addDedupedJar(d8Args, j, jarSigs, log);
        if (androidxJars != null) for (String a : androidxJars) addDedupedJar(d8Args, a, jarSigs, log);
        java.lang.reflect.Method d8Method = d8.getMethod("dex", String[].class, java.util.List.class);
        boolean d8Ok = Boolean.valueOf((Boolean) d8Method.invoke(null, d8Args.toArray(new String[0]), d8Log));
        if (!d8Ok || d8Log.size() > 0) {
            logRaw(log, String.join("\n", d8Log), 40);
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
        // M254：java:<classes>:<dex>，UI 才能说「编译了 N 个类、注入 M 个 dex」
        return "java:" + classFiles.size() + ":" + n;
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
        java.io.File missLog = new java.io.File(ctx.getCacheDir(), "ecj-res-miss.log");
        // M248：res 缺了/读不到时写这份日志，设备端能回读定位（不再盲猜）
        try { if (missLog.exists()) missLog.delete(); } catch (Throwable ignored) {}
        java.lang.ClassLoader resLoader = new ResClassLoader(resDir, ctx.getClassLoader(), missLog);
        java.lang.ClassLoader cl = new dalvik.system.InMemoryDexClassLoader(bb, null, resLoader);
        // 顺带把 TCCL 指到它，避免 ECJ 内部用线程 classloader 找资源时绕过父链
        Thread.currentThread().setContextClassLoader(cl);
        return cl;
    }

    /** 只服务 res 目录的资源 ClassLoader（ECJ 的 Parser 表 / 消息包都靠它）。
     *  M248：ECJ 请求资源名可能是「全限定路径」（org/eclipse/.../parser1.rsc）也可能是
     *  「裸文件名」（parser1.rsc，当 ECJ 用 classloader.getResourceAsStream 而非 class.getResource）。
     *  之前只做 exact(root/name) 匹配，裸文件名就 null → Parser 静态初始化 NPE（inStream null）。
     *  现在建索引：按 (全路径 / 后缀 / basename) 多级匹配，并记 miss 日志供定位。 */
    private static final class ResClassLoader extends java.lang.ClassLoader {
        private final File root;
        private volatile java.util.Map<String, File> index; // key: 全相对路径 & basename → 文件
        private final File missLog;
        ResClassLoader(File root, java.lang.ClassLoader parent, File logFile) { super(parent); this.root = root; this.missLog = logFile; }

        private void buildIndex() {
            java.util.HashMap<String, File> m = new java.util.HashMap<>();
            walk(root, "", m);
            this.index = m;
        }
        private void walk(File dir, String rel, java.util.Map<String, File> m) {
            File[] fs = dir.listFiles();
            if (fs == null) return;
            for (File f : fs) {
                String r = rel.isEmpty() ? f.getName() : (rel + "/" + f.getName());
                if (f.isDirectory()) walk(f, r, m);
                else {
                    m.put(r, f);                                   // 全路径（正斜杠）
                    m.putIfAbsent(f.getName(), f);                  // basename
                    int slash = r.lastIndexOf('/');
                    if (slash > 0) m.putIfAbsent(r.substring(slash + 1), f); // 包尾相对
                }
            }
        }
        private File resolve(String name) {
            if (name == null || name.isEmpty()) return null;
            // 去前导 /，统一正斜杠
            String n = name.startsWith("/") ? name.substring(1) : name;
            if (index == null) { buildIndex(); }
            File f = index.get(n);
            if (f == null) f = index.get(n.replace('/', java.io.File.separatorChar));
            if (f == null) f = index.get(n.substring(n.lastIndexOf('/') + 1)); // basename 兜底
            if (f == null) f = index.get(n.replace('/', java.io.File.separatorChar).substring(n.replace('/', java.io.File.separatorChar).lastIndexOf('/') + 1));
            if (f == null) logMiss(n);
            return f;
        }
        private void logMiss(String name) {
            try (java.io.FileWriter w = new java.io.FileWriter(missLog, true)) {
                w.write("res miss: " + name + "\n");
            } catch (Throwable ignored) { }
        }
        @Override public java.net.URL findResource(String name) {
            java.io.File f = resolve(name);
            return f != null ? safeUrl(f) : null;
        }
        @Override public java.io.InputStream getResourceAsStream(String name) {
            java.io.File f = resolve(name);
            if (f == null) return null;
            try { return new java.io.FileInputStream(f); } catch (Throwable t) { return null; }
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

    /** 把设备端 ResClassLoader 的资源 miss 日志追加进构建日志（定位 ECJ 资源加载问题） */
    /** M263：构建日志分节标题 */
    private static void logStage(StringBuilder log, String title) {
        log.append("\n== ").append(title).append(" ==\n");
    }

    /** M263：格式化一行输出（截断超长行） */
    private static String fmtLine(String s) {
        if (s == null) return "";
        s = s.trim();
        if (s.length() > 180) s = s.substring(0, 177) + "...";
        return "  " + s;
    }

    /** M263：把外部工具输出按行格式化进 log（跳过空行/分隔行，截断到 capLines 行） */
    private static void logRaw(StringBuilder log, String raw, int capLines) {
        if (raw == null || raw.isEmpty()) return;
        String[] lines = raw.split("\n");
        int shown = 0;
        int total = 0;
        for (String line : lines) {
            String t = line.trim();
            if (t.isEmpty() || t.matches("^-{3,}$")) continue;
            total++;
            log.append(fmtLine(line)).append('\n');
            if (++shown >= capLines) break;
        }
        if (total > shown) {
            log.append("  …（已截断：只显示前 ").append(shown).append(" 行，共 ").append(total).append(" 行）\n");
        }
    }

    /** M266：把 ECJ 的批量编译输出压成「按文件归类的错误清单」。
     *  ECJ 原始一行一条（错误 + 源码行 + 箭头 + 消息），89 个文件能刷 5000 行，
     *  直接截断会把后面的错误吞掉。这里解析成结构化条目，同类消息去重，并给出缺依赖提示。 */
    private static String fmtEcjLog(java.util.List<String> raw, int maxEntries, boolean hasAndroidxBuiltIn, String appPkg) {
        if (raw == null || raw.isEmpty()) return "";
        java.util.List<String> lines = new java.util.ArrayList<>();
        for (String s : raw) {
            if (s == null) continue;
            for (String p : s.split("\n")) lines.add(p);
        }
        java.util.regex.Pattern head = java.util.regex.Pattern.compile(
                "^\\s*[0-9]+\\.\\s+(ERROR|WARNING)\\s+in\\s+(.+?)\\s+\\(at line ([0-9]+)\\)\\s*$");
        java.util.LinkedHashMap<String, java.util.LinkedHashMap<String, Integer>> byFile = new java.util.LinkedHashMap<>();
        java.util.LinkedHashSet<String> missingPkgsRaw = new java.util.LinkedHashSet<>();
        java.util.List<String> missingPkgs = new java.util.ArrayList<>();
        // M277：两类额外归集——缺资源（改 res/ 能修） vs 缺类（要补 jar）
        java.util.LinkedHashMap<String, Integer> missingRes = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, Integer> missingTypes = new java.util.LinkedHashMap<>();
        int errors = 0, warnings = 0;
        String curFile = null;
        boolean curIsError = true;
        boolean msgTaken = false;
        for (String l : lines) {
            java.util.regex.Matcher m = head.matcher(l);
            if (m.find()) {
                curIsError = "ERROR".equals(m.group(1));
                if (curIsError) errors++; else warnings++;
                String full = m.group(2).replace('\\', '/');
                curFile = full.substring(full.lastIndexOf('/') + 1);
                java.util.LinkedHashMap<String, Integer> bucket = byFile.get(curFile);
                if (bucket == null) { bucket = new java.util.LinkedHashMap<>(); byFile.put(curFile, bucket); }
                msgTaken = false;
                continue;
            }
            if (curFile == null || msgTaken) continue;
            String t = l.trim();
            if (t.isEmpty() || t.startsWith("^") || t.matches("^-{3,}$")) continue;
            if (l.startsWith("\t") || l.startsWith("    ")) continue; // 源码片段行
            // 到了消息行
            msgTaken = true;
            String msg = t;
            java.util.regex.Matcher imp = java.util.regex.Pattern
                    .compile("^The import ([A-Za-z0-9_.]+) cannot be resolved")
                    .matcher(msg);
            if (imp.find()) {
                String fq = imp.group(1);
                int dot = fq.lastIndexOf('.');
                String pkg = dot > 0 ? fq.substring(0, dot) : fq;
                String[] seg = pkg.split("\\.");
                String root = seg.length >= 2 ? seg[0] + "." + seg[1] : pkg;
                if (!root.startsWith("java.") && !root.startsWith("javax.") && !root.startsWith("android.")) {
                    missingPkgsRaw.add(root);
                }
            }
            // M277：`Xxx cannot be resolved or is not a field` → 缺资源（R.xxx 引用不到）
            java.util.regex.Matcher resm = java.util.regex.Pattern
                    .compile("^([A-Za-z_][A-Za-z0-9_]*)\\s+cannot be resolved or is not a field")
                    .matcher(msg);
            if (resm.find()) {
                String name = resm.group(1);
                Integer old = missingRes.get(name);
                missingRes.put(name, old == null ? 1 : old + 1);
            }
            // M277：`Xxx cannot be resolved to a type` → 缺类（多半是没引入的库）
            java.util.regex.Matcher tym = java.util.regex.Pattern
                    .compile("^([A-Za-z_][A-Za-z0-9_]*)\\s+cannot be resolved to a type")
                    .matcher(msg);
            if (tym.find()) {
                String name = tym.group(1);
                Integer old = missingTypes.get(name);
                missingTypes.put(name, old == null ? 1 : old + 1);
            }
            // M277：`The type java.lang.invoke.X cannot be resolved` 类是编译器自身问题，别算到用户头上
            if (msg.startsWith("The type java.") || msg.startsWith("The type javax.")) {
                curFile = null;
                continue;
            }
            java.util.LinkedHashMap<String, Integer> bucket = byFile.get(curFile);
            if (bucket != null) {
                Integer old = bucket.get(msg);
                bucket.put(msg, old == null ? 1 : old + 1);
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("ECJ 结果：").append(errors).append(" 个错误");
        if (warnings > 0) sb.append("、").append(warnings).append(" 个警告");
        sb.append("，涉及 ").append(byFile.size()).append(" 个文件（同类消息已合并）\n");
        int shown = 0;
        outer:
        for (java.util.Map.Entry<String, java.util.LinkedHashMap<String, Integer>> fe : byFile.entrySet()) {
            sb.append("● ").append(fe.getKey()).append('\n');
            int perFile = 0;
            for (java.util.Map.Entry<String, Integer> me : fe.getValue().entrySet()) {
                if (shown >= maxEntries) {
                    sb.append("  …（还有更多文件/错误未展示）\n");
                    break outer;
                }
                sb.append("    ").append(me.getKey());
                if (me.getValue() > 1) sb.append("（×").append(me.getValue()).append("）");
                sb.append('\n');
                shown++;
                if (++perFile >= 4) {
                    int rest = fe.getValue().size() - perFile;
                    if (rest > 0) sb.append("    …（本文件还有 ").append(rest).append(" 条）\n");
                    break;
                }
            }
        }
        // M271：过滤掉「项目自己的包」——appPkg 的前缀/自身不该当缺依赖列出来
        if (!missingPkgsRaw.isEmpty()) {
            missingPkgs.addAll(missingPkgsRaw);
            if (appPkg != null && !appPkg.isEmpty()) {
                java.util.List<String> keep = new java.util.ArrayList<>();
                for (String p : missingPkgs) {
                    if (p.equals(appPkg)) continue;
                    if (appPkg.startsWith(p + ".")) continue;   // p 是 appPkg 的父前缀
                    if (p.startsWith(appPkg + ".")) continue;   // p 在 appPkg 下面
                    String[] seg = p.split("\\.");
                    if (seg.length < 2 && !p.startsWith("androidx.")) continue;
                    keep.add(p);
                }
                missingPkgs = keep;
            }
        }
        if (!missingPkgs.isEmpty()) {
            sb.append("缺依赖提示：以下第三方包不在编译 classpath —— ");
            int i = 0;
            for (String p : missingPkgs) {
                if (i++ > 0) sb.append("、");
                sb.append(p);
                if (i >= 8) break;
            }
            sb.append("\n");
            // M270：给用户明确的「下载什么、放哪里」引导
            sb.append("  需手动下载放进项目 libs/ 目录的包：\n");
            int j = 0;
            for (String p : missingPkgs) {
                if (j++ >= 6) { sb.append("    …（还有 ").append(missingPkgs.size() - 6).append(" 个未列）\n"); break; }
                sb.append("    - ").append(p).append("  →  ");
                if (p.startsWith("androidx.")) {
                    String art = p.substring("androidx.".length()).split("\\.")[0];
                    sb.append("androidx:").append(art).append("（Google Maven 下载 .aar/.jar）\n");
                } else {
                    sb.append("搜「").append(p).append("」的官方 jar，放到 libs/\n");
                }
            }
            sb.append("  放进 libs/ 后重新打包会自动加进 classpath（无需改代码）\n");
            if (hasAndroidxBuiltIn) {
                sb.append("  （内置 androidx 插件包已覆盖常用 1.0.0 基础库；上面列出的是插件包没含的库/版本）\n");
            }
        }
        // M277：缺类（cannot be resolved to a type）——不是资源问题，多半要补 jar
        if (!missingTypes.isEmpty()) {
            sb.append("缺类提示（这些类当前任何 jar 里都没有，多半是没引入的第三方库）：\n");
            int k = 0;
            for (java.util.Map.Entry<String, Integer> e : missingTypes.entrySet()) {
                if (k++ >= 8) { sb.append("    …（还有 ").append(missingTypes.size() - 8).append(" 个）\n"); break; }
                sb.append("    - ").append(e.getKey());
                if (e.getValue() > 1) sb.append("（×").append(e.getValue()).append("）");
                sb.append("\n");
            }
        }
        // M277：缺资源（drawable/string/layout 等 R.xxx 引用不到）——要补 res/ 文件
        if (!missingRes.isEmpty()) {
            sb.append("缺资源提示（R.drawable/R.string/R.layout … 在项目 res/ 里找不到）：\n");
            int k = 0;
            for (java.util.Map.Entry<String, Integer> e : missingRes.entrySet()) {
                if (k++ >= 10) { sb.append("    …（还有 ").append(missingRes.size() - 10).append(" 个）\n"); break; }
                sb.append("    - ").append(e.getKey());
                if (e.getValue() > 1) sb.append("（×").append(e.getValue()).append("）");
                sb.append("\n");
            }
            sb.append("  这些是原工程的图标/布局/字符串没被反编译出来的，需要把对应文件补进 res/ 下的\n");
            sb.append("  drawable*/layout/values/raw 等目录（或改代码不用它们）。\n");
        }
        return sb.toString();
    }

    /** M263：项目 manifest 缺 package 属性时，在 <manifest> 开标签里补上（aapt2 正规清单必需） */
    private static String ensureManifestPkg(String text, String pkg, StringBuilder log) {
        if (text == null || pkg == null || pkg.isEmpty()) return text;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("<manifest\\b[^>]*>", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(text);
        if (!m.find()) return text;
        String openTag = m.group();
        if (java.util.regex.Pattern.compile("package\\s*=", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(openTag)
                .find()) {
            return text;
        }
        String newOpenTag = openTag.substring(0, openTag.length() - 1) + " package=\"" + pkg + "\">";
        String replaced = text.substring(0, m.start()) + newOpenTag + text.substring(m.end());
        log.append("项目清单缺 package，已补 package=\"").append(pkg).append("\"\n");
        return replaced;
    }

    /** M267：把 assets/androidx/ 下的 jar/aar 落到 root/androidx/，aar 取 classes.jar，
     *  返回可用于 classpath 的 jar 列表。已存在则跳过（幂等）。 */
    private List<String> ensureAndroidx(File root, StringBuilder log) {
        List<String> out = new ArrayList<>();
        try {
            android.content.res.AssetManager am = ctx.getAssets();
            String[] entries;
            try {
                entries = am.list("androidx");
            } catch (Throwable e) {
                log.append("androidx 插件包不存在（APK 未内置），跳过\n");
                return out;
            }
            if (entries == null || entries.length == 0) {
                log.append("androidx 插件包为空，跳过\n");
                return out;
            }
            File outDir = new File(root, "androidx");
            outDir.mkdirs();
            int added = 0;
            for (String name : entries) {
                try {
                    if (name.endsWith(".jar")) {
                        File dst = new File(outDir, name);
                        if (!dst.isFile() || dst.length() == 0) {
                            try (InputStream is = am.open("androidx/" + name);
                                 FileOutputStream fos = new FileOutputStream(dst)) {
                                copyStream(is, fos);
                            }
                        }
                        out.add(dst.getAbsolutePath());
                        added++;
                    } else if (name.endsWith(".aar")) {
                        File aarDst = new File(outDir, name);
                        if (!aarDst.isFile() || aarDst.length() == 0) {
                            try (InputStream is = am.open("androidx/" + name);
                                 FileOutputStream fos = new FileOutputStream(aarDst)) {
                                copyStream(is, fos);
                            }
                        }
                        String base = name.substring(0, name.length() - 4);
                        File classes = new File(outDir, base + "-classes.jar");
                        File extracted = extractClassesJar(aarDst, classes);
                        if (extracted != null) {
                            out.add(extracted.getAbsolutePath());
                            added++;
                        } else {
                            log.append("  ! ").append(name).append(" 无 classes.jar，跳过\n");
                        }
                    }
                } catch (Throwable ignored) { }
            }
            log.append("androidx 插件包解压 ").append(added).append("/ ").append(entries.length).append(" 个到 ").append(outDir).append("\n");
        } catch (Throwable t) {
            log.append("androidx 插件包处理失败：").append(t.getMessage()).append("\n");
        }
        return out;
    }

    /** M266：从 aar（zip）里抽出 classes.jar；失败返回 null */
    /** M278/P1-1：把 libs 里 aar 的 res/** 合并进 aapt2 资源目录（drawable/values 等）。
     *  同名资源：项目自己的优先（先写 aar，后写项目——这里在写完项目 res 之后调，
     *  所以 aar 的 res 不覆盖已有同名文件，只补缺的）。 */
    /**
     * M416：把所有 aar 的 res/ 合并进同一个目录树（aarres_merged），
     *  解决 aapt2 link「conflicting value for configuration」（两个不同 aar 都声明同名 styleable 时
     *  各自独立 overlay 会撞结构冲突；合并成一棵树后 aapt2 compile 只看到一套 values，不再冲突）。
     *  合并规则：
     *   - values/values-XX/values-land 等 XML 文件：拼接 <resources> 标签体内的内容（不丢默认值）
     *   - 其它文件（drawable/layout/anim）：后面 aar 覆盖前面
     *   - M414 同名 artifact 多版本去重保留（只收最高版）
     *  返回单个合并目录（无 aar 时返回 null）。
     */
    private File mergeAarResTree(JSONArray libs, File root, StringBuilder log) {
        if (libs == null || libs.length() == 0) return null;
        File merged = new File(root, "aarres_merged");
        deleteRec(merged);
        merged.mkdirs();

        // M414：同名 artifact 多版本去重（material-1.12.0 + material-1.0.0 只留 1.12.0）
        java.util.List<String> aarIdx = new java.util.ArrayList<>();
        for (int i = 0; i < libs.length(); i++) {
            JSONObject lj = libs.optJSONObject(i);
            if (lj == null) continue;
            if (!lj.optString("path", "").endsWith(".aar")) continue;
            aarIdx.add(String.valueOf(i));
        }
        java.util.Map<String, Integer> bestByBase = new java.util.LinkedHashMap<>();
        for (String idx : aarIdx) {
            JSONObject lj = libs.optJSONObject(Integer.parseInt(idx));
            String artBase = artifactBase(lj.optString("path", ""));
            Integer prev = bestByBase.get(artBase);
            if (prev == null || compareVer(verOf(lj.optString("path", "")),
                    verOf(libs.optJSONObject(prev).optString("path", ""))) > 0) {
                bestByBase.put(artBase, Integer.parseInt(idx));
            }
        }
        java.util.List<String> dropIdx = new java.util.ArrayList<>();
        for (String idx : aarIdx) {
            JSONObject lj = libs.optJSONObject(Integer.parseInt(idx));
            String artBase = artifactBase(lj.optString("path", ""));
            if (!String.valueOf(bestByBase.get(artBase)).equals(idx)) dropIdx.add(idx);
        }
        if (!dropIdx.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            sb.append("aar 多版本去重：跳过 ").append(dropIdx.size()).append(" 个 → ");
            for (int k = 0; k < dropIdx.size(); k++) {
                if (k > 0) sb.append("；");
                sb.append(new File(libs.optJSONObject(Integer.parseInt(dropIdx.get(k))).optString("path", "")).getName());
            }
            log.append(sb).append('\n');
        }

        int total = 0;
        for (String idxStr : aarIdx) {
            int i = Integer.parseInt(idxStr);
            if (dropIdx.contains(idxStr)) continue;
            JSONObject lj = libs.optJSONObject(i);
            String libPath = lj.optString("path", "");
            String b64 = lj.optString("base64", "");
            if (!libPath.endsWith(".aar") || b64.isEmpty()) continue;
            try {
                byte[] data = Base64.decode(b64, Base64.NO_WRAP);
                if (data == null || data.length == 0) continue;
                File aarTmp = new File(root, ".aar" + i + ".tmp");
                writeBytes(aarTmp, data);
                int n = 0;
                try (java.util.zip.ZipFile zf = new java.util.zip.ZipFile(aarTmp)) {
                    java.util.Enumeration<? extends java.util.zip.ZipEntry> en = zf.entries();
                    while (en.hasMoreElements()) {
                        java.util.zip.ZipEntry ze = en.nextElement();
                        String name = ze.getName();
                        if (ze.isDirectory() || !name.startsWith("res/")) continue;
                        String rel = name.substring(4);
                        File dst = new File(merged, rel);
                        dst.getParentFile().mkdirs();
                        // M416：values 目录下的 XML 合并拼接（不覆盖）
                        boolean isValues = isValuesXml(rel);
                        if (isValues && dst.isFile()) {
                            String existing = readUtf8(dst);
                            byte[] inc = readAll(zf.getInputStream(ze));
                            String incoming = new String(inc, java.nio.charset.StandardCharsets.UTF_8);
                            writeUtf8(dst, mergeValuesXml(existing, incoming));
                        } else {
                            try (InputStream is = zf.getInputStream(ze)) {
                                writeBytes(dst, readAll(is));
                            }
                        }
                        n++;
                    }
                } finally {
                    aarTmp.delete();
                }
                if (n > 0) {
                    total += n;
                    log.append("aar 资源合并：").append(libPath).append(" → ").append(n).append(" 个\n");
                }
            } catch (Throwable ignored) {
                log.append("aar 资源展开失败（跳过）：").append(libPath).append("\n");
            }
        }
        if (total > 0) log.append("aar 资源共 ").append(total).append(" 个（合并到 ").append(merged.getName()).append("）\n");
        return total > 0 ? merged : null;
    }

    /** M416：是否 values 目录下的 XML（values/、values-v21/、values-land/ 等） */
    private static boolean isValuesXml(String rel) {
        String path = rel.toLowerCase();
        if (!path.endsWith(".xml")) return false;
        // 第一个路径段以 values 开头
        int slash = path.indexOf('/');
        if (slash < 0) return false;
        String dir = path.substring(0, slash);
        return dir.startsWith("values");
    }

    /**
     * M416：合并两个 values XML（拼接 <resources> 标签体内的内容）。
     *  两个文件都是 <?xml ...?><resources>...</resources> 结构，
     *  合并后仍是一个 <resources>，内容是两者的并集。
     *  如果同名资源（同 config）内容不同，aapt2 compile 会报冲突——
     *  但这种情况只在两个不同库声明了同名但不同值的资源时发生，
     *  实际上 aapt2 对 overlay 允许后者覆盖前者，这里先拼接让 aapt2 自己处理。
     */
    private static String mergeValuesXml(String existing, String incoming) {
        // 去掉 XML 声明和 <resources> 外层标签，拼接体内内容
        String bodyA = stripResRoot(existing);
        String bodyB = stripResRoot(incoming);
        String decl = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n";
        return decl + "<resources>\n" + bodyA + "\n" + bodyB + "\n</resources>\n";
    }

    /** 去掉 <?xml ...?> 声明和 <resources ...> 外层标签，只留体内内容 */
    private static String stripResRoot(String s) {
        String t = s.trim();
        // 去掉 XML 声明
        int declEnd = t.indexOf("?>");
        if (declEnd >= 0) t = t.substring(declEnd + 2).trim();
        // 去掉 <resources ...> 开标签
        int start = t.indexOf("<resources");
        if (start < 0) return t;
        int openEnd = t.indexOf('>', start);
        if (openEnd < 0) return t;
        t = t.substring(openEnd + 1);
        // 去掉 </resources> 闭标签
        int closeStart = t.lastIndexOf("</resources>");
        if (closeStart >= 0) t = t.substring(0, closeStart);
        return t.trim();
    }

    /** M414：aar 文件名的 artifact 基名（material-1.12.0.aar → material；无版本段 → 原名） */
    private static String artifactBase(String libPath) {
        String p = libPath.toLowerCase();
        int slash = p.lastIndexOf('/');
        String fname = slash >= 0 ? p.substring(slash + 1) : p;
        if (fname.endsWith(".aar")) fname = fname.substring(0, fname.length() - 4);
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(.+?)-(\\d+(?:\\.\\d+)*(?:-[0-9a-z.]+)?)$").matcher(fname);
        return m.matches() ? m.group(1) : fname;
    }

    /** M414：从 aar 文件名取版本段（material-1.12.0.aar → 1.12.0；无版本段 → 0） */
    private static String verOf(String libPath) {
        String p = libPath.toLowerCase();
        int slash = p.lastIndexOf('/');
        String fname = slash >= 0 ? p.substring(slash + 1) : p;
        if (fname.endsWith(".aar")) fname = fname.substring(0, fname.length() - 4);
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(.+?)-(\\d+(?:\\.\\d+)*(?:-[0-9a-z.]+)?)$").matcher(fname);
        if (m.matches()) return m.group(2).replaceAll("-[0-9a-z.]+$", "");
        return "0";
    }

    /** M414：版本号比较（逐段数字比，短段补 0） */
    private static int compareVer(String verA, String verB) {
        String[] pa = verA.split("\\.");
        String[] pb = verB.split("\\.");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            int a = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int b = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (a != b) return Integer.compare(a, b);
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try { return Integer.parseInt(s); } catch (Exception e) { return 0; }
    }

    /** 递归删目录（清 aarres 残留用，只删我们自己建的 cache 目录） */
    private void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        f.delete();
    }

    private File extractClassesJar(File aar, File outJar) {
        try (java.util.zip.ZipFile zf = new java.util.zip.ZipFile(aar)) {
            java.util.zip.ZipEntry e = zf.getEntry("classes.jar");
            if (e == null) return null;
            try (InputStream is = zf.getInputStream(e)) {
                byte[] buf = readAll(is);
                writeBytes(outJar, buf);
            }
            return outJar;
        } catch (Throwable t) {
            return null;
        }
    }

    private void appendResMissLog(StringBuilder log) {
        try {
            File f = new File(ctx.getCacheDir(), "ecj-res-miss.log");
            if (f.isFile() && f.length() > 0) {
                byte[] data = readFile(f);
                if (data != null && data.length > 0) {
                    log.append("res-miss: ").append(new String(data, StandardCharsets.UTF_8)).append('\n');
                }
            }
        } catch (Throwable ignored) { }
    }

    private File defaultOutDir() {
        // 和 MainActivity.defaultDir() 保持一致：外部存储 /AndroidUIIDE/Project/build
        java.io.File ext = android.os.Environment.getExternalStorageDirectory();
        File d = new File(ext, "AndroidUIIDE/Project/build");
        return d;
    }

    /** M298：调试默认签名 /AndroidUIIDE/axv-debug.keystore，没有就自动生成 */
    private File ensureDebugKeystore(StringBuilder log) {
        java.io.File ext = android.os.Environment.getExternalStorageDirectory();
        File dir = new File(ext, "AndroidUIIDE");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            log.append("建不了 ").append(dir).append("，调试签名自动生成失败\n");
            return null;
        }
        File ks = new File(dir, DEBUG_KESTORE_NAME);
        if (ks.isFile() && ks.length() > 0) return ks;
        try {
            KeystoreMaker.make(ks.getAbsolutePath(), DEBUG_ALIAS, DEBUG_STORE_PASS, "AXV Debug", "Android", 30);
            log.append("已自动生成调试签名：").append(ks.getAbsolutePath()).append('\n');
            return ks;
        } catch (Throwable t) {
            log.append("调试签名自动生成失败：").append(String.valueOf(t.getMessage())).append('\n');
            return null;
        }
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
        log.append("$ aapt2 ").append(args[0]).append(" ").append(String.join(" ", java.util.Arrays.asList(args).subList(1, args.length))).append('\n');
        log.append("  exit=").append(code).append('\n');
        logRaw(log, new String(out, StandardCharsets.UTF_8), 80);
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

    /** M272：按 UTF-8 读文件全文（去 BOM） */
    private static String readUtf8(File f) throws IOException {
        byte[] buf = new byte[(int) f.length()];
        try (FileInputStream fis = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int n = fis.read(buf, off, buf.length - off);
                if (n <= 0) break;
                off += n;
            }
        }
        String s = new String(buf, StandardCharsets.UTF_8);
        if (!s.isEmpty() && s.charAt(0) == '\uFEFF') s = s.substring(1);
        return s;
    }

    private static void writeBytes(File f, byte[] data) throws IOException {
        f.getParentFile().mkdirs();
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(data);
        }
    }

    /** M267：流拷贝（assets → 文件） */
    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
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

    /** M283：D8 程序输入去重。按「文件长度 + 前 64KB 的摘要」判同内容，避免同一 jar 被两个不同
     *  名字/路径重复喂进 D8（R8 报「Type X defined multiple times」）。
     *  返回 true=已加入 d8Args，false=与已加的同内容，跳过。 */
    private static boolean addDedupedJar(java.util.List<String> d8Args, String jarPath, java.util.List<String> sigs, StringBuilder log) {
        if (jarPath == null || jarPath.isEmpty()) return false;
        File f = new File(jarPath);
        if (!f.isFile()) return false;
        try {
            long len = f.length();
            byte[] head = new byte[(int) Math.min(65536, len)];
            int read = 0;
            try (java.io.FileInputStream fis = new java.io.FileInputStream(f)) {
                while (read < head.length) {
                    int r = fis.read(head, read, head.length - read);
                    if (r < 0) break;
                    read += r;
                }
            }
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            md.update(head, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            String sig = len + ":" + hex;
            synchronized (sigs) {
                if (sigs.contains(sig)) {
                    log.append("  去重：跳过与已加 jar 同内容的 ").append(new File(jarPath).getName()).append("\n");
                    return false;
                }
                sigs.add(sig);
            }
            d8Args.add(jarPath);
            return true;
        } catch (Throwable t) {
            // 读不到就原样加入（不阻断编译），靠 make-androidx 去重做主防线
            d8Args.add(jarPath);
            return true;
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
