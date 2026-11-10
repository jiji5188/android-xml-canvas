package com.jiji.axv.shell;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * M192/M213：「一键打包」生成的 APK 里的入口 Activity。
 *
 * 职责有两层：
 * 1) M213 起设备端能用 ECJ+D8 真编译项目的 Java —— 若清单里带了 axv.launcher
 *    （项目自己的 launcher Activity），且这个类在包里真存在，就先 startActivity 转给它，
 *    让用户的项目代码真正跑起来（setContentView/findViewById/监听器都是他的原逻辑）。
 * 2) 兜底：项目没有 launcher、或编译失败没进包（类不存在），就本地 inflate 布局
 *    （布局名从 meta-data axv.layout 读），至少能看到界面。
 *
 * 之所以把判断放运行时而不是打包时：清单要在 aapt2 link 之前写好，那时还不知道编译会不会成功；
 * 写成「固定壳 + 运行时接管」就不会出现「清单指向不存在的类 → 装上秒崩」。
 */
public class ShellActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String layout = "activity_main";
        try {
            ActivityInfo ai = getPackageManager().getActivityInfo(getComponentName(),
                    PackageManager.GET_META_DATA);
            if (ai != null && ai.metaData != null) {
                layout = ai.metaData.getString("axv.layout", layout);
            }
        } catch (Throwable ignored) {
            // 读不到就用默认名，下面会给出提示页
        }

        // M213：项目自己的 launcher Activity 在包里就转给它（真跑用户代码）
        String launcher = "";
        try {
            ActivityInfo ai = getPackageManager().getActivityInfo(getComponentName(),
                    PackageManager.GET_META_DATA);
            if (ai != null && ai.metaData != null) {
                launcher = ai.metaData.getString("axv.launcher", "");
            }
        } catch (Throwable ignored) {
        }
        if (launcher != null && launcher.length() > 0 && !launcher.equals(getClass().getName())) {
            try {
                Class.forName(launcher);
                android.content.Intent it = new android.content.Intent();
                it.setClassName(this, launcher);
                startActivity(it);
                finish();
                return;
            } catch (Throwable notCompiled) {
                // 类不在包里（没编译成功 / 没源码）→ 继续走本地 inflate
            }
        }

        int id = 0;
        try {
            id = getResources().getIdentifier(layout, "layout", getPackageName());
        } catch (Throwable ignored) {
        }

        if (id == 0) {
            setContentView(message("找不到布局：" + layout + "\n\n可能是打包时没有选对布局文件。"));
            return;
        }
        try {
            setContentView(id);
        } catch (Throwable t) {
            setContentView(message("布局 inflate 失败：" + t));
        }
    }

    private ScrollView message(String text) {
        ScrollView sv = new ScrollView(this);
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.DKGRAY);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        int p = (int) (16 * getResources().getDisplayMetrics().density);
        tv.setPadding(p, p, p, p);
        sv.addView(tv, new ScrollView.LayoutParams(-1, -2));
        sv.setForegroundGravity(Gravity.TOP);
        return sv;
    }
}
