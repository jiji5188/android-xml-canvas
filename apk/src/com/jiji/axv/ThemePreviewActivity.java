package com.jiji.axv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.ArrayAdapter;

import org.json.JSONObject;

/** M320：主题专用预览 Activity。
 *  从主题面板点「预览」跳过来：在代码里加载选中的主题样式（setTheme），
 *  渲染一组标准 Material 控件（按钮/卡片/开关/滑块/输入/单选/进度/文字层级），
 *  并用预设调色板把主色/次色/底色套上去，直观看到「这个主题长啥样」。
 *
 *  说明：androidx 的 Material3/AppCompat 主题资源不在壳 APK 里，
 *  这里按 parent 名映射到系统里一定存在的等价 framework 主题（Theme.Material / Holo / DeviceDefault），
 *  控件基类用系统的；但**颜色**用预设调色板精确套，所以观感（主色/底色/卡片色）是准的。 */
public class ThemePreviewActivity extends Activity {

    private int cPrimary = 0xFF6750A4;
    private int cOnPrimary = 0xFFFFFFFF;
    private int cSecondary = 0xFF625B71;
    private int cSurface = 0xFFFDF7FF;
    private int cOnSurface = 0xFF1D1B20;
    // M324：预览特征
    private boolean fNoActionBar = false;
    private boolean fFullscreen = false;
    private String fDialogStyle = "material2";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String parent = getIntent() != null ? getIntent().getStringExtra("parent") : null;
        String kind = getIntent() != null ? getIntent().getStringExtra("kind") : null;
        final boolean isDialog = "dialog".equals(kind);
        applyPalette(getIntent());
        applyFeatures(getIntent());
        int themeId = resolveThemeStyle(parent);
        if (themeId != 0 && !isDialog) setTheme(themeId);
        // M324：无 ActionBar 主题 → 隐藏系统 ActionBar（framework 主题套上可能自带）
        if (fNoActionBar) {
            android.app.ActionBar ab = getActionBar();
            if (ab != null) ab.hide();
        }
        // M324：全屏主题 → 隐藏状态栏（老式 FLAG_FULLSCREEN，兼容低 API）
        if (fFullscreen) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }

        ScrollView sv = new ScrollView(this);
        if (!isDialog) sv.setBackgroundColor(cSurface);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);
        root.setClipToPadding(false);
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 标题：主题名（M324：若 noActionBar，补一个自绘的顶部标题条代替被隐藏的系统 ActionBar，避免内容贴顶）
        if (fNoActionBar) {
            LinearLayout topBar = new LinearLayout(this);
            topBar.setOrientation(LinearLayout.HORIZONTAL);
            topBar.setBackgroundColor(cPrimary);
            int tb = dp(56); // 标准 ActionBar 高
            topBar.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, tb));
            TextView tbTitle = tv(parent, 17, true);
            tbTitle.setTextColor(cOnPrimary);
            tbTitle.setGravity(Gravity.CENTER_VERTICAL);
            topBar.addView(tbTitle, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            root.addView(topBar);
        } else {
            TextView title = tv(parent, 20, true);
            title.setTextColor(cOnSurface);
            root.addView(title);
            TextView sub = tv("parent = " + (parent == null ? "(默认)" : parent), 12, false);
            sub.setTextColor(Color.rgb(0x60, 0x60, 0x60));
            root.addView(sub, topParams(2));
        }
        root.addView(spacer(14));

        // M324：精简到 5 个代表性组件 + 色板（不用 11 个那么满）
        // 1. 主按钮
        Button btn = new Button(this);
        btn.setText("主按钮");
        btn.setTextColor(cOnPrimary);
        btn.setBackground(pill(cPrimary, fDialogStyle.equals("material3"), fDialogStyle.equals("holo")));
        root.addView(btn);

        // 2. 卡片（带开关）
        FrameLayout card = new FrameLayout(this);
        card.setBackground(pill(cardBg(), fDialogStyle.equals("material3"), fDialogStyle.equals("holo")));
        int cpad = dp(14);
        card.setPadding(cpad, cpad, cpad, cpad);
        LinearLayout cardIn = new LinearLayout(this);
        cardIn.setOrientation(LinearLayout.VERTICAL);
        TextView cardTitle = tv("卡片  Card", 15, true);
        cardTitle.setTextColor(cOnSurface);
        cardIn.addView(cardTitle);
        Switch sw = new Switch(this);
        sw.setText("开关");
        sw.setTextColor(cOnSurface);
        sw.setThumbTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        sw.setTrackTintList(android.content.res.ColorStateList.valueOf(0xFFE8DEF8));
        sw.setChecked(true);
        cardIn.addView(sw, topParams(10));
        card.addView(cardIn);
        root.addView(card, topParams(14));

        // 3. 输入框
        EditText et = new EditText(this);
        et.setHint("输入框  EditText");
        et.setText("在此输入");
        et.setTextColor(cOnSurface);
        et.setHintTextColor(Color.rgb(0x90, 0x90, 0x90));
        et.setBackground(underline(cPrimary, fDialogStyle));
        root.addView(et, topParams(14));

        // 4. 进度条
        SeekBar bar = new SeekBar(this);
        bar.setMax(100);
        bar.setProgress(60);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        bar.setThumbTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        root.addView(bar, topParams(14));

        // 5. 强调色板（直观看主色/次色/底色）
        LinearLayout swatch = new LinearLayout(this);
        swatch.setOrientation(LinearLayout.HORIZONTAL);
        swatch.addView(colorBlock(cPrimary, "主色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        swatch.addView(colorBlock(cSecondary, "次色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        swatch.addView(colorBlock(cSurface, "底色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        root.addView(swatch, topParams(14));
        root.addView(spacer(10));

        // M321/M324：对话框主题 → 真弹一个 Dialog（用该主题），弹窗布局按 dialogStyle 差异化
        if (isDialog) {
            getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0x99000000));
            int dialogTheme = themeId != 0 ? themeId : android.R.style.Theme_Material_Light_Dialog;
            android.app.Dialog dlg = new android.app.Dialog(this, dialogTheme);
            dlg.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
            View dialogContent = buildDialog(fDialogStyle);
            dlg.setContentView(dialogContent);
            // M324：弹窗宽度按风格调（holo 窄、M3 宽）
            int dlgW = fDialogStyle.equals("material3") ? (int) (getResources().getDisplayMetrics().widthPixels * 0.86)
                    : fDialogStyle.equals("holo") ? (int) (getResources().getDisplayMetrics().widthPixels * 0.72)
                    : (int) (getResources().getDisplayMetrics().widthPixels * 0.82);
            dlg.getWindow().setLayout(dlgW, ViewGroup.LayoutParams.WRAP_CONTENT);
            dlg.setCanceledOnTouchOutside(true);
            dlg.show();
            return;
        }

        setContentView(sv);
    }

    /** M324：按 dialogStyle 生成不同的对话框内容（圆角/图标位置/标题样式/按钮形状与位置全不同） */
    private View buildDialog(String style) {
        switch (style) {
            case "holo": return buildDialogHolo();
            case "material3": return buildDialogM3();
            case "appcompat": return buildDialogCompat();
            case "system": return buildDialogSystem();
            case "material2":
            default: return buildDialogM2();
        }
    }

    /** Holo（Android4 经典）：方角、标题下蓝色分割线、图标小在标题左、底部居中方角边框按钮 */
    private View buildDialogHolo() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        int m = dp(16);
        v.setPadding(m, m, m, dp(12));
        v.setBackground(pillHolo()); // 方角白/深
        // 标题行：图标 + 标题 + 下方 Holo 蓝分割线
        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        titleRow.addView(iconDot(dp(22), cPrimary, false), new LinearLayout.LayoutParams(dp(22), dp(22)));
        TextView tt = tv("确定要保存吗？", 16, true);
        tt.setTextColor(cOnSurface);
        tt.setPadding(dp(10), 0, 0, 0);
        titleRow.addView(tt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        v.addView(titleRow);
        // Holo 标志性的蓝色下划线
        View line = new View(this);
        line.setBackgroundColor(cPrimary); // 近似 Holo 蓝分割线
        LinearLayout.LayoutParams lineLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2));
        lineLp.setMargins(0, dp(8), 0, 0);
        v.addView(line, lineLp);
        TextView msg = tv("确定要保存吗？", 13, false);
        msg.setTextColor(cOnSurface);
        msg.setPadding(dp(0), dp(10), 0, 0);
        v.addView(msg);
        // 底部居中方角边框按钮（Holo 风）
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.CENTER_HORIZONTAL);
        btns.setPadding(0, dp(12), 0, 0);
        Button cancel = holoBtn("取消");
        Button ok = holoBtn("确定");
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        okLp.setMargins(dp(8), 0, 0, 0);
        btns.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        btns.addView(ok, okLp);
        v.addView(btns);
        return v;
    }

    /** Material 2：圆角 8dp、图标顶（主色大圆点）、标题粗体、正文、底部右侧无边框文字按钮 */
    private View buildDialogM2() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        int m = dp(24);
        v.setPadding(m, dp(20), m, dp(14));
        v.setBackground(pillRounded(cSurface, dp(8)));
        // 图标顶
        v.addView(iconDot(dp(40), cPrimary, true), new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView tt = tv("确定要保存吗？", 17, true);
        tt.setTextColor(cOnSurface);
        v.addView(tt, topParams(14));
        TextView msg = tv("保存后将写入项目文件，可随时撤销。", 13, false);
        msg.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        v.addView(msg, topParams(6));
        // 底部右侧文字按钮（M2 无边框）
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.END);
        btns.setPadding(0, dp(10), 0, 0);
        Button cancel = textBtn("取消", Color.rgb(0x49, 0x45, 0x4F));
        Button ok = textBtn("确定", cPrimary);
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        okLp.setMargins(dp(16), 0, 0, 0);
        btns.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        btns.addView(ok, okLp);
        v.addView(btns);
        return v;
    }

    /** Material 3：大圆角 28dp、图标顶（圆角方块背景）、标题大、正文、底部右侧胶囊按钮（取消=tonal 浅底 / 确定=filled 主色胶囊） */
    private View buildDialogM3() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        int m = dp(24);
        v.setPadding(m, dp(24), m, dp(20));
        v.setBackground(pillRounded(cSurface, dp(28)));
        // 图标顶：主色圆角方块 + 白点
        FrameLayout icon = new FrameLayout(this);
        icon.setBackground(pillRounded(cPrimary, dp(14)));
        TextView mark = tv("i", 20, true);
        mark.setTextColor(cOnPrimary);
        mark.setGravity(Gravity.CENTER);
        icon.addView(mark, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        v.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView tt = tv("确定要保存吗？", 19, true);
        tt.setTextColor(cOnSurface);
        v.addView(tt, topParams(16));
        TextView msg = tv("保存后将写入项目文件，可随时撤销。", 13, false);
        msg.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        v.addView(msg, topParams(6));
        // 底部右侧胶囊按钮（M3 特色）
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.END);
        btns.setPadding(0, dp(12), 0, 0);
        Button cancel = m3TonalBtn("取消");
        Button ok = m3FilledBtn("确定");
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        okLp.setMargins(dp(12), 0, 0, 0);
        btns.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        btns.addView(ok, okLp);
        v.addView(btns);
        return v;
    }

    /** AppCompat：圆角 4dp、图标顶、标题、正文、底部右侧方角实心按钮（旧风） */
    private View buildDialogCompat() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        int m = dp(20);
        v.setPadding(m, dp(16), m, dp(12));
        v.setBackground(pillRounded(cSurface, dp(4)));
        v.addView(iconDot(dp(36), cSecondary, true), new LinearLayout.LayoutParams(dp(36), dp(36)));
        TextView tt = tv("确定要保存吗？", 16, true);
        tt.setTextColor(cOnSurface);
        v.addView(tt, topParams(10));
        TextView msg = tv("保存后将写入项目文件，可随时撤销。", 13, false);
        msg.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        v.addView(msg, topParams(6));
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.END);
        btns.setPadding(0, dp(10), 0, 0);
        Button cancel = compatBtn("取消", false);
        Button ok = compatBtn("确定", true);
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        okLp.setMargins(dp(10), 0, 0, 0);
        btns.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        btns.addView(ok, okLp);
        v.addView(btns);
        return v;
    }

    /** 系统（DeviceDefault 近似）：圆角 12dp、图标顶、标题、正文、底部右侧 M2 风文字按钮 */
    private View buildDialogSystem() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        int m = dp(22);
        v.setPadding(m, dp(20), m, dp(14));
        v.setBackground(pillRounded(cSurface, dp(12)));
        v.addView(iconDot(dp(40), cPrimary, true), new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView tt = tv("确定要保存吗？", 17, true);
        tt.setTextColor(cOnSurface);
        v.addView(tt, topParams(12));
        TextView msg = tv("保存后将写入项目文件，可随时撤销。", 13, false);
        msg.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        v.addView(msg, topParams(6));
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.END);
        btns.setPadding(0, dp(10), 0, 0);
        Button cancel = textBtn("取消", Color.rgb(0x61, 0x61, 0x61));
        Button ok = textBtn("确定", cPrimary);
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        okLp.setMargins(dp(16), 0, 0, 0);
        btns.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        btns.addView(ok, okLp);
        v.addView(btns);
        return v;
    }

    // ---- 对话框按钮构造 ----
    private View iconDot(int size, int color, boolean rounded) {
        FrameLayout f = new FrameLayout(this);
        f.setBackground(pillRounded(color, rounded ? size / 2 : dp(4)));
        TextView t = new TextView(this);
        t.setText("i");
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        f.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return f;
    }

    private Button textBtn(String label, int color) {
        Button b = new Button(this);
        b.setText(label.toUpperCase());
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setTextColor(color);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setBackgroundColor(Color.TRANSPARENT);
        int p = dp(8);
        b.setPadding(p, p / 2, p, p / 2);
        return b;
    }

    private Button m3TonalBtn(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTextColor(cSecondary);
        b.setBackground(pillRounded(0xFFEADDFF, dp(20)));
        b.setPadding(dp(20), dp(10), dp(20), dp(10));
        return b;
    }

    private Button m3FilledBtn(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTextColor(cOnPrimary);
        b.setBackground(pillRounded(cPrimary, dp(20)));
        b.setPadding(dp(20), dp(10), dp(20), dp(10));
        return b;
    }

    private Button holoBtn(String label) {
        Button b = new Button(this);
        b.setText(label.toUpperCase());
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setTextColor(cPrimary);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable gd = pillRounded(Color.TRANSPARENT, dp(2));
        gd.setStroke(dp(1), cPrimary);
        b.setBackground(gd);
        b.setPadding(dp(16), dp(8), dp(16), dp(8));
        return b;
    }

    private Button compatBtn(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label.toUpperCase());
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setTextColor(primary ? cOnPrimary : cOnSurface);
        b.setBackground(pillRounded(primary ? cSecondary : Color.TRANSPARENT, dp(3)));
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        return b;
    }

    // ---- 调色板（JS 传过来的预设色，精确套）----
    private void applyFeatures(android.content.Intent in) {
        if (in == null) return;
        String f = in.getStringExtra("features");
        if (f == null || f.isEmpty()) return;
        try {
            JSONObject j = new JSONObject(f);
            fNoActionBar = j.optBoolean("noActionBar", false);
            fFullscreen = j.optBoolean("fullscreen", false);
            String ds = j.optString("dialogStyle", "material2");
            if (ds != null && !ds.isEmpty()) fDialogStyle = ds;
        } catch (Exception ignore) {
        }
    }

    private void applyPalette(android.content.Intent in) {
        if (in == null) return;
        String pal = in.getStringExtra("palette");
        if (pal == null || pal.isEmpty()) return;
        try {
            JSONObject j = new JSONObject(pal);
            cPrimary = parseColor(j.optString("primary", ""), cPrimary);
            cOnPrimary = parseColor(j.optString("onPrimary", ""), cOnPrimary);
            cSecondary = parseColor(j.optString("secondary", ""), cSecondary);
            cSurface = parseColor(j.optString("surface", ""), cSurface);
            cOnSurface = parseColor(j.optString("onSurface", ""), cOnSurface);
        } catch (Exception ignore) {
        }
    }

    private int parseColor(String v, int fallback) {
        if (v == null || v.isEmpty()) return fallback;
        try {
            String h = v.startsWith("#") ? v : "#" + v;
            return android.graphics.Color.parseColor(h);
        } catch (Exception e) {
            return fallback;
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
        // "Theme.Material" / "@android:style/Theme.Holo" → "Material"/"Holo" 全名
        String p = parent.replaceFirst("^@android:style/", "").replaceFirst("^Theme\\.", "");
        return "Theme." + p;
    }

    // ---- 小工具 ----
    /** LinearLayout.LayoutParams + 上边距（避开 setMarginTop 在部分 SDK 签名下不可见的问题，改用 setMargins） */
    private LinearLayout.LayoutParams topParams(int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(topDp), 0, 0);
        return lp;
    }

    private TextView tv(String text, int sp, boolean bold) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return v;
    }

    private View spacer(int dpH) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(dpH)));
        return v;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable pill(int color, boolean m3Pill, boolean holoSquare) {
        // 主按钮背景：M3 胶囊（圆角=高/2 近似 22dp）、Holo 方角（2dp）、其它 8dp
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        int r = m3Pill ? dp(22) : (holoSquare ? dp(2) : dp(8));
        d.setCornerRadius(r);
        return d;
    }

    /** 卡片背景色：主色浅调（M3 用 surfaceContainer） */
    private int cardBg() {
        // 用主色的 12% 叠加到 surface 上，近似 M3 的 surfaceContainer
        int r = ((cPrimary >> 16) & 0xFF), g = ((cPrimary >> 8) & 0xFF), b = (cPrimary & 0xFF);
        int sr = ((cSurface >> 16) & 0xFF), sg = ((cSurface >> 8) & 0xFF), sb = (cSurface & 0xFF);
        int mr = (int) (sr * 0.88 + r * 0.12), mg = (int) (sg * 0.88 + g * 0.12), mb = (int) (sb * 0.88 + b * 0.12);
        return 0xFF000000 | (mr << 16) | (mg << 8) | mb;
    }

    /** 通用圆角 GradientDrawable（radius 传像素） */
    private GradientDrawable pillRounded(int color, int radiusPx) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radiusPx);
        return d;
    }

    /** Holo 对话框：方角（圆角 0） */
    private GradientDrawable pillHolo() {
        GradientDrawable d = new GradientDrawable();
        d.setColor(cSurface);
        d.setCornerRadius(0);
        d.setStroke(dp(1), cPrimary);
        return d;
    }

    private GradientDrawable outlinePill(int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.TRANSPARENT);
        d.setStroke(dp(1), stroke);
        d.setCornerRadius(dp(8));
        return d;
    }

    private GradientDrawable underline(int color, String style) {
        // M3：圆角 4dp 填充；Holo：底部一条主色横线；其它：淡主色填充
        GradientDrawable d = new GradientDrawable();
        if (style != null && style.equals("holo")) {
            d.setColor(Color.TRANSPARENT);
            d.setStroke(dp(1), 0x33000000);
            d.setStroke(dp(1), color); // 主色边框近似
            d.setCornerRadius(0);
        } else {
            d.setColor(0x116750A4);
            d.setCornerRadius(dp(4));
        }
        return d;
    }

    private View colorBlock(int color, String label) {
        FrameLayout f = new FrameLayout(this);
        f.setBackgroundColor(color);
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        t.setTextColor(label.equals("底色") ? cOnSurface : cOnPrimary);
        t.setGravity(Gravity.CENTER);
        f.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return f;
    }
}
