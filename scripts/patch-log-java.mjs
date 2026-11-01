// A 方案：性能日志通道（Java 端追加写文件 + JS 埋点）
//
// 设计要点：
//  - 日志落 AndroidUIIDE/log/，自动建目录；按天一个文件 perf-YYYYMMDD.log
//  - 全部异步：写文件在后台单线程队列里跑，绝不阻塞 JS / UI 线程
//  - 队列有界（满则丢弃并计数），避免日志本身把内存吃爆
//  - 单文件超过 2MB 自动换新文件（perf-YYYYMMDD-2.log）
import fs from "node:fs";
const path = "apk/src/com/jiji/axv/MainActivity.java";
let src = fs.readFileSync(path, "utf8");

const ANCHOR = `        /** M56：listProjects 深扫走后台线程（同步版保留给老调用，JS 端有 hasListProjectsAsync 时优先用异步） */`;

const LOG_BLOCK = `        /* ===== M59：性能日志（AndroidUIIDE/log/perf-*.log）=====
         * 为什么要日志文件而不是只在 logcat：手机上看不了 logcat，用户能直接把文件导出来。
         * 全部后台线程 + 有界队列，绝不阻塞 JS / UI 线程。 */
        private static final int LOG_QUEUE_MAX = 2000;
        private static final long LOG_FILE_MAX = 2L * 1024 * 1024;
        private final java.util.ArrayDeque<String> logQueue = new java.util.ArrayDeque<>();
        private volatile boolean logWorkerRunning = false;
        private volatile int logDropped = 0;
        private volatile File logDirCache = null;

        /** JS 端埋点入口：asyncLog(tag, msg)，一行一条，自动带时间戳 */
        @JavascriptInterface
        public void asyncLog(final String tag, final String msg) {
            try {
                String t = new java.text.SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new java.util.Date());
                enqueueLog(t + " [" + (tag == null ? "-" : tag) + "] " + (msg == null ? "" : msg));
            } catch (Throwable ignored) {
            }
        }

        /** 立即把内存里 JS 的日志刷出来（导出前调用） */
        @JavascriptInterface
        public String logPath() {
            File f = currentLogFile();
            return f == null ? "" : f.getAbsolutePath();
        }

        /** 清空当天日志（调试用） */
        @JavascriptInterface
        public void clearLog() {
            try {
                File d = logDir();
                if (d == null) return;
                File[] fs = d.listFiles();
                if (fs == null) return;
                for (File f : fs) {
                    if (f.getName().startsWith("perf-")) f.delete();
                }
            } catch (Throwable ignored) {
            }
        }

        private File logDir() {
            if (logDirCache != null) return logDirCache;
            try {
                File base = new File(Environment.getExternalStorageDirectory(), "AndroidUIIDE");
                File d = new File(base, "log");
                if (!d.exists()) d.mkdirs();
                logDirCache = d;
                return d;
            } catch (Throwable t) {
                Log.e(TAG, "logDir", t);
                return null;
            }
        }

        private File currentLogFile() {
            File d = logDir();
            if (d == null) return null;
            String day = new java.text.SimpleDateFormat("yyyyMMdd", Locale.US).format(new java.util.Date());
            for (int i = 1; i <= 99; i++) {
                String nm = i == 1 ? "perf-" + day + ".log" : "perf-" + day + "-" + i + ".log";
                File f = new File(d, nm);
                if (!f.exists() || f.length() < LOG_FILE_MAX) return f;
            }
            return new File(d, "perf-" + day + ".log");
        }

        private void enqueueLog(String line) {
            if (line == null) return;
            synchronized (logQueue) {
                if (logQueue.size() >= LOG_QUEUE_MAX) {
                    logDropped++;
                    return;
                }
                logQueue.addLast(line);
            }
            startLogWorker();
        }

        private void startLogWorker() {
            if (logWorkerRunning) return;
            synchronized (logQueue) {
                if (logWorkerRunning) return;
                logWorkerRunning = true;
            }
            Thread t = new Thread(new Runnable() {
                @Override
                public void run() {
                    StringBuilder sb = new StringBuilder(8192);
                    int n = 0;
                    while (true) {
                        synchronized (logQueue) {
                            String line = logQueue.pollFirst();
                            if (line == null) {
                                logWorkerRunning = false;
                                break;
                            }
                            sb.append(line).append('\\n');
                            n++;
                            // 攒一批再写，减少 IO 次数
                            if (n < 64 && logQueue.size() > 0) continue;
                        }
                        flushLog(sb, logDropped);
                        logDropped = 0;
                        sb.setLength(0);
                        n = 0;
                    }
                }
            }, "axv-log");
            t.setDaemon(true);
            t.start();
        }

        private void flushLog(StringBuilder sb, int dropped) {
            if (sb.length() == 0) return;
            File f = currentLogFile();
            if (f == null) return;
            java.io.FileOutputStream out = null;
            try {
                out = new java.io.FileOutputStream(f, true);
                if (dropped > 0) sb.append("(日志队列满，丢弃 ").append(dropped).append(" 条)\\n");
                out.write(sb.toString().getBytes("UTF-8"));
                out.flush();
            } catch (Throwable t) {
                Log.e(TAG, "flushLog", t);
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (Throwable ignored) {
                    }
                }
            }
        }

${ANCHOR}`;

if (!src.includes(ANCHOR)) {
  console.error("锚点没找到，退出");
  process.exit(1);
}
if (src.includes("M59：性能日志")) {
  console.log("已经加过了，跳过");
  process.exit(0);
}
src = src.replace(ANCHOR, LOG_BLOCK);
fs.writeFileSync(path, src, "utf8");
console.log("已插入日志通道，文件行数:", src.split("\n").length);
