// lib/xml/axv-runtime.ts — M286：打包时把「运行日志抽屉」注入生成的 APK
//
// 目标：用户在手机上跑自己打出来的 App 时，能当场看到运行期日志（生命周期 / 崩溃 / 手动 log），
// 不用连电脑、不用 adb、不需要任何权限：
//   · 一个 ContentProvider 在 Application.onCreate 之后、任何 Activity 之前被系统实例化
//     （androidx.startup 同款套路），在 onCreate 里注册 ActivityLifecycleCallbacks + 崩溃钩子
//   · 通过 ActivityLifecycleCallbacks 把抽屉 View 挂到每个 Activity 的 decorView 上（app 自己的窗口内，无权限）
//   · 左上角小把手「▤ 日志」，点开是半屏抽屉，支持清空 / 复制 / 收起，长按把手可隐藏
//
// 为什么用 provider 而不是 android:name=".AxvApp"：不能覆盖用户自己的 Application 类。
//
// 纯字符串生成 + 纯函数，方便单测；不依赖任何 androidx，只吃 android.jar。

/** 注入类所在子包（相对项目包名） */
export const AXV_LOG_SUBPKG = "axvlog";

/** 注入的两个类名 */
export const AXV_LOG_CLASS = "AxvRuntimeLog";
export const AXV_PROVIDER_CLASS = "AxvLogProvider";

/** 生成 provider 的 authorities（同包唯一即可，不需要真的能访问） */
export function axvLogAuthorities(pkg: string): string {
  return `${pkg}.${AXV_LOG_SUBPKG}.provider`;
}

/** 注入类的全限定名 */
export function axvLogProviderFqn(pkg: string): string {
  return `${pkg}.${AXV_LOG_SUBPKG}.${AXV_PROVIDER_CLASS}`;
}

function runtimeJava(pkg: string): string {
  const sp = `${pkg}.${AXV_LOG_SUBPKG}`;
  return `package ${sp};

import android.app.Activity;
import android.app.Application;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

/**
 * AXV 运行日志（M286，由 AXV 打包器自动注入）
 * 用法：AxvRuntimeLog.log("自定义日志");
 * 界面：左上角「▤ 日志」点开抽屉；长按把手可隐藏。
 */
public final class ${AXV_LOG_CLASS} {
    private static final String TAG = "AXV";
    private static final String TAG_ROOT = "axv_log_root";
    private static final int MAX = 800;
    private static final ArrayDeque<String> LINES = new ArrayDeque<String>();
    private static final SimpleDateFormat FMT = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);
    private static Handler ui;
    private static boolean installed;
    private static Thread.UncaughtExceptionHandler prevHandler;

    private ${AXV_LOG_CLASS}() {
    }

    /** 记一条日志（线程安全）。异常里也别调，避免递归。 */
    public static void log(String msg) {
        String m = msg == null ? "null" : msg;
        String line = FMT.format(new Date()) + "  " + m;
        synchronized (LINES) {
            LINES.addLast(line);
            while (LINES.size() > MAX) {
                LINES.removeFirst();
            }
        }
        Log.i(TAG, m);
    }

    /** 由 AxvLogProvider.onCreate 调用；重复调用无副作用。 */
    public static void install(Context ctx) {
        if (installed) {
            return;
        }
        installed = true;
        if (ctx == null) {
            return;
        }
        final Context appCtx = ctx.getApplicationContext();
        ui = new Handler(Looper.getMainLooper());
        prevHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    log("E/未捕获异常 " + e);
                    StackTraceElement[] st = e.getStackTrace();
                    int n = st.length < 14 ? st.length : 14;
                    for (int i = 0; i < n; i++) {
                        log("E/    at " + st[i].toString());
                    }
                    Throwable c = e.getCause();
                    int guard = 0;
                    while (c != null && guard++ < 5) {
                        log("E/原因 " + c);
                        c = c.getCause();
                    }
                } catch (Throwable ignore) {
                }
                if (prevHandler != null) {
                    prevHandler.uncaughtException(t, e);
                }
            }
        });
        if (appCtx instanceof Application) {
            ((Application) appCtx).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
                @Override
                public void onActivityCreated(Activity a, Bundle b) {
                    log("生命周期 onCreate → " + name(a));
                    attach(a);
                }

                @Override
                public void onActivityStarted(Activity a) {
                    log("生命周期 onStart → " + name(a));
                }

                @Override
                public void onActivityResumed(Activity a) {
                    log("生命周期 onResume → " + name(a));
                    attach(a);
                }

                @Override
                public void onActivityPaused(Activity a) {
                    log("生命周期 onPause → " + name(a));
                }

                @Override
                public void onActivityStopped(Activity a) {
                    log("生命周期 onStop → " + name(a));
                }

                @Override
                public void onActivitySaveInstanceState(Activity a, Bundle b) {
                }

                @Override
                public void onActivityDestroyed(Activity a) {
                    log("生命周期 onDestroy → " + name(a));
                }
            });
        }
        log("AXV 运行日志已启用：点左上角「▤ 日志」查看，长按把手可隐藏");
    }

    /** 日志条数 */
    public static int size() {
        synchronized (LINES) {
            return LINES.size();
        }
    }

    public static void clear() {
        synchronized (LINES) {
            LINES.clear();
        }
    }

    /** 导出最后 max 行（给抽屉/复制用） */
    public static String dump(int max) {
        StringBuilder sb = new StringBuilder();
        synchronized (LINES) {
            int skip = LINES.size() - max;
            int i = 0;
            for (String s : LINES) {
                if (i++ < skip) {
                    continue;
                }
                sb.append(s).append('\\n');
            }
        }
        return sb.toString();
    }

    private static String name(Activity a) {
        if (a == null) {
            return "?";
        }
        String s = a.getClass().getName();
        int i = s.lastIndexOf('.');
        return i >= 0 ? s.substring(i + 1) : s;
    }

    private static int dp(Context c, int v) {
        return (int) (v * c.getResources().getDisplayMetrics().density + 0.5f);
    }

    private static TextView btn(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(11f);
        t.setTextColor(0xFF4FC3F7);
        t.setPadding(dp(c, 10), dp(c, 6), dp(c, 10), dp(c, 6));
        t.setClickable(true);
        return t;
    }

    private static void attach(final Activity act) {
        if (act == null || act.getWindow() == null) {
            return;
        }
        View decorView = act.getWindow().getDecorView();
        if (!(decorView instanceof ViewGroup)) {
            return;
        }
        final ViewGroup decor = (ViewGroup) decorView;
        if (decor.findViewWithTag(TAG_ROOT) != null) {
            return;
        }
        final FrameLayout root = new FrameLayout(act);
        root.setTag(TAG_ROOT);
        decor.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        final TextView handle = new TextView(act);
        handle.setText("▤ 日志");
        handle.setTextSize(11f);
        handle.setTextColor(0xFFFFFFFF);
        handle.setPadding(dp(act, 10), dp(act, 5), dp(act, 10), dp(act, 5));
        handle.setBackgroundColor(0xB3000000);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.gravity = Gravity.TOP | Gravity.LEFT;
        hp.topMargin = dp(act, 110);
        root.addView(handle, hp);

        final LinearLayout panel = new LinearLayout(act);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xE6000000);
        panel.setVisibility(View.GONE);
        int ph = act.getResources().getDisplayMetrics().heightPixels * 46 / 100;
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ph);
        pp.gravity = Gravity.TOP;
        root.addView(panel, pp);

        LinearLayout head = new LinearLayout(act);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setBackgroundColor(0xFF1E1E1E);
        head.setPadding(dp(act, 10), dp(act, 4), dp(act, 6), dp(act, 4));
        final TextView title = new TextView(act);
        title.setText("AXV 运行日志");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(12f);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView clearBtn = btn(act, "清空");
        TextView copyBtn = btn(act, "复制");
        TextView hideBtn = btn(act, "收起");
        head.addView(clearBtn);
        head.addView(copyBtn);
        head.addView(hideBtn);
        panel.addView(head, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        final ScrollView sc = new ScrollView(act);
        final TextView body = new TextView(act);
        body.setTextSize(9f);
        body.setTextColor(0xFFDDDDDD);
        body.setTypeface(Typeface.MONOSPACE);
        body.setPadding(dp(act, 8), dp(act, 6), dp(act, 8), dp(act, 10));
        sc.addView(body, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(sc, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        final Runnable refresh = new Runnable() {
            @Override
            public void run() {
                if (panel.getVisibility() != View.VISIBLE) {
                    return;
                }
                body.setText(dump(400));
                title.setText("AXV 运行日志 (" + size() + ")");
                sc.post(new Runnable() {
                    @Override
                    public void run() {
                        sc.fullScroll(View.FOCUS_DOWN);
                    }
                });
                if (ui != null) {
                    ui.postDelayed(this, 500);
                }
            }
        };

        handle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                boolean show = panel.getVisibility() != View.VISIBLE;
                panel.setVisibility(show ? View.VISIBLE : View.GONE);
                if (show && ui != null) {
                    ui.post(refresh);
                }
            }
        });
        handle.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                panel.setVisibility(View.GONE);
                handle.setVisibility(View.GONE);
                log("日志把手已隐藏（重启 App 后恢复）");
                return true;
            }
        });
        hideBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                panel.setVisibility(View.GONE);
            }
        });
        clearBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                clear();
                body.setText("(已清空)");
                title.setText("AXV 运行日志 (0)");
            }
        });
        copyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(ClipData.newPlainText("AXV 运行日志", dump(400)));
                        log("日志已复制到剪贴板");
                    }
                } catch (Throwable e) {
                    log("E/复制失败 " + e);
                }
            }
        });
    }
}
`;
}

function providerJava(pkg: string): string {
  const sp = `${pkg}.${AXV_LOG_SUBPKG}`;
  return `package ${sp};

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;

/**
 * AXV 运行日志安装器（M286，由 AXV 打包器自动注入）
 * 系统会在 Application.onCreate 之后、第一个 Activity 之前实例化本 provider，
 * 借这个时机装上生命周期/崩溃钩子与日志抽屉（androidx.startup 同款套路）。
 */
public class ${AXV_PROVIDER_CLASS} extends ContentProvider {
    @Override
    public boolean onCreate() {
        ${AXV_LOG_CLASS}.install(getContext());
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
`;
}

/** 源文件相对路径（放到 src/<pkg 路径>/axvlog/ 下，包声明与路径一致） */
export function axvRuntimeSources(pkg: string): { path: string; code: string }[] {
  const dir = `src/${pkg.replace(/\./g, "/")}/${AXV_LOG_SUBPKG}`;
  return [
    { path: `${dir}/${AXV_LOG_CLASS}.java`, code: runtimeJava(pkg) },
    { path: `${dir}/${AXV_PROVIDER_CLASS}.java`, code: providerJava(pkg) },
  ];
}

export interface InjectResult {
  text: string;
  /** 是否真的插入了（false = 已有 / 找不到 <application>） */
  injected: boolean;
  /** 失败原因（没注入时给日志用） */
  reason?: "already" | "no-application" | "empty";
}

const PROVIDER_MARK = "axvlog.AxvLogProvider";

/**
 * 往 manifest 里注入日志 provider。
 * 注意：只有「注入的类真的会被编译进包」时才该调用，否则启动时 ClassNotFound。
 */
export function injectAxvLogProvider(manifestText: string, pkg: string): InjectResult {
  const text = manifestText || "";
  if (!text.trim()) return { text, injected: false, reason: "empty" };
  if (text.includes(PROVIDER_MARK)) return { text, injected: false, reason: "already" };
  const idx = text.lastIndexOf("</application>");
  if (idx < 0) return { text, injected: false, reason: "no-application" };
  const block =
    `        <provider\n` +
    `            android:name="${axvLogProviderFqn(pkg)}"\n` +
    `            android:authorities="${axvLogAuthorities(pkg)}"\n` +
    `            android:exported="false"\n` +
    `            android:initOrder="1000" />\n`;
  return { text: text.slice(0, idx) + block + text.slice(idx), injected: true };
}
