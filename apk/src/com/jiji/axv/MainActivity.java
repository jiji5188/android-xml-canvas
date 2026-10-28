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
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
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
    /** 默认工作目录：手机「下载」下的这个子目录（文件管理器里能直接看到） */
    private static final String DEFAULT_DIR = "XML画板";
    private static final String PREF = "axv";

    private Uri treeUri;

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
        return "下载/" + DEFAULT_DIR;
    }

    /** 写文件：优先用户选的文件夹，否则存到「下载/XML画板」 */
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
