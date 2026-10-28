package com.jiji.axv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * M9 真机壳 v2：WebView + shouldInterceptRequest 直接读 APK 里的 assets。
 *
 * v1 用的是「在 App 内起 127.0.0.1 静态服务」，在部分机器上白屏（socket/端口不可靠），
 * 改成拦截请求：不建 socket、不占端口、不走网络，所有 /_next/... 绝对路径照样能解析，
 * https 假域名也给 localStorage 一个稳定的 origin（不然 file:// 下存不住东西）。
 */
public class MainActivity extends Activity {
    private static final String TAG = "AXV";
    private static final String HOST = "https://axv.local";
    private static final String ASSET_ROOT = "www";
    private static final int REQ_FILE = 1001;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

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

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
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
        // 让页面按手机真实宽度排版，否则设备下拉的「桌面三栏」判断会错
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return serve(req.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest req,
                                        android.webkit.WebResourceError err) {
                Log.e(TAG, "load error: " + req.getUrl() + " -> " + err.getDescription());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "console: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }

            // 让「打开 XML 文件」能弹出系统文件选择器
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

        setContentView(web);

        // 包一层容错：万一 assets 里没有 xml/index.html，至少能看到提示而不是白屏
        if (!assetExists("xml/index.html")) {
            web.loadData("<h3 style='font-family:sans-serif'>APK 内缺少 www/xml/index.html</h3>",
                    "text/html", "utf-8");
            return;
        }
        web.loadUrl(HOST + "/xml/");
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
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

    /** 把请求 URL 映射到 assets/www 下的文件 */
    private WebResourceResponse serve(Uri url) {
        String path = url.getPath();
        if (path == null || path.isEmpty()) path = "/";

        String asset = resolveAsset(path);
        if (asset == null) {
            Log.w(TAG, "404 " + path);
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream("404".getBytes()));
        }
        try {
            InputStream is = getAssets().open(ASSET_ROOT + "/" + asset);
            String mime = mimeOf(asset);
            // 只有文本类才声明 charset；图片/字体传 charset 会让 WebView 解析异常
            String charset = isText(mime) ? "utf-8" : null;
            WebResourceResponse resp = new WebResourceResponse(mime, charset, is);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            resp.setResponseHeaders(h);
            return resp;
        } catch (IOException e) {
            Log.e(TAG, "read fail: " + asset + " " + e.getMessage());
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream(("500 " + asset).getBytes()));
        }
    }

    /** /xml/ → xml/index.html；/x.js → x.js；找不到返回 null */
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

    private boolean assetExists(String path) {
        try (InputStream is = getAssets().open(ASSET_ROOT + "/" + path)) {
            return is != null;
        } catch (IOException e) {
            return false;
        }
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
