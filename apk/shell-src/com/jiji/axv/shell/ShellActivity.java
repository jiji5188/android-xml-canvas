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
 * M192：「一键打包」生成的 APK 里唯一的 Activity。
 *
 * 它不是用户的业务代码 —— 设备上没有 javac/d8，编译不了项目的 Java。
 * 它只做一件事：把打包进去的布局 inflate 出来显示，让用户能在真机上看到成品长什么样。
 * 布局名从 manifest 的 meta-data（axv.layout）里读，所以同一个 dex 能用于任何项目。
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
