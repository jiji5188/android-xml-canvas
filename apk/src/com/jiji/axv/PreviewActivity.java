package com.jiji.axv;

import android.app.Activity;
import android.content.Context;
import android.content.res.AssetManager;
import android.content.res.Resources;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.util.AttributeSet;
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

    /** M154：真机渲染包（由 MainActivity 用设备上的 aapt2 现场编译）传进来的参数 */
    private String pkgName = RES_PKG;
    private String layoutName = "preview";
    private String apkPath = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // M154：外部传参优先；没传就是内置那个 demo 资源包（M151/M152 的老路径）
        if (getIntent() != null) {
            String p = getIntent().getStringExtra("pkg");
            String l = getIntent().getStringExtra("layout");
            String a = getIntent().getStringExtra("apk");
            if (p != null && !p.isEmpty()) pkgName = p;
            if (l != null && !l.isEmpty()) layoutName = l;
            if (a != null && !a.isEmpty()) apkPath = a;
        }
        final boolean builtin = RES_PKG.equals(pkgName);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(0xFFFFFFFF);

        String info;
        View inflated = null;
        try {
            File pkg;
            if (apkPath != null) {
                pkg = new File(apkPath);
                if (!pkg.isFile()) throw new IllegalStateException("资源包不存在: " + apkPath);
            } else {
                pkg = new File(getCacheDir(), "preview-res.apk");
                copyAsset(ASSET, pkg);
            }
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
            int layoutId = res.getIdentifier(layoutName, "layout", pkgName);
            int strId = res.getIdentifier("title", "string", pkgName);
            if (layoutId == 0) throw new IllegalStateException("拿不到 layout id（资源包没挂上？）");
            inflated = inflateWithFallback(layoutId, page);
            // M152：clip / scale 的 level 只能在运行时给（XML 里压根没这个属性），
            // 不设就是 0：clip 完全空白、scale 缩到最小。各给 5000 看“一半”。
            if (builtin) {
                setBgLevel(inflated, res, "wrap_clip_view", 5000);
                setBgLevel(inflated, res, "wrap_scale_view", 5000);
            }
            info = "SDK " + sdk + " · " + way + "\n"
                    + "layoutId=0x" + Integer.toHexString(layoutId)
                    + "  title=" + (strId == 0 ? "?" : res.getString(strId))
                    + "\n资源包 " + pkg.length() + " 字节 · inflate OK"
                    + (stubCount > 0 ? "（" + stubCount + " 个第三方控件用平台控件代替）" : "")
                    + "\n下面就是系统真控件：按下去看状态切换和涟漪";
            Log.i(TAG, info);
        } catch (Throwable t) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            info = "加载失败：\n" + sw;
            Log.e(TAG, info);
        }
        // M154：真机渲染时把调试头收起来（标题/失败信息才保留）；旧的内置 demo 维持原样
        final boolean showHead = inflated == null || builtin;
        if (showHead) {
            // M151 自检：跑一遍 aapt2 version，确认 native 库能执行
            try {
                File bin = new File(getApplicationInfo().nativeLibraryDir, "libaapt2.so");
                File work = new File(getCacheDir(), "aapt2-work");
                if (!work.exists() && !work.mkdirs()) work = getCacheDir();
                ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath(), "version")
                        .directory(work).redirectErrorStream(true);
                pb.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
                Process p = pb.start();
                String out = new String(p.getInputStream().readAllBytes()).trim();
                int code = p.waitFor();
                info += "\n\naapt2 自检: exit=" + code + " " + out;
            } catch (Throwable t) {
                info += "\n\naapt2 自检失败: " + t;
                Log.e(TAG, "aapt2 self-check failed", t);
            }

            TextView head = new TextView(this);
            head.setText(info);
            head.setTextSize(11);
            head.setPadding(dp(12), dp(12), dp(12), dp(8));
            ScrollView headScroll = new ScrollView(this);
            headScroll.addView(head);
            page.addView(headScroll, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(150)));
        }

        if (inflated != null) {
            ViewGroup host = new FrameLayout(this);
            host.addView(inflated, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            page.addView(host, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        }

        setContentView(page);
        Toast.makeText(this, builtin ? "PreviewActivity 已启动" : "真渲染预览（aapt2 现场编译）", Toast.LENGTH_SHORT).show();
    }

    /** M152：按资源包里的 id 名找到 View，给它的背景 Drawable 设 level */
    /** M159：第三方控件（MaterialCardView / androidx…）不在这个 APK 的 classpath 里，
     *  正常 inflate 会 ClassNotFoundException。首次失败后挂一个 Factory2，
     *  按名字找平台类；找不到就用最接近的平台控件代替（FrameLayout / TextView …），
     *  这样至少能看到真机布局和资源，而不是一片“加载失败”。*/
    private int stubCount = 0;

    private View inflateWithFallback(int layoutId, ViewGroup parent) {
        LayoutInflater base = LayoutInflater.from(this);
        try {
            return base.inflate(layoutId, parent, false);
        } catch (Throwable t) {
            if (!isMissingClass(t)) throw t;
            Log.w(TAG, "inflate 遇到缺失控件类，改走平台控件代替", t);
            stubCount = 0;
            LayoutInflater inf = base.cloneInContext(this);
            inf.setFactory2(new LayoutInflater.Factory2() {
                @Override
                public View onCreateView(View p, String name, Context ctx, AttributeSet attrs) {
                    return createOrStub(name, ctx, attrs);
                }

                @Override
                public View onCreateView(String name, Context ctx, AttributeSet attrs) {
                    return createOrStub(name, ctx, attrs);
                }
            });
            return inf.inflate(layoutId, parent, false);
        }
    }

    private boolean isMissingClass(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (c instanceof ClassNotFoundException) return true;
            String m = c.getMessage();
            if (m != null && (m.contains("ClassNotFound") || m.contains("Unable to instantiate") || m.contains("Error inflating class"))) return true;
        }
        return false;
    }

    private View createOrStub(String name, Context ctx, AttributeSet attrs) {
        View v = tryCreate(name, ctx, attrs);
        if (v != null) return v;
        stubCount++;
        try {
            if (name.endsWith("ImageView") || name.endsWith("ImageButton")) return new android.widget.ImageView(ctx, attrs);
            if (name.endsWith("Button")) return new android.widget.Button(ctx, attrs);
            if (name.endsWith("TextView") || name.endsWith("EditText")) return new android.widget.TextView(ctx, attrs);
            if (name.endsWith("ScrollView")) return new ScrollView(ctx, attrs);
            if (name.endsWith("LinearLayout")) return new LinearLayout(ctx);
        } catch (Throwable ignore) {
            /* 退回 FrameLayout */
        }
        return new FrameLayout(ctx);
    }

    private View tryCreate(String name, Context ctx, AttributeSet attrs) {
        String[] prefixes = { "android.widget.", "android.view.", "android.webkit.", "android.app." };
        try {
            if (name.contains(".")) {
                Class<?> c = Class.forName(name);
                return (View) c.getConstructor(Context.class, AttributeSet.class).newInstance(ctx, attrs);
            }
            for (String p : prefixes) {
                try {
                    Class<?> c = Class.forName(p + name);
                    return (View) c.getConstructor(Context.class, AttributeSet.class).newInstance(ctx, attrs);
                } catch (Throwable ignore) {
                    /* 下一个前缀 */
                }
            }
        } catch (Throwable ignore) {
            /* 交给 stub */
        }
        return null;
    }

    /** M152：按资源包里的 id 名找到 View，给它的背景 Drawable 设 level */
    private void setBgLevel(View root, Resources res, String idName, int level) {
        int id = res.getIdentifier(idName, "id", pkgName);
        if (id == 0) return;
        View v = root.findViewById(id);
        if (v == null) return;
        android.graphics.drawable.Drawable d = v.getBackground();
        if (d != null) d.setLevel(level);
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
