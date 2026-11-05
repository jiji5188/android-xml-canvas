package com.jiji.axv;

import android.app.Activity;
import android.content.res.AssetManager;
import android.content.res.Resources;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Method;

/**
 * 小闭环第 1 步：在真 Android 里用「外部编译资源包」inflate 出真控件。
 *
 * 资源包来源：assets/www/preview-res.apk（由 foundation/build.mjs 用 aapt2 生成，package-id 0x80）
 * 加载方式：
 *   API 30+ → ResourcesProvider.loadFromApk(ParcelFileDescriptor) + ResourcesLoader + addLoaders
 *   API 24~29 → 反射 AssetManager.addAssetPath（同一份资源包，老系统兜底）
 * 然后 inflate 出 layout，交给系统真渲染 —— ripple / state_pressed 都是系统实现，不是 CSS 模拟。
 */
public class PreviewActivity extends Activity {

    private static final String TAG = "AXV-PREVIEW";
    private static final String RES_PKG = "com.axv.previewres";
    private static final String ASSET = "www/preview-res.apk";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(0xFFFFFFFF);

        String info;
        View inflated = null;
        try {
            File pkg = new File(getCacheDir(), "preview-res.apk");
            copyAsset(ASSET, pkg);
            int sdk = Build.VERSION.SDK_INT;
            String way;
            if (sdk >= 30) {
                loadWithResourcesLoader(pkg);
                way = "ResourcesLoader";
            } else {
                loadWithAssetManager(pkg);
                way = "AssetManager.addAssetPath(反射)";
            }
            Resources res = getResources();
            int layoutId = res.getIdentifier("preview", "layout", RES_PKG);
            int strId = res.getIdentifier("title", "string", RES_PKG);
            if (layoutId == 0) throw new IllegalStateException("拿不到 layout id（资源包没挂上？）");
            inflated = LayoutInflater.from(this)
                    .inflate(layoutId, page, false);
            info = "SDK " + sdk + " · " + way + "\n"
                    + "layoutId=0x" + Integer.toHexString(layoutId)
                    + "  title=" + (strId == 0 ? "?" : res.getString(strId))
                    + "\n资源包 " + pkg.length() + " 字节 · inflate OK\n"
                    + "下面就是系统真控件：按下去看状态切换和涟漪";
            Log.i(TAG, info);
        } catch (Throwable t) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            info = "加载失败：\n" + sw;
            Log.e(TAG, info);
        }

        TextView head = new TextView(this);
        head.setText(info);
        head.setTextSize(11);
        head.setPadding(dp(12), dp(12), dp(12), dp(8));
        ScrollView headScroll = new ScrollView(this);
        headScroll.addView(head);
        page.addView(headScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(150)));

        if (inflated != null) {
            ViewGroup host = new FrameLayout(this);
            host.addView(inflated, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            page.addView(host, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        }

        setContentView(page);
        Toast.makeText(this, "PreviewActivity 已启动", Toast.LENGTH_SHORT).show();
    }

    /** API 30+：公开 API，把外部 arsc/apk 挂到当前 Resources 上 */
    private void loadWithResourcesLoader(File pkg) throws Exception {
        ParcelFileDescriptor pfd = ParcelFileDescriptor.open(
                pkg, ParcelFileDescriptor.MODE_READ_ONLY);
        android.content.res.loader.ResourcesProvider provider =
                android.content.res.loader.ResourcesProvider.loadFromApk(pfd);
        android.content.res.loader.ResourcesLoader loader =
                new android.content.res.loader.ResourcesLoader();
        loader.addProvider(provider);
        getResources().addLoaders(loader);
    }

    /** API 24~29：反射调隐藏方法 addAssetPath（换肤引擎的常规做法） */
    private void loadWithAssetManager(File pkg) throws Exception {
        AssetManager am = getResources().getAssets();
        Method m = AssetManager.class.getMethod("addAssetPath", String.class);
        Object ret = m.invoke(am, pkg.getAbsolutePath());
        if (!(ret instanceof Integer) || (Integer) ret == 0) {
            throw new IllegalStateException("addAssetPath 返回 0");
        }
        // 让 Resources 重新走一遍（部分 ROM 需要）
        getResources().getDisplayMetrics();
    }

    private void copyAsset(String name, File dest) throws Exception {
        try (InputStream in = getAssets().open(name);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
