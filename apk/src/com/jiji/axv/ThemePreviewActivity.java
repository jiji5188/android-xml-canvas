package com.jiji.axv;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.ContextThemeWrapper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONObject;

/** M320 创建 / M325 重写：主题原生预览页。
 *
 *  目标（用户 2026-11-16 明确要求）：
 *   「用户想看的是系统原本的主题样式」——不做自定义布局、不手动刷色，
 *   全部交给系统主题渲染，这样看到的才是「选了这个主题，App 真的长这样」。
 *
 *  实现要点：
 *   1) Activity：setTheme(framework 等价主题) 后放几个**标准系统控件**（Button/Switch/CheckBox/
 *      EditText/SeekBar），不给它们设任何自定义背景或颜色 → 外观完全由主题决定。
 *   2) Dialog：用系统 AlertDialog.Builder（套 ContextThemeWrapper 指定对话框主题），
 *      标题/图标/确定-取消-中立按钮全部由系统按该主题原生布局渲染。
 *   3) 无 ActionBar 主题 → 隐藏系统 ActionBar（无标题栏就是真的没有，不补自绘条）。
 *      全屏主题 → FLAG_FULLSCREEN 隐藏状态栏。
 *
 *  说明：androidx 的 Material3/AppCompat 资源不在壳 APK 里，
 *  parent 会映射到系统里一定存在的等价 framework 主题（Theme.Material / Holo / DeviceDefault），
 *  所以预览看到的是「framework 对应主题」的原生样式，颜色/圆角由系统自己给，不再由预设调色板覆盖。
 */
public class ThemePreviewActivity extends Activity {

    /** 预览特征（JS 侧 inferPreviewFeatures 算好传进来） */
    private boolean fNoActionBar = false;
    private boolean fFullscreen = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String parent = getIntent() != null ? getIntent().getStringExtra("parent") : null;
        String kind = getIntent() != null ? getIntent().getStringExtra("kind") : null;
        final boolean isDialog = "dialog".equals(kind);
        applyFeatures(getIntent());

        int themeId = resolveThemeStyle(parent);

        // 对话框主题：不给 Activity 套（对话框主题套 Activity 会出现透明窗口/装饰异常），
        // Activity 只当半透明遮罩，主题交给 Dialog 自己。
        if (!isDialog && themeId != 0) {
            setTheme(themeId);
            if (fNoActionBar) {
                android.app.ActionBar ab = getActionBar();
                if (ab != null) ab.hide();
            }
            if (fFullscreen) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }
        }

        // ---- 内容：只用标准系统控件，不设自定义样式 ----
        ScrollView sv = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);
        sv.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 标题（只设字号/加粗，颜色交给主题的 textColorPrimary）
        TextView title = new TextView(this);
        title.setText(parent == null || parent.isEmpty() ? "主题预览" : parent);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView note = new TextView(this);
        note.setText("以下控件和配色都是系统按该主题原生渲染的（未做任何自定义）");
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        root.addView(note, topParams(6));
        root.addView(spacer(16));

        // 1. 按钮（系统默认样式）
        Button btn = new Button(this);
        btn.setText("普通按钮");
        root.addView(btn);

        // 2. 开关
        Switch sw = new Switch(this);
        sw.setText("开关");
        sw.setChecked(true);
        root.addView(sw, topParams(12));

        // 3. 复选框
        CheckBox cb = new CheckBox(this);
        cb.setText("复选框");
        cb.setChecked(true);
        root.addView(cb, topParams(8));

        // 4. 输入框
        EditText et = new EditText(this);
        et.setHint("输入框");
        et.setText("示例文字");
        root.addView(et, topParams(12));

        // 5. 进度条 + 滑块
        SeekBar bar = new SeekBar(this);
        bar.setMax(100);
        bar.setProgress(60);
        root.addView(bar, topParams(12));

        TextView foot = new TextView(this);
        foot.setText(fNoActionBar ? "此主题无 ActionBar（标题栏）" : "此主题带系统 ActionBar（标题栏）");
        foot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        root.addView(foot, topParams(16));

        if (isDialog) {
            // ---- 对话框：系统 AlertDialog 原生渲染（标题/图标/正负中立按钮都由系统布局）----
            getWindow().setBackgroundDrawable(new ColorDrawable(0x99000000));
            int dlgTheme = themeId != 0 ? themeId : android.R.style.Theme_Material_Light_Dialog;
            showSystemDialog(dlgTheme, parent);
            return;
        }

        setContentView(sv);
    }

    /** 用系统 AlertDialog.Builder 弹一个真实对话框：标题/图标/消息/确定-取消-稍后 全部系统原生布局。 */
    private void showSystemDialog(int dialogThemeId, String parent) {
        ContextThemeWrapper wrapper = new ContextThemeWrapper(this, dialogThemeId);
        AlertDialog dlg = new AlertDialog.Builder(wrapper)
                .setIcon(android.R.drawable.ic_dialog_info)
                .setTitle("对话框标题")
                .setMessage("这是系统对话框在「" + (parent == null ? "默认主题" : parent) + "」下的原生外观。\n"
                        + "标题、图标、按钮布局与配色都由系统主题决定。")
                .setPositiveButton("确定", null)
                .setNegativeButton("取消", null)
                .setNeutralButton("稍后", null)
                .create();
        dlg.setCanceledOnTouchOutside(true);
        dlg.show();
    }

    // ---- 特征（无ActionBar / 全屏）----
    private void applyFeatures(android.content.Intent in) {
        if (in == null) return;
        String f = in.getStringExtra("features");
        if (f == null || f.isEmpty()) return;
        try {
            JSONObject j = new JSONObject(f);
            fNoActionBar = j.optBoolean("noActionBar", false);
            fFullscreen = j.optBoolean("fullscreen", false);
        } catch (Exception ignore) {
        }
    }

    /** parent 主题名 → 系统里一定存在的 framework style id。androidx 的映射到最近等价；Dialog 主题映射到 *Dialog 变体。 */
    private int resolveThemeStyle(String parent) {
        if (parent == null || parent.isEmpty()) return 0;
        // 先试 android 命名空间（Theme.Material / Theme.Material.Dialog / Theme.Holo…）
        int id = getResources().getIdentifier(sanitize(parent), "style", "android");
        if (id != 0) return id;
        // androidx 系 → 映射到 framework 等价
        String p = parent.replace("Theme.", "");
        boolean isDialog = p.contains("Dialog");
        if (p.contains("Material3") || p.contains("MaterialComponents") || p.equals("Material")) {
            boolean dark = p.contains("Dark") && !p.contains("DayNight");
            if (isDialog) return dark ? android.R.style.Theme_Material_Dialog : android.R.style.Theme_Material_Light_Dialog;
            return dark ? android.R.style.Theme_Material : android.R.style.Theme_Material_Light;
        }
        if (p.contains("AppCompat")) {
            boolean light = p.contains("Light");
            if (isDialog) return light ? android.R.style.Theme_Material_Light_Dialog : android.R.style.Theme_Material_Dialog;
            return light ? android.R.style.Theme_Material_Light : android.R.style.Theme_Material;
        }
        if (p.contains("Holo")) {
            boolean light = p.contains("Light");
            if (isDialog) return light ? android.R.style.Theme_Holo_Light_Dialog : android.R.style.Theme_Holo_Dialog;
            return light ? android.R.style.Theme_Holo_Light : android.R.style.Theme_Holo;
        }
        if (p.contains("DeviceDefault")) {
            if (isDialog) return android.R.style.Theme_DeviceDefault_Dialog;
            return android.R.style.Theme_DeviceDefault;
        }
        // 兜底：Material 浅色
        return isDialog ? android.R.style.Theme_Material_Light_Dialog : android.R.style.Theme_Material_Light;
    }

    private String sanitize(String parent) {
        // "Theme.Material" / "@android:style/Theme.Holo" → "Theme.Material" 全名
        String p = parent.replaceFirst("^@android:style/", "").replaceFirst("^Theme\\.", "");
        return "Theme." + p;
    }

    // ---- 小工具 ----
    private LinearLayout.LayoutParams topParams(int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(topDp), 0, 0);
        return lp;
    }

    private View spacer(int dpH) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(dpH)));
        return v;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
