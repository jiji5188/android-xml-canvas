package com.jiji.axv;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.Manifest;

import org.json.JSONArray;
import org.json.JSONObject;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * M9 真机壳 v3：WebView + shouldInterceptRequest 直接读 assets/www。
 *
 * v1（127.0.0.1 静态服务）在手机上白屏，v2 已改拦截方案；v3 在这基础上加
 * 自诊断：如果页面渲染完 body 还是空的，就把 WebView 版本 / UA / console 报错
 * 直接贴在屏幕上，不用连 USB 也能看到原因。
 */
public class MainActivity extends Activity {
    private static final String TAG = "AXV";
    private static final String HOST = "https://axv.local";
    private static final String ASSET_ROOT = "www";
    private static final int REQ_FILE = 1001;
    private static final int REQ_TREE = 1002;
    private static final int REQ_SAVE_TREE = 1003;
    /** 默认工作目录名（外存根下）：AndroidUIIDE/Project */
    private static final String DEFAULT_DIR = "AndroidUIIDE/Project";
    private static final String PREF = "axv";

    private Uri treeUri;
    /** M21：另存为时的待写内容（等用户在系统选择器里选完文件夹再写） */
    private String pendingBundleJson;
    private String pendingBundleName;

    private WebView web;
    private FrameLayout root;
    private TextView diag;
    private ScrollView diagScroll;
    private ValueCallback<Uri[]> fileCallback;
    private final StringBuilder logs = new StringBuilder();

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("htm", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("mjs", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("xml", "application/xml");
        MIME.put("txt", "text/plain");
        MIME.put("map", "application/json");
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        installCrashHandler();

        root = new FrameLayout(this);
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return serve(req.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req,
                                        android.webkit.WebResourceError err) {
                note("LOAD ERROR " + req.getUrl() + " -> " + err.getDescription());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // 页面渲染完还是一片空白时，把诊断信息直接显示出来。
                // 查两次：load 事件可能早于 React hydration，只查一次会误报。
                probe(0);
                view.postDelayed(() -> probe(1500), 1500);
            }

            private void probe(int delayOrFlag) {
                if (web == null) return;
                web.evaluateJavascript(
                        "(function(){try{"
                                + "var b=document.body;"
                                + "var t=b?b.innerText.trim():'';"
                                + "var ok=!!document.querySelector('.axv-phone, .axv-stage, .axv-editor');"
                                + "var js=document.querySelectorAll('script').length;"
                                + "return (ok?1:0)+'|'+t.length+'|'+(document.title||'')+'|'+js;"
                                + "}catch(e){return '-2|-2|'+e.message+'|0';}})()",
                        value -> {
                            String v = value == null ? "" : value.replace("\"", "");
                            String[] parts = v.split("\\|");
                            boolean rendered = parts.length > 0 && "1".equals(parts[0].trim());
                            note("probe(" + delayOrFlag + "): " + v);
                            if (!rendered && delayOrFlag != 0) {
                                showDiag("编辑器没有渲染出来（" + v + "）");
                            }
                        });
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                String line = m.message() + " @" + m.sourceId() + ":" + m.lineNumber();
                Log.d(TAG, "console: " + line);
                note(line);
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    startActivityForResult(Intent.createChooser(i, "选择 XML 文件"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        diag = new TextView(this);
        diag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        diag.setTextColor(Color.parseColor("#B3261E"));
        diag.setBackgroundColor(Color.parseColor("#FFF8F7"));
        diag.setPadding(24, 24, 24, 24);
        diag.setGravity(Gravity.TOP | Gravity.START);
        diag.setTextIsSelectable(true);

        // 只在 onCreate 里包一次 ScrollView，showDiag 只改文字/显隐。
        // （之前每次 showDiag 都新建 ScrollView 加 diag，diag 还挂在旧父级上 → 直接崩）
        diagScroll = new ScrollView(this);        diagScroll.addView(diag, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        diagScroll.setVisibility(android.view.View.GONE);

        root.addView(web);
        root.addView(diagScroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // 原生保存桥：网页里的导出走这里，不再靠 blob 下载（WebView 不支持）
        SharedPreferences sp = getSharedPreferences(PREF, MODE_PRIVATE);
        String savedTree = sp.getString("tree", null);
        if (savedTree != null) {
            try {
                treeUri = Uri.parse(savedTree);
            } catch (Throwable ignored) {
            }
        }
        web.addJavascriptInterface(new Bridge(), "AxvNative");

        String crash = readLastCrash();
        if (crash != null) {
            note("=== 上次崩溃 ===\n" + crash);
            showDiag("上次启动崩溃了，下面是堆栈");
            return;
        }

        if (!assetExists("xml/index.html")) {
            showDiag("APK 内缺少 www/xml/index.html");
            return;
        }
        web.loadUrl(HOST + "/xml/");
    }

    /** getAssets() 读 zip 失败会直接崩进程；包一层，把异常显示在屏幕上 */
    private boolean assetExists(String path) {
        try {
            InputStream is = getAssets().open(ASSET_ROOT + "/" + path);
            if (is != null) is.close();
            return true;
        } catch (Throwable t) {
            note("getAssets().open 异常: " + t);
            return false;
        }
    }

    private void note(String line) {
        if (logs.length() > 12000) logs.delete(0, logs.length() - 8000);
        logs.append(line).append('\n');
    }

    private void showDiag(String reason) {
        runOnUiThread(() -> {
            StringBuilder sb = new StringBuilder();
            sb.append(reason).append("\n\n");
            sb.append("Android ").append(Build.VERSION.RELEASE)
                    .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
            sb.append("WebView: ").append(webViewVersion()).append("\n");
            sb.append("网页: ").append(web.getUrl()).append("\n\n");
            sb.append("--- 日志 ---\n");
            sb.append(logs.length() == 0 ? "(无)" : logs.toString());
            diag.setText(sb.toString());
            diagScroll.setVisibility(android.view.View.VISIBLE);
            diagScroll.bringToFront();
        });
    }

    private String webViewVersion() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo pi = android.webkit.WebView.getCurrentWebViewPackage();
                return pi == null ? "未知" : pi.packageName + " " + pi.versionName;
            }
        } catch (Throwable ignored) {
        }
        return WebSettings.getDefaultUserAgent(this);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_TREE) {
            if (res == RESULT_OK && data != null && data.getData() != null) {
                treeUri = data.getData();
                int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try {
                    getContentResolver().takePersistableUriPermission(treeUri, flags);
                } catch (Throwable t) {
                    Log.w(TAG, "takePersistableUriPermission 失败: " + t);
                }
                getSharedPreferences(PREF, MODE_PRIVATE).edit()
                        .putString("tree", treeUri.toString()).apply();
                toast("工作目录：" + workspaceLabel());
            }
            return;
        }
        if (req == REQ_SAVE_TREE) {
            String json = pendingBundleJson;
            pendingBundleJson = null;
            if (res != RESULT_OK || data == null || data.getData() == null) {
                notifySaved("{\"ok\":false,\"canceled\":true,\"reason\":\"已取消\"}");
                return;
            }
            Uri target = data.getData();
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try {
                getContentResolver().takePersistableUriPermission(target, flags);
            } catch (Throwable ignored) {
            }
            try {
                org.json.JSONArray files = new org.json.JSONArray(json == null ? "[]" : json);
                org.json.JSONArray saved = new org.json.JSONArray();
                writeBundleToTree(target, files, saved);
                String label;
                try {
                    String id = DocumentsContract.getTreeDocumentId(target);
                    int slash = id.lastIndexOf(':');
                    label = slash >= 0 ? id.substring(slash + 1) : id;
                } catch (Throwable t) {
                    label = "所选文件夹";
                }
                toast("已保存 " + saved.length() + " 个文件到 " + label);
                notifySaved("{\"ok\":true,\"label\":\"" + esc(label) + "\",\"count\":" + saved.length() + "}");
            } catch (Throwable t) {
                Log.e(TAG, "saveBundle write fail", t);
                notifySaved("{\"ok\":false,\"reason\":\"" + esc(t.getMessage()) + "\"}");
            }
            return;
        }
        if (req == REQ_FILE) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[] { data.getData() };
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(out);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /** 把未捕获异常的堆栈写到私有目录，下次启动直接显示（没 adb 也能定位闪退） */
    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                java.io.StringWriter sw = new java.io.StringWriter();
                e.printStackTrace(new java.io.PrintWriter(sw));
                try (java.io.FileWriter w = new java.io.FileWriter(
                        new java.io.File(getFilesDir(), "last_crash.txt"))) {
                    w.write("thread: " + t.getName() + "\n" + sw);
                }
            } catch (Throwable ignored) {
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    private String readLastCrash() {
        try {
            java.io.File f = new java.io.File(getFilesDir(), "last_crash.txt");
            if (!f.exists()) return null;
            byte[] b = new byte[(int) f.length()];
            try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
                int off = 0, n;
                while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            }
            f.delete();
            return new String(b, "UTF-8");
        } catch (Throwable t) {
            return null;
        }
    }

    /** JS 桥：网页通过 window.AxvNative 调用 */
    public class Bridge {
        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                String where = writeToWorkspace(name, mime == null || mime.isEmpty() ? "application/octet-stream" : mime, data);
                toast("已保存：" + where);
                return "ok:" + where;
            } catch (Throwable t) {
                Log.e(TAG, "save fail", t);
                toast("保存失败：" + t.getMessage());
                return "err:" + t;
            }
        }

        /** M21：把文本写回原路径（content:// 或默认目录内的绝对路径） */
        @JavascriptInterface
        public String writeText(String target, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                if (target == null) return "err:target 为空";
                if (target.startsWith("content://")) {
                    try (OutputStream os = getContentResolver().openOutputStream(Uri.parse(target), "wt")) {
                        if (os == null) return "err:无法打开输出流";
                        os.write(data);
                    }
                    return "ok:" + target;
                }
                File f = new File(target);
                String base = defaultDir().getCanonicalPath();
                String canon = f.getCanonicalPath();
                if (!canon.startsWith(base)) return "err:超出工作目录";
                File parent = f.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                try (OutputStream os = new FileOutputStream(f)) {
                    os.write(data);
                }
                return "ok:" + canon;
            } catch (Throwable t) {
                Log.e(TAG, "writeText fail", t);
                return "err:" + t;
            }
        }

        /** M21：另存整包 —— 弹系统文件夹选择器（可新建文件夹），
         *  然后把 layout/drawable/values 一起写进去；完成后回调 JS：AxvNativeSaved(json) */
        @JavascriptInterface
        public void saveBundle(String name, String filesJson) {
            runOnUiThread(() -> startSaveBundle(name, filesJson));
        }

        @JavascriptInterface
        public String getWorkspace() {
            return workspaceLabel();
        }

        /** JS 侧复制文本（WebView 的 navigator.clipboard 不可靠，走原生 ClipboardManager） */
        @JavascriptInterface
        public String copyText(String text) {
            try {
                runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB) {
                            android.content.ClipData d = android.content.ClipData
                                    .newPlainText("axv", text == null ? "" : text);
                            android.content.ClipboardManager cm =
                                    (android.content.ClipboardManager) getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                            if (cm == null) throw new IOException("ClipboardManager 为空");
                            cm.setPrimaryClip(d);
                        } else {
                            android.text.ClipboardManager cm =
                                    (android.text.ClipboardManager) getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                            if (cm == null) throw new IOException("ClipboardManager 为空");
                            cm.setText(text == null ? "" : text);
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "copy fail", t);
                    }
                });
                return "ok";
            } catch (Throwable t) {
                Log.e(TAG, "copyText", t);
                return "err:" + t;
            }
        }

        @JavascriptInterface
        public void pickWorkspace() {
            runOnUiThread(MainActivity.this::chooseTree);
        }

        /** M19：触觉反馈。type 取值：long(30ms 长按) / toggle(15ms 开关·勾选·单选) / none。
         *  没有震动马达的设备静默忽略。在 JS 桥线程调用，需要自己切 UI 线程。 */
        @JavascriptInterface
        public void haptic(String type) {
            try {
                long ms = "long".equals(type) ? 30L : "toggle".equals(type) ? 15L : 0L;
                if (ms <= 0 || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
                android.view.View v = root;
                if (v == null || !v.isAttachedToWindow()) return;
                // performHapticFeedback 必须在 UI 线程
                runOnUiThread(() -> vibrateMs(ms));
            } catch (Throwable t) {
                Log.w(TAG, "haptic", t);
            }
        }

        /** 精确时长震动。API26+ 用 VibrationEffect 造一个「延迟0、震ms」的波形（最干净，
         *  不触发 deprecation 警告）；24–25 退化成系统标准时长；更低版本静默不震。 */
        private void vibrateMs(long ms) {
            if (Build.VERSION.SDK_INT < 24) return; // minSdk 是 24，这里防御一下
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(android.content.Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms, 200));
                } else {
                    // API24/25：createOneShot 也是 26 才有，用 vibrate(long)（deprecated 但可用）
                    v.vibrate(ms);
                }
            } catch (Throwable ignored) {}
        }

        /** 恢复内置默认目录（清掉自选文件夹） */
        @JavascriptInterface
        public void resetWorkspace() {
            runOnUiThread(() -> {
                treeUri = null;
                try {
                    getSharedPreferences(PREF, MODE_PRIVATE).edit().remove("tree").apply();
                } catch (Throwable ignored) {
                }
                toast("已恢复默认目录：AndroidUIIDE/Project");
            });
        }

        /* ===== 工作目录（M16i）===== */

        /** 内置默认工作目录：/AndroidUIIDE/Project（不存在会建出来） */
        @JavascriptInterface
        public String getDefaultWorkspace() {
            try {
                return defaultDir().getAbsolutePath();
            } catch (Throwable t) {
                return "";
            }
        }

        /** 当前生效目录 + 权限状态（JSON） */
        @JavascriptInterface
        public String getWorkspaceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("defaultPath", defaultDir().getAbsolutePath());
                o.put("custom", treeUri != null ? workspaceLabel() : JSONObject.NULL);
                o.put("effective", effectiveLabel());
                o.put("allFiles", hasAllFiles());
                o.put("sdk", Build.VERSION.SDK_INT);
                return o.toString();
            } catch (Throwable t) {
                return "{}";
            }
        }

        @JavascriptInterface
        public boolean hasAllFilesAccess() {
            return hasAllFiles();
        }

        /** 申请「所有文件访问权」（默认目录在根下，普通权限读不到） */
        @JavascriptInterface
        public void requestAllFilesAccess() {
            runOnUiThread(MainActivity.this::askAllFiles);
        }

        /** 列工作目录下的项目（JSON：{ok,dir,items:[{name,kind,rel,layoutCount,readable}]}） */
        @JavascriptInterface
        public String listProjects() {
            try {
                return listProjectsJson();
            } catch (Throwable t) {
                Log.e(TAG, "listProjects", t);
                return "{\"ok\":false,\"error\":\"" + t.getMessage() + "\"}";
            }
        }

        /** M30：只列**顶层**项目卡片（不递归整棵树）——面板轮询用这个，避免每个 final 都深扫 */
        @JavascriptInterface
        public String listTopProjects() {
            try {
                return listTopProjectsJson();
            } catch (Throwable t) {
                Log.e(TAG, "listTopProjects", t);
                return "{\"ok\":false,\"error\":\"" + t.getMessage() + "\"}";
            }
        }

        /** 读文本：支持绝对路径（限默认目录下）或 content:// URI */
        @JavascriptInterface
        public String readText(String target) {
            try {
                return readTextTarget(target);
            } catch (Throwable t) {
                Log.e(TAG, "readText", t);
                return null;
            }
        }
    }

    /* ================= M16i：工作目录 ================= */

    /** 默认工作目录：外存根目录下的 /AndroidUIIDE/Project */
    private File defaultDir() {
        File d = new File(Environment.getExternalStorageDirectory(), "AndroidUIIDE/Project");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private String effectiveLabel() {
        return treeUri != null ? workspaceLabel() : "AndroidUIIDE/Project";
    }

    private boolean hasAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                return Environment.isExternalStorageManager();
            } catch (Throwable t) {
                return false;
            }
        }
        return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void askAllFiles() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } else {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE,
                        Manifest.permission.READ_EXTERNAL_STORAGE}, 1003);
            }
        } catch (Throwable t) {
            toast("打不开权限设置：" + t.getMessage());
        }
    }

    /** 目录里 xml 的浅层数量（有 layout/ 就数 layout 里的） */
    private int countXml(File dir) {
        File layout = new File(dir, "layout");
        File scan = layout.isDirectory() ? layout : dir;
        File[] fs = scan.listFiles();
        if (fs == null) return 0;
        int n = 0;
        for (File f : fs) if (f.isFile() && f.getName().toLowerCase(Locale.ROOT).endsWith(".xml")) n++;
        return n;
    }

    private String listProjectsJson() throws Exception {
        JSONObject out = new JSONObject();
        JSONArray items = new JSONArray();
        out.put("ok", true);
        out.put("allFiles", hasAllFiles());

        if (treeUri != null) {
            out.put("dir", workspaceLabel());
            out.put("kind", "tree");
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            // M20n：递归列出（同 File 模式）
            collectTree(rootId, "", 0, items);
            out.put("items", items);
            return out.toString();
        }

        File d = defaultDir();
        out.put("dir", "AndroidUIIDE/Project");
        out.put("path", d.getAbsolutePath());
        out.put("kind", "file");
        // M20n：递归列出（安卓工程是 app/src/main/res/layout/xxx.xml 多层结构）
        collectFileTree(d, d, items, 0);
        out.put("items", items);
        return out.toString();
    }

    /* ================= M20n：工作目录多级列表 ================= */

    /** M30：只扫顶层（项目卡片用）——File 与 SAF 两种模式都只列一层 */
    private String listTopProjectsJson() throws Exception {
        JSONObject out = new JSONObject();
        JSONArray items = new JSONArray();
        out.put("ok", true);
        out.put("allFiles", hasAllFiles());

        if (treeUri != null) {
            out.put("dir", workspaceLabel());
            out.put("kind", "tree");
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            collectTreeTop(rootId, items, 0);
            out.put("items", items);
            return out.toString();
        }

        File d = defaultDir();
        out.put("dir", "AndroidUIIDE/Project");
        out.put("path", d.getAbsolutePath());
        out.put("kind", "file");
        File[] fs = d.listFiles();
        if (fs != null) {
            java.util.Arrays.sort(fs, (a, b) -> {
                if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.getName().compareToIgnoreCase(b.getName());
            });
            for (File f : fs) {
                String nm = f.getName().toLowerCase(Locale.ROOT);
                if (f.isHidden() || SKIP_DIRS.contains(nm)) continue;
                if (f.isDirectory()) {
                    int cnt = countXmlDeep(f, 0);
                    if (cnt == 0) continue;
                    JSONObject it = new JSONObject();
                    it.put("name", f.getName());
                    it.put("kind", "dir");
                    it.put("rel", f.getName());
                    it.put("layoutCount", cnt);
                    it.put("depth", 0);
                    it.put("path", f.getAbsolutePath());
                    File main = firstXmlDeep(f, 0);
                    if (main != null) it.put("mainPath", main.getAbsolutePath());
                    items.put(it);
                } else if (nm.endsWith(".xml")) {
                    JSONObject it = new JSONObject();
                    it.put("name", f.getName());
                    it.put("kind", "file");
                    it.put("rel", f.getName());
                    it.put("layoutCount", 1);
                    it.put("depth", 0);
                    it.put("path", f.getAbsolutePath());
                    items.put(it);
                }
            }
        }
        out.put("items", items);
        return out.toString();
    }

    /** SAF：只列根目录的直接子项 */
    private void collectTreeTop(String rootDocId, JSONArray out, int depth) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId);
        java.util.List<String[]> rows = new java.util.ArrayList<>();
        try (android.database.Cursor c = getContentResolver().query(children,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) rows.add(new String[]{c.getString(0), c.getString(1), c.getString(2)});
        }
        rows.sort((a, b) -> {
            boolean da = DocumentsContract.Document.MIME_TYPE_DIR.equals(a[2]);
            boolean db = DocumentsContract.Document.MIME_TYPE_DIR.equals(b[2]);
            if (da != db) return da ? -1 : 1;
            return (a[1] == null ? "" : a[1]).compareToIgnoreCase(b[1] == null ? "" : b[1]);
        });
        for (String[] row : rows) {
            String id = row[0];
            String name = row[1];
            String mime = row[2];
            if (name == null) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (SKIP_DIRS.contains(lower)) continue;
            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
            if (isDir) {
                int cnt = countXmlDeepTree(id, 0);
                if (cnt == 0) continue;
                JSONObject it = new JSONObject();
                it.put("name", name);
                it.put("kind", "dir");
                it.put("rel", name);
                it.put("layoutCount", cnt);
                it.put("depth", depth);
                it.put("docId", id);
                String mainDoc = firstXmlDocIdInTree(id);
                if (mainDoc != null) {
                    it.put("docUri", DocumentsContract.buildDocumentUriUsingTree(treeUri, mainDoc).toString());
                }
                out.put(it);
            } else if (lower.endsWith(".xml")) {
                JSONObject it = new JSONObject();
                it.put("name", name);
                it.put("kind", "file");
                it.put("rel", name);
                it.put("layoutCount", 1);
                it.put("depth", depth);
                it.put("docId", id);
                it.put("docUri", DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString());
                out.put(it);
            }
        }
    }
    /** 递归扫描时跳过的噪声目录 */
    private static final java.util.Set<String> SKIP_DIRS = new java.util.HashSet<>(java.util.Arrays.asList(
            ".git", ".gradle", ".idea", "build", "node_modules", ".svn", "__pycache__"));
    private static final int MAX_TREE_DEPTH = 6;

    /** 递归数 xml（含子目录） */
    private int countXmlDeep(File dir, int depth) {
        if (depth > MAX_TREE_DEPTH) return 0;
        File[] fs = dir.listFiles();
        if (fs == null) return 0;
        int n = 0;
        for (File f : fs) {
            String nm = f.getName().toLowerCase(Locale.ROOT);
            if (f.isHidden() || SKIP_DIRS.contains(nm)) continue;
            if (f.isDirectory()) n += countXmlDeep(f, depth + 1);
            else if (nm.endsWith(".xml")) n++;
        }
        return n;
    }

    /** 递归找「最像主布局」的 xml */
    private File firstXmlDeep(File dir, int depth) {
        if (depth > MAX_TREE_DEPTH) return null;
        File[] fs = dir.listFiles();
        if (fs == null) return null;
        File best = null;
        java.util.Arrays.sort(fs, (a, b) -> {
            if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.getName().compareToIgnoreCase(b.getName());
        });
        for (File f : fs) {
            String nm = f.getName().toLowerCase(Locale.ROOT);
            if (f.isHidden() || SKIP_DIRS.contains(nm)) continue;
            if (f.isDirectory()) {
                File sub = firstXmlDeep(f, depth + 1);
                if (sub != null) return sub;
            } else if (nm.endsWith(".xml")) {
                if (best == null) best = f;
                if (nm.equals("activity_main.xml") || nm.equals("main.xml")) return f;
            }
        }
        return best;
    }

    private String relOf(File root, File f) {
        return root.toURI().relativize(f.toURI()).getPath();
    }

    private void collectFileTree(File root, File dir, JSONArray out, int depth) throws Exception {
        if (depth > MAX_TREE_DEPTH) return;
        File[] fs = dir.listFiles();
        if (fs == null) return;
        java.util.Arrays.sort(fs, (a, b) -> {
            if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.getName().compareToIgnoreCase(b.getName());
        });
        for (File f : fs) {
            String nm = f.getName().toLowerCase(Locale.ROOT);
            if (f.isHidden() || SKIP_DIRS.contains(nm)) continue;
            if (f.isDirectory()) {
                int cnt = countXmlDeep(f, 0);
                if (cnt == 0) continue;
                JSONObject it = new JSONObject();
                it.put("name", f.getName());
                it.put("kind", "dir");
                it.put("rel", relOf(root, f));
                it.put("layoutCount", cnt);
                it.put("depth", depth);
                it.put("path", f.getAbsolutePath());
                File main = firstXmlDeep(f, 0);
                if (main != null) it.put("mainPath", main.getAbsolutePath());
                out.put(it);
                collectFileTree(root, f, out, depth + 1);
            } else if (nm.endsWith(".xml")) {
                JSONObject it = new JSONObject();
                it.put("name", f.getName());
                it.put("kind", "file");
                it.put("rel", relOf(root, f));
                it.put("layoutCount", 1);
                it.put("depth", depth);
                it.put("path", f.getAbsolutePath());
                out.put(it);
            }
        }
    }

    /** SAF tree 模式：递归数 xml */
    private int countXmlDeepTree(String dirDocId, int depth) {
        if (depth > MAX_TREE_DEPTH) return 0;
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
            int n = 0;
            java.util.List<String[]> dirs = new java.util.ArrayList<>();
            try (android.database.Cursor c = getContentResolver().query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c == null) return 0;
                while (c.moveToNext()) {
                    String id = c.getString(0);
                    String name = c.getString(1);
                    String mime = c.getString(2);
                    boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                    String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
                    if (SKIP_DIRS.contains(lower)) continue;
                    if (isDir) dirs.add(new String[]{id});
                    else if (lower.endsWith(".xml")) n++;
                }
            }
            for (String[] dId : dirs) n += countXmlDeepTree(dId[0], depth + 1);
            return n;
        } catch (Throwable t) {
            return 0;
        }
    }

    private void collectTree(String parentDocId, String prefix, int depth, JSONArray out) throws Exception {
        if (depth > MAX_TREE_DEPTH) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        java.util.List<String[]> rows = new java.util.ArrayList<>();
        try (android.database.Cursor c = getContentResolver().query(children,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) rows.add(new String[]{c.getString(0), c.getString(1), c.getString(2)});
        }
        rows.sort((a, b) -> {
            boolean da = DocumentsContract.Document.MIME_TYPE_DIR.equals(a[2]);
            boolean db = DocumentsContract.Document.MIME_TYPE_DIR.equals(b[2]);
            if (da != db) return da ? -1 : 1;
            return (a[1] == null ? "" : a[1]).compareToIgnoreCase(b[1] == null ? "" : b[1]);
        });
        for (String[] row : rows) {
            String id = row[0];
            String name = row[1];
            String mime = row[2];
            if (name == null) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (SKIP_DIRS.contains(lower)) continue;
            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
            if (isDir) {
                int cnt = countXmlDeepTree(id, 0);
                if (cnt == 0) continue;
                JSONObject it = new JSONObject();
                it.put("name", name);
                it.put("kind", "dir");
                it.put("rel", prefix + name);
                it.put("layoutCount", cnt);
                it.put("depth", depth);
                it.put("docId", id);
                String mainDoc = firstXmlDocIdInTree(id);
                if (mainDoc != null) {
                    it.put("docUri", DocumentsContract.buildDocumentUriUsingTree(treeUri, mainDoc).toString());
                }
                out.put(it);
                collectTree(id, prefix + name + "/", depth + 1, out);
            } else if (lower.endsWith(".xml")) {
                JSONObject it = new JSONObject();
                it.put("name", name);
                it.put("kind", "file");
                it.put("rel", prefix + name);
                it.put("layoutCount", 1);
                it.put("depth", depth);
                it.put("docId", id);
                it.put("docUri", DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString());
                out.put(it);
            }
        }
    }

    /** tree 模式下一个子目录里的 xml 数（尽力而为，失败就是 0） */
    private int countXmlInTree(String dirDocId) {
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
            int n = 0;
            try (android.database.Cursor c = getContentResolver().query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String name = c.getString(0);
                        String mime = c.getString(1);
                        if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)
                                && name != null && name.toLowerCase(Locale.ROOT).endsWith(".xml")) n++;
                    }
                }
            }
            return n;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** 目录里第一个 xml（优先 layout/ 子目录，优先 activity_main） */
    private File firstXmlIn(File dir) {
        File layout = new File(dir, "layout");
        File scan = layout.isDirectory() ? layout : dir;
        File[] fs = scan.listFiles();
        if (fs == null) return null;
        File best = null;
        for (File f : fs) {
            if (!f.isFile() || !f.getName().toLowerCase(Locale.ROOT).endsWith(".xml")) continue;
            if (best == null) best = f;
            String n = f.getName().toLowerCase(Locale.ROOT);
            if (n.equals("activity_main.xml") || n.equals("main.xml")) return f;
        }
        return best;
    }

    /** tree 模式下第一个 xml 的 documentId（dir 或其 layout/ 子目录） */
    private String firstXmlDocIdInTree(String dirDocId) {
        String direct = firstChildXml(dirDocId);
        if (direct != null) return direct;
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
            try (android.database.Cursor c = getContentResolver().query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                        String name = c.getString(1);
                        if (name != null && name.equalsIgnoreCase("layout")) return firstChildXml(c.getString(0));
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private String firstChildXml(String dirDocId) {
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
            String best = null;
            try (android.database.Cursor c = getContentResolver().query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                        String name = c.getString(1);
                        if (name == null || !name.toLowerCase(Locale.ROOT).endsWith(".xml")) continue;
                        if (best == null) best = c.getString(0);
                        String n = name.toLowerCase(Locale.ROOT);
                        if (n.equals("activity_main.xml") || n.equals("main.xml")) return c.getString(0);
                    }
                }
            }
            return best;
        } catch (Throwable t) {
            return null;
        }
    }

    private String readTextTarget(String target) throws IOException {
        if (target == null) return null;
        if (target.startsWith("content://")) {
            try (InputStream in = getContentResolver().openInputStream(Uri.parse(target))) {
                if (in == null) return null;
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                return new String(bo.toByteArray(), "UTF-8");
            }
        }
        File f = new File(target);
        String base = defaultDir().getCanonicalPath();
        if (!f.getCanonicalPath().startsWith(base)) return null;
        if (!f.isFile()) return null;
        try (InputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), "UTF-8");
        }
    }

    private void toast(String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {
            }
        });
    }

    /** 打开系统文件夹选择器（ACTION_OPEN_DOCUMENT_TREE） */
    private void chooseTree() {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(i, REQ_TREE);
        } catch (Throwable t) {
            toast("打开文件夹选择器失败：" + t.getMessage());
        }
    }

    private String workspaceLabel() {
        if (treeUri != null) {
            try {
                String id = DocumentsContract.getTreeDocumentId(treeUri);
                int slash = id.lastIndexOf(':');
                String tail = slash >= 0 ? id.substring(slash + 1) : id;
                return tail.isEmpty() ? "已选择的文件夹" : tail;
            } catch (Throwable ignored) {
                return "已选择的文件夹";
            }
        }
        return "AndroidUIIDE/Project";
    }

    /* ================= M21：另存为（选文件夹 + 一并写依赖） ================= */

    private void startSaveBundle(String name, String filesJson) {
        try {
            pendingBundleName = name;
            pendingBundleJson = filesJson;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(i, REQ_SAVE_TREE);
        } catch (Throwable t) {
            Log.e(TAG, "saveBundle picker fail", t);
            pendingBundleJson = null;
            pendingBundleName = null;
            notifySaved("{\"ok\":false,\"reason\":\"打不开文件夹选择器：" + esc(t.getMessage()) + "\"}");
        }
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "/").replace("\"", "'").replace("\n", " ");
    }

    private void notifySaved(String json) {
        try {
            final String js = "window.AxvNativeSaved && window.AxvNativeSaved(" + json + ");";
            if (web != null) web.post(() -> web.evaluateJavascript(js, null));
        } catch (Throwable ignored) {
        }
    }

    /** 在 tree 里按相对路径（a/b/c.xml）建目录 + 写文件 */
    private void writeBundleToTree(Uri tree, org.json.JSONArray files, org.json.JSONArray saved) throws Exception {
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        Uri rootDoc = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
        for (int i = 0; i < files.length(); i++) {
            org.json.JSONObject f = files.getJSONObject(i);
            String rel = f.getString("path");
            byte[] data = Base64.decode(f.getString("base64"), Base64.DEFAULT);
            String mime = f.optString("mime", "application/xml");
            String[] parts = rel.split("/");
            Uri dir = rootDoc;
            for (int k = 0; k < parts.length - 1; k++) dir = ensureChildDir(tree, dir, parts[k]);
            String fileName = parts[parts.length - 1];
            Uri out = ensureChildFile(tree, dir, parts[parts.length - 1], mime);
            if (out == null) throw new IOException("无法创建 " + fileName);
            try (OutputStream os = getContentResolver().openOutputStream(out, "wt")) {
                if (os == null) throw new IOException("无法写入 " + fileName);
                os.write(data);
            }
            saved.put(rel);
        }
    }

    private Uri ensureChildDir(Uri tree, Uri parentDoc, String name) throws Exception {
        Uri child = findChild(tree, parentDoc, name, true);
        if (child != null) return child;
        Uri created = DocumentsContract.createDocument(
                getContentResolver(), parentDoc, DocumentsContract.Document.MIME_TYPE_DIR, name);
        if (created == null) throw new IOException("建目录失败：" + name);
        return created;
    }

    private Uri ensureChildFile(Uri tree, Uri parentDoc, String name, String mime) throws Exception {
        Uri child = findChild(tree, parentDoc, name, false);
        if (child != null) return child;
        return DocumentsContract.createDocument(getContentResolver(), parentDoc, mime, name);
    }

    /** 在 parentDoc 下按名字找子项；wantDir 决定只要目录还是只要文件 */
    private Uri findChild(Uri tree, Uri parentDoc, String name, boolean wantDir) {
        try {
            String parentId = DocumentsContract.getDocumentId(parentDoc);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
            String[] proj = new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE};
            try (android.database.Cursor c = getContentResolver().query(children, proj, null, null, null)) {
                if (c == null) return null;
                while (c.moveToNext()) {
                    String nm = c.getString(1);
                    if (nm == null || !nm.equalsIgnoreCase(name)) continue;
                    boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2));
                    if (isDir != wantDir) continue;
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /** 写文件：优先用户选的文件夹，否则存到「AndroidUIIDE/Project」 */
    private String writeToWorkspace(String name, String mime, byte[] data) throws IOException {
        String safe = sanitize(name);

        if (treeUri != null) {
            try {
                Uri docDir = DocumentsContract.buildDocumentUriUsingTree(
                        treeUri, DocumentsContract.getTreeDocumentId(treeUri));
                Uri created = DocumentsContract.createDocument(
                        getContentResolver(), docDir, mime, safe);
                if (created == null) throw new IOException("createDocument 返回空");
                try (OutputStream os = getContentResolver().openOutputStream(created)) {
                    if (os == null) throw new IOException("无法打开输出流");
                    os.write(data);
                }
                return workspaceLabel() + "/" + safe;
            } catch (Throwable t) {
                Log.w(TAG, "写自选文件夹失败，回退默认目录: " + t);
            }
        }

        // M16i：默认目录在存储根下，拿到「所有文件访问」就直接写文件（真实路径，文件管理器可见）
        if (hasAllFiles()) {
            try {
                File dir = defaultDir();
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, safe);
                try (OutputStream os = new FileOutputStream(out)) {
                    os.write(data);
                }
                return "AndroidUIIDE/Project/" + safe;
            } catch (Throwable t) {
                Log.w(TAG, "写根目录失败，回退 MediaStore: " + t);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + DEFAULT_DIR);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("MediaStore 插入失败");
            try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                if (os == null) throw new IOException("无法打开输出流");
                os.write(data);
            }
            return "下载/" + DEFAULT_DIR + "/" + safe;
        }

        // Android 9 及以下：直接写公共下载目录
        File dir = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), DEFAULT_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录 " + dir);
        File out = new File(dir, safe);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(data);
        }
        return "下载/" + DEFAULT_DIR + "/" + safe;
    }

    /** 去掉路径分隔符等危险字符 */
    private static String sanitize(String name) {
        String s = name == null ? "export" : name;
        s = s.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (s.length() > 120) s = s.substring(0, 120);
        return s.isEmpty() ? "export" : s;
    }

    /** 把请求 URL 映射到 assets/www 下的文件 */
    private WebResourceResponse serve(Uri url) {
        String host = url.getHost() == null ? "" : url.getHost();
        String path = url.getPath();
        if (path == null || path.isEmpty()) path = "/";

        // 外部域名（Google Fonts 之类）：返回空响应，别让它 404/悬挂
        if (!host.isEmpty() && !"axv.local".equals(host) && !HOST.endsWith(host)) {
            note("EXT " + host + path);
            String mime = path.endsWith(".css") || path.contains("css2") ? "text/css" : "text/plain";
            WebResourceResponse empty = new WebResourceResponse(mime, "utf-8",
                    new ByteArrayInputStream(new byte[0]));
            return empty;
        }

        String asset = resolveAsset(path);
        if (asset == null) {
            Log.w(TAG, "404 " + path);
            note("404 " + path);
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream("404".getBytes()));
        }
        note("200 " + path);
        try {
            InputStream is = getAssets().open(ASSET_ROOT + "/" + asset);
            String mime = mimeOf(asset);
            String charset = isText(mime) ? "utf-8" : null;
            WebResourceResponse resp = new WebResourceResponse(mime, charset, is);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            resp.setResponseHeaders(h);
            return resp;
        } catch (Throwable e) {
            note("read fail: " + asset + " " + e);
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream(("500 " + asset).getBytes()));
        }
    }

    private String resolveAsset(String path) {
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (p.contains("..")) return null;
        String[] candidates;
        if (p.isEmpty()) {
            candidates = new String[] { "index.html" };
        } else if (p.endsWith("/")) {
            candidates = new String[] { p + "index.html" };
        } else {
            candidates = new String[] { p, p + "/index.html", p + ".html" };
        }
        for (String c : candidates) {
            if (assetExists(c)) return c;
        }
        return null;
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")
                || mime.contains("xml") || mime.contains("svg");
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
