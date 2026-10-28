package com.jiji.axv;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * M9 真机壳：把 /xml 静态导出包进 WebView。
 *
 * 为什么要在 app 内起一个本地 HTTP 服务，而不是直接 file:// 加载：
 * Next 的静态导出用绝对路径引用资源（/_next/...），file:// 下解析不到；
 * 起个 127.0.0.1 的极简静态服务器既能保住绝对路径，也能让 localStorage 正常工作。
 */
public class MainActivity extends Activity {
    private static final int PORT = 8731;
    private WebView web;
    private AssetServer server;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        try {
            server = new AssetServer(getAssets(), "www", PORT);
            server.start();
        } catch (Exception e) {
            server = null;
        }

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        setContentView(web);

        String url = "http://127.0.0.1:" + PORT + "/xml/" + (server == null ? "" : "");
        web.loadUrl(url);
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
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onDestroy();
    }
}
