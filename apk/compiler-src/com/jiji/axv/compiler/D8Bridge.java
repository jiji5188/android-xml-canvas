package com.jiji.axv.compiler;

import java.util.List;

/**
 * D8Bridge —— 把 D8（com.android.tools.r8）包一层，供 Android 端反射调用。
 *
 * 同 EcjBridge：本类依赖 d8.jar，只装在「编译器 classloader」里，主程序靠反射调用，
 * 参数/返回值只用 bootstrap 类型。
 *
 * 关键点：**不要调 D8.main()**（出错/结束会 System.exit）。
 *   用 `D8Command.parse(args, Origin.unknown())` + `D8.run(command)`，异常自己接。
 */
public final class D8Bridge {

    private D8Bridge() {}

    /**
     * @param args D8 命令行参数，例如
     *             --release --min-api 24 --lib android.jar --output outdir classes/
     * @param log  输出收集器（可为 null）
     * @return 是否成功
     */
    public static boolean dex(String[] args, List<String> log) {
        try {
            com.android.tools.r8.D8Command.Builder b =
                    com.android.tools.r8.D8Command.parse(args, com.android.tools.r8.origin.Origin.unknown());
            com.android.tools.r8.D8.run(b.build());
            return true;
        } catch (Throwable t) {
            if (log != null) {
                log.add("D8 失败：" + t);
                Throwable c = t.getCause();
                int guard = 0;
                while (c != null && guard++ < 4) {
                    log.add("  由 " + c);
                    c = c.getCause();
                }
            }
            return false;
        }
    }

    public static String version() {
        try {
            Class.forName("com.android.tools.r8.Version");
            return "d8 ready";
        } catch (Throwable t) {
            return "d8 missing";
        }
    }
}
