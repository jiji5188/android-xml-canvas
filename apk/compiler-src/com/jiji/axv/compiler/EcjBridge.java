package com.jiji.axv.compiler;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;

/**
 * EcjBridge —— 把 Eclipse 编译器（ECJ）包一层，供 Android 端反射调用。
 *
 * 为什么单独一个类走 DexClassLoader：
 *   本类编译时依赖 ecj.jar，运行时装在「编译器 classloader」里；App 自己的 dex 里没有 ECJ 的类，
 *   直接引用会 NoClassDefFoundError。所以主程序只用反射调本类，且参数/返回值只用 bootstrap 类
 *   （String / String[] / java.util.List），避免跨 classloader 的类型不匹配。
 *
 * 关键点：**不要调 Main.main()**，它会 System.exit 把整个 App 干掉。
 *   用 `new Main(out, err, false).compile(args)`，systemExitWhenFinished=false。
 */
public final class EcjBridge {

    private EcjBridge() {}

    /**
     * @param args ECJ 命令行参数（不含程序名），例如
     *             -source 11 -target 11 -nowarn -encoding UTF-8 -classpath a.jar -d out a.java
     * @param log  输出收集器（可为 null）
     * @return 编译是否成功（无 error）
     */
    public static boolean compile(String[] args, List<String> log) {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        boolean ok = false;
        try {
            org.eclipse.jdt.internal.compiler.batch.Main main =
                    new org.eclipse.jdt.internal.compiler.batch.Main(pw, pw, false);
            ok = main.compile(args);
            if (main.globalErrorsCount > 0) ok = false;
        } catch (Throwable t) {
            pw.println("ECJ 内部异常：" + t);
            ok = false;
        }
        pw.flush();
        if (log != null) {
            for (String line : sw.toString().split("\n")) {
                if (line != null && line.trim().length() > 0) log.add(line.replace("\r", ""));
            }
        }
        return ok;
    }

    /** 提前把 ECJ 类加载好，方便把「dex 加载失败」和「编译失败」区分开 */
    public static String version() {
        try {
            Class.forName("org.eclipse.jdt.internal.compiler.batch.Main");
            return "ecj ready";
        } catch (Throwable t) {
            return "ecj missing";
        }
    }
}
