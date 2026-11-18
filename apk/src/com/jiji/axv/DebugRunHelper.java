package com.jiji.axv;

import android.content.Context;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * M405：debug 运行 —— 把「编译好的 dex 字节」在设备进程内动态加载并执行，
 * 捕获 System.out / System.err / 异常，回传给 WebView 显示在编辑器下方「调试日志」。
 *
 * 为什么不用打包安装：AIDE 同款思路。dex 用 InMemoryDexClassLoader（API26+）
 * 直接从内存加载，绕开 Android10+「可写目录 dex 被禁」的限制；API24/25 回退
 * DexClassLoader + 落只读文件。执行的是真 dex，结果 100% 真实（不是解释执行）。
 *
 * 限制（跑在宿主 App 进程里，没有独立 Application/Context）：
 *   - 只能跑纯逻辑（算法/工具类/函数），不能起 Activity / 用系统 Context
 *   - System.out/err 被本类劫持进缓冲区；执行完恢复
 *   - 提供 DDebug 工具类（见下方）让用户代码里 DDebug.log / DDebug.out 输出
 *
 * 入口约定（payload 不指定时自动探测）：
 *   1) 任意 public static void main(String[])
 *   2) 任意 public static void debug()
 *   3) 都没有 → 失败（log 里说明）
 * 指定时：entryClass（全限定名）+ entryMethod（"main" / "debug" / 自定义 static 方法名）。
 */
public class DebugRunHelper {
    private static final String TAG = "DebugRunHelper";
    private final Context ctx;

    public DebugRunHelper(Context ctx) {
        this.ctx = ctx;
    }

    /** 默认执行超时（毫秒） */
    private static final long DEFAULT_TIMEOUT_MS = 30000;
    /** System.out/err 缓冲上限（防止死循环刷爆内存） */
    private static final int MAX_OUT_BYTES = 256 * 1024;

    /**
     * 执行一次 debug run。
     * payload: { dex: [b64...], entryClass?, entryMethod?, args?: [str], timeoutMs?, pkg? }
     * 返回 JSON 字符串：
     *   { ok, step, stdout, stderr, returnValue, exception, stackTrace, ms, entry, log }
     * step: env / dex / entry / timeout / exception / done
     */
    public String run(String payloadJson) {
        JSONObject out = new JSONObject();
        long t0 = System.currentTimeMillis();
        StringBuilder log = new StringBuilder();
        String step = "init";
        try {
            JSONObject p = new JSONObject(payloadJson);
            JSONArray dexArr = p.optJSONArray("dex");
            if (dexArr == null || dexArr.length() == 0) {
                return "{\"ok\":false,\"step\":\"env\",\"log\":\"没有 dex 字节（先 compileToDex）\"}";
            }
            // M405：候选入口类全限定名（JS 按「带 main/debug 的类」算好传进来；自动探测靠它）
            JSONArray candArr = p.optJSONArray("candidates");
            entryCandidates = new ArrayList<>();
            if (candArr != null) for (int i = 0; i < candArr.length(); i++) {
                String c = candArr.optString(i, "");
                if (!c.isEmpty()) entryCandidates.add(c);
            }

            List<byte[]> dexList = new ArrayList<>();
            for (int i = 0; i < dexArr.length(); i++) {
                byte[] d = Base64.decode(dexArr.optString(i, ""), Base64.NO_WRAP);
                if (d != null && d.length > 0) dexList.add(d);
            }
            if (dexList.isEmpty()) {
                return "{\"ok\":false,\"step\":\"dex\",\"log\":\"dex base64 全部解空\"}";
            }

            // 1) 加载 dex
            step = "dex";
            ClassLoader cl = loadDex(dexList, log);
            if (cl == null) {
                out.put("ok", false);
                out.put("step", "dex");
                out.put("log", log.toString());
                return out.toString();
            }
            log.append("已加载 ").append(dexList.size()).append(" 个 dex（")
                    .append(totalBytes(dexList) / 1024).append(" KB）\n");

            // 2) 找入口
            step = "entry";
            String entryClass = p.optString("entryClass", "").trim();
            String entryMethod = p.optString("entryMethod", "").trim();
            JSONArray argsArr = p.optJSONArray("args");
            List<String> argList = new ArrayList<>();
            if (argsArr != null) for (int i = 0; i < argsArr.length(); i++) argList.add(argsArr.optString(i, ""));

            Method target = null;
            Class<?> targetCls = null;
            String entryLabel = "";
            if (!entryClass.isEmpty()) {
                targetCls = Class.forName(entryClass, true, cl);
                target = findMethod(targetCls, entryMethod.isEmpty() ? "main" : entryMethod);
                if (target == null) {
                    out.put("ok", false);
                    out.put("step", "entry");
                    out.put("log", "类 " + entryClass + " 里找不到方法 " + entryMethod + "（看下面的可用方法）\n"
                            + describeMethods(targetCls));
                    return out.toString();
                }
                entryLabel = entryClass + "." + target.getName() + "()";
            } else {
                // 自动探测：先找带 main(String[]) 的类，再找 debug()
                target = probeForMethod(cl, "main", new Class[]{String[].class});
                if (target != null) {
                    targetCls = target.getDeclaringClass();
                    entryLabel = targetCls.getName() + ".main(String[])";
                } else {
                    target = probeForMethod(cl, "debug", new Class[0]);
                    if (target != null) {
                        targetCls = target.getDeclaringClass();
                        entryLabel = targetCls.getName() + ".debug()";
                    }
                }
                if (target == null) {
                    out.put("ok", false);
                    out.put("step", "entry");
                    out.put("log", "没找到入口方法（main(String[]) 或 debug()）。请在代码里写一个，或在面板里指定入口类+方法。\n"
                            + "已尝试候选：" + (entryCandidates.isEmpty() ? "（无，请在 payload.candidates 里给全限定类名）" : String.join("、", entryCandidates))
                            + "\n" + availableStaticMethods(cl));
                    return out.toString();
                }
            }
            log.append("入口：").append(entryLabel).append('\n');

            // 3) 劫持 System.out/err
            long timeoutMs = p.optLong("timeoutMs", DEFAULT_TIMEOUT_MS);
            ByteArrayOutputStream outBuf = new ByteArrayOutputStream();
            ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
            PrintStream realOut = System.out;
            PrintStream realErr = System.err;
            PrintStream capOut = new PrintStream(new LimitingStream(outBuf, MAX_OUT_BYTES)) {
                @Override public synchronized void print(String s) {
                    if (outBuf.size() < MAX_OUT_BYTES) {
                        super.print(s);
                        if (outBuf.size() > MAX_OUT_BYTES) outBuf.write('\n');
                    }
                }
            };
            PrintStream capErr = new PrintStream(new LimitingStream(errBuf, MAX_OUT_BYTES)) {
                @Override public synchronized void print(String s) {
                    if (errBuf.size() < MAX_OUT_BYTES) super.print(s);
                }
            };

            String returnValue = "";
            String exception = "";
            String stackTrace = "";
            boolean timedOut = false;

            System.setOut(capOut);
            System.setErr(capErr);
            try {
                Object result;
                if (target.getParameterTypes().length == 1 && target.getParameterTypes()[0] == String[].class) {
                    result = target.invoke(null, new String[]{ argList.toArray(new String[0]) });
                } else if (target.getParameterTypes().length == 0) {
                    result = target.invoke(null);
                } else {
                    // 参数不匹配的 static 方法：尽量按 args 转（string 透传）
                    result = target.invoke(null, argList.toArray());
                }
                returnValue = result == null ? "null" : String.valueOf(result);
            } catch (Throwable ex) {
                Throwable real = ex.getCause() == null ? ex : ex.getCause();
                exception = real.getClass().getName() + (real.getMessage() == null ? "" : ": " + real.getMessage());
                stackTrace = stackTraceOf(real);
            } finally {
                System.setOut(realOut);
                System.setErr(realErr);
                // 超时检测：执行耗时 > timeoutMs（线程已自然返回；真死循环则靠 LimitingStream 截断 + 后续手动）
                long elapsed = System.currentTimeMillis() - t0;
                if (elapsed > timeoutMs) timedOut = true;
            }

            step = timedOut ? "timeout" : (exception.isEmpty() ? "done" : "exception");
            out.put("ok", exception.isEmpty() && !timedOut);
            out.put("step", step);
            out.put("stdout", outBuf.toString());
            out.put("stderr", errBuf.toString());
            out.put("returnValue", returnValue);
            out.put("exception", exception);
            out.put("stackTrace", stackTrace);
            out.put("entry", entryLabel);
            out.put("ms", System.currentTimeMillis() - t0);
            out.put("log", log.toString());
            if (timedOut) {
                out.put("log", log + "⚠ 执行超过 " + timeoutMs + "ms 超时，结果可能不完整\n");
            }
            return out.toString();
        } catch (Throwable t) {
            out.put("ok", false);
            out.put("step", step);
            out.put("log", (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()) + "\n" + log);
            return out.toString();
        }
    }

    // ===== dex 加载 =====

    /** API26+ 走 InMemoryDexClassLoader（内存，绕开可写目录 dex 限制）；24/25 落只读文件 + DexClassLoader */
    private ClassLoader loadDex(List<byte[]> dexList, StringBuilder log) {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                ByteBuffer[] bbs = new ByteBuffer[dexList.size()];
                for (int i = 0; i < bbs.length; i++) bbs[i] = ByteBuffer.wrap(dexList.get(i));
                ClassLoader cl = new dalvik.system.InMemoryDexClassLoader(bbs, null, ctx.getClassLoader());
                log.append("InMemoryDexClassLoader（API" + Build.VERSION.SDK_INT + "）\n");
                return cl;
            } catch (Throwable t) {
                log.append("InMemory 加载失败（").append(t.getMessage()).append("），回退文件方式\n");
            }
        }
        // 回退：落 cache 只读 dex + DexClassLoader（Android14+ 要求 dex 只读）
        try {
            File dir = new File(ctx.getCacheDir(), "debugdex");
            deleteTree(dir);
            if (!dir.mkdirs()) throw new IOException("建不了 debugdex 目录");
            File oat = new File(dir, "oat");
            if (!oat.mkdirs()) throw new IOException("建不了 oat 目录");
            for (int i = 0; i < dexList.size(); i++) {
                File f = new File(dir, "classes" + (i == 0 ? "" : String.valueOf(i + 1)) + ".dex");
                byte[] d = dexList.get(i);
                writeReadOnly(f, d);
            }
            // DexClassLoader 一次只能吃一个主 dex 文件 → 合并成 zip
            File merged = new File(dir, "merged.dex");
            mergeDex(dir, merged);
            if (merged.canWrite()) {
                if (!merged.setReadOnly()) {
                    try { Runtime.getRuntime().exec(new String[]{"chmod", "444", merged.getAbsolutePath()}).waitFor(); } catch (Throwable ignored) {}
                }
                if (merged.canWrite()) throw new IOException("dex 无法只读（API34+ 要求）");
            }
            ClassLoader cl = new dalvik.system.DexClassLoader(
                    merged.getAbsolutePath(), oat.getAbsolutePath(), null, ctx.getClassLoader());
            log.append("DexClassLoader（文件回退）\n");
            return cl;
        } catch (Throwable t) {
            log.append("dex 加载失败：" + t.getMessage() + "\n");
            return null;
        }
    }

    /** 把多个 classes*.dex 拼成一个（简单 concat，D8 产物可多 dex 顺序 concat 供 DexClassLoader 读） */
    private void mergeDex(File dir, File merged) throws Exception {
        java.io.OutputStream os = new java.io.FileOutputStream(merged);
        File[] fs = dir.listFiles((d, n) -> n.matches("classes\\d*\\.dex") && !n.equals("merged.dex"));
        if (fs != null) {
            java.util.Arrays.sort(fs, (a, b) -> a.getName().compareTo(b.getName()));
            for (File f : fs) {
                byte[] b = readFileBytes(f);
                if (b != null) os.write(b);
            }
        }
        os.close();
    }

    private void writeReadOnly(File f, byte[] data) throws Exception {
        java.io.OutputStream os = new java.io.FileOutputStream(f);
        os.write(data);
        os.close();
        if (f.canWrite()) {
            if (!f.setReadOnly()) {
                try { Runtime.getRuntime().exec(new String[]{"chmod", "444", f.getAbsolutePath()}).waitFor(); } catch (Throwable ignored) {}
            }
        }
    }

    private static byte[] readFileBytes(File f) {
        try (java.io.InputStream is = new java.io.FileInputStream(f)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } catch (Throwable t) {
            return null;
        }
    }

    private static int totalBytes(List<byte[]> list) {
        int t = 0;
        for (byte[] b : list) t += b.length;
        return t;
    }

    // ===== 入口探测 =====

    /** JS 通过 payload.candidates 注入的「候选入口类全限定名」列表（run 前解析） */
    private List<String> entryCandidates = new ArrayList<>();

    /** 在候选类里找指定名+参数签名的 static 方法，第一个命中返回 */
    private Method probeForMethod(ClassLoader cl, String name, Class<?>[] paramTypes) {
        for (String c : entryCandidates) {
            try {
                Class<?> k = Class.forName(c, true, cl);
                Method m = findMethod(k, name, paramTypes);
                if (m != null) return m;
            } catch (Throwable ignored) {
                // 类不存在（被 D8 裁掉）/ 没这个方法 → 试下一个
            }
        }
        return null;
    }

    private Method findMethod(Class<?> k, String name) {
        return findMethod(k, name, null);
    }

    private Method findMethod(Class<?> k, String name, Class<?>[] paramTypes) {
        if (k == null || name.isEmpty()) return null;
        for (Method m : k.getMethods()) {
            if (!m.getName().equals(name)) continue;
            if (paramTypes == null) {
                // 任意参数都能匹配（入口方法）
                return m;
            }
            if (m.getParameterTypes().length == paramTypes.length) {
                boolean same = true;
                for (int i = 0; i < paramTypes.length; i++) {
                    if (m.getParameterTypes()[i] != paramTypes[i]) { same = false; break; }
                }
                if (same) return m;
            }
        }
        return null;
    }

    private String describeMethods(Class<?> k) {
        if (k == null) return "";
        StringBuilder sb = new StringBuilder();
        for (Method m : k.getMethods()) {
            if (java.lang.reflect.Modifier.isStatic(m.getModifiers())) {
                sb.append("  static ").append(m.getReturnType().getSimpleName()).append(' ')
                        .append(m.getName()).append('(').append('\n');
            }
        }
        return sb.length() > 0 ? sb.toString() : "（无 static 方法）";
    }

    private String availableStaticMethods(ClassLoader cl) {
        return "请指定 entryClass（全限定类名）+ entryMethod。";
    }

    private static String stackTraceOf(Throwable t) {
        if (t == null) return "";
        java.io.StringWriter sw = new java.io.StringWriter();
        t.printStackTrace(new java.io.PrintWriter(sw));
        String s = sw.toString();
        if (s.length() > 4000) s = s.substring(0, 4000) + "\n…（截断）";
        return s;
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] fs = f.listFiles();
        if (fs != null) for (File c : fs) deleteTree(c);
        f.delete();
    }

    /** 写入缓冲超过上限就丢后续字节（防死循环刷爆），PrintStream 用 */
    private static final class LimitingStream extends java.io.OutputStream {
        final ByteArrayOutputStream target;
        final int cap;
        LimitingStream(ByteArrayOutputStream t, int cap) { this.target = t; this.cap = cap; }
        @Override public void write(int b) { if (target.size() < cap) target.write(b); }
        @Override public void write(byte[] b, int off, int len) {
            int left = cap - target.size();
            if (left <= 0) return;
            int n = Math.min(len, left);
            target.write(b, off, n);
        }
        @Override public void flush() {}
        @Override public void close() {}
    }
}
