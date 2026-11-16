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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1) 解析要应用的系统主题（在 setContentView 之前 setTheme 才生效）
        String parent = getIntent() != null ? getIntent().getStringExtra("parent") : null;
        String presetId = getIntent() != null ? getIntent().getStringExtra("presetId") : null;
        applyPalette(getIntent());
        int themeId = resolveThemeStyle(parent);
        if (themeId != 0) setTheme(themeId);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(cSurface);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);
        root.setClipToPadding(false);
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 标题：主题名
        TextView title = tv(parent, 20, true);
        title.setTextColor(cOnSurface);
        root.addView(title);
        TextView sub = tv("parent = " + (parent == null ? "(默认)" : parent), 12, false);
        sub.setTextColor(Color.rgb(0x60, 0x60, 0x60));
        root.addView(sub, topParams(2));
        root.addView(spacer(14));

        // 1. 主按钮
        Button btn = new Button(this);
        btn.setText("主按钮  PrimaryButton");
        btn.setTextColor(cOnPrimary);
        btn.setBackground(pill(cPrimary, true));
        root.addView(btn);

        // 2. 次按钮（描边）
        Button btn2 = new Button(this);
        btn2.setText("次按钮  OutlinedButton");
        btn2.setTextColor(cPrimary);
        btn2.setBackground(outlinePill(cPrimary));
        root.addView(btn2, topParams(10));

        // 3. 卡片
        FrameLayout card = new FrameLayout(this);
        card.setBackground(pill(0xFFEAE0F7, false));
        int cpad = dp(14);
        card.setPadding(cpad, cpad, cpad, cpad);
        LinearLayout cardIn = new LinearLayout(this);
        cardIn.setOrientation(LinearLayout.VERTICAL);
        TextView cardTitle = tv("卡片  Card", 15, true);
        cardTitle.setTextColor(cOnSurface);
        cardIn.addView(cardTitle);
        TextView cardBody = tv("卡片正文：Material 卡片，圆角 + 阴影 + 次色点缀。", 13, false);
        cardBody.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        cardIn.addView(cardBody, topParams(4));
        card.addView(cardIn);
        root.addView(card, topParams(14));

        // 4. 开关
        Switch sw = new Switch(this);
        sw.setText("开关  Switch");
        sw.setTextColor(cOnSurface);
        sw.setThumbTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        sw.setTrackTintList(android.content.res.ColorStateList.valueOf(0xFFE8DEF8));
        sw.setChecked(true);
        root.addView(sw, topParams(14));

        // 5. 单选
        LinearLayout radioRow = new LinearLayout(this);
        radioRow.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < 2; i++) {
            RadioButton rb = new RadioButton(this);
            rb.setText(i == 0 ? "选项 A" : "选项 B");
            rb.setTextColor(cOnSurface);
            rb.setChecked(i == 0);
            rb.setButtonTintList(android.content.res.ColorStateList.valueOf(cPrimary));
            radioRow.addView(rb, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        root.addView(radioRow, topParams(14));

        // 6. 勾选
        CheckBox cb = new CheckBox(this);
        cb.setText("勾选  CheckBox");
        cb.setTextColor(cOnSurface);
        cb.setButtonTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        cb.setChecked(true);
        root.addView(cb, topParams(10));

        // 7. 滑块
        SeekBar bar = new SeekBar(this);
        bar.setMax(100);
        bar.setProgress(60);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        bar.setSecondaryProgressTintList(android.content.res.ColorStateList.valueOf(0x446750A4));
        bar.setThumbTintList(android.content.res.ColorStateList.valueOf(cPrimary));
        root.addView(bar, topParams(14));

        // 8. 下拉
        Spinner sp = new Spinner(this);
        sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new String[] { "下拉选项 1", "下拉选项 2", "下拉选项 3" }));
        root.addView(sp, topParams(14));

        // 9. 输入框
        EditText et = new EditText(this);
        et.setHint("输入框  EditText");
        et.setText("在此输入文字");
        et.setTextColor(cOnSurface);
        et.setHintTextColor(Color.rgb(0x90, 0x90, 0x90));
        et.setBackground(underline(cPrimary));
        root.addView(et, topParams(14));

        // 10. 文字层级
        root.addView(spacer(14));
        TextView h1 = tv("标题层级  Headline", 20, true);
        h1.setTextColor(cOnSurface);
        root.addView(h1);
        TextView body = tv("正文层级  Body：这是 Material 标准正文样式，行高 1.5，灰字。", 14, false);
        body.setTextColor(Color.rgb(0x49, 0x45, 0x4F));
        root.addView(body, topParams(4));
        TextView cap = tv("说明文字  Caption · 次要信息用小号灰字", 12, false);
        cap.setTextColor(Color.rgb(0x79, 0x74, 0x7E));
        root.addView(cap, topParams(4));

        // 11. 强调色条（直观看主色/次色）
        LinearLayout swatch = new LinearLayout(this);
        swatch.setOrientation(LinearLayout.HORIZONTAL);
        swatch.addView(colorBlock(cPrimary, "主色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        swatch.addView(colorBlock(cSecondary, "次色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        swatch.addView(colorBlock(cSurface, "底色"), new LinearLayout.LayoutParams(0, dp(40), 1));
        root.addView(swatch, topParams(16));

        setContentView(sv);
    }

    // ---- 调色板（JS 传过来的预设色，精确套）----
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

    /** parent 主题名 → 系统里一定存在的 framework style id。androidx 的映射到最近等价。 */
    private int resolveThemeStyle(String parent) {
        if (parent == null || parent.isEmpty()) return 0;
        // 先试 android 命名空间（Theme.Material / Theme.Holo / Theme.DeviceDefault…）
        int id = getResources().getIdentifier(sanitize(parent), "style", "android");
        if (id != 0) return id;
        // androidx 系 → 映射到 framework 等价
        String p = parent.replace("Theme.", "");
        if (p.contains("Material3") || p.contains("MaterialComponents") || p.equals("Material")) {
            boolean dark = p.contains("Dark") && !p.contains("DayNight");
            return dark ? android.R.style.Theme_Material : android.R.style.Theme_Material_Light;
        }
        if (p.contains("AppCompat")) {
            boolean light = p.contains("Light");
            return light ? android.R.style.Theme_Material_Light : android.R.style.Theme_Material;
        }
        if (p.contains("Holo")) {
            boolean light = p.contains("Light");
            return light ? android.R.style.Theme_Holo_Light : android.R.style.Theme_Holo;
        }
        if (p.contains("DeviceDefault")) return android.R.style.Theme_DeviceDefault;
        // 兜底：Material 浅色
        return android.R.style.Theme_Material_Light;
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

    private GradientDrawable pill(int color, boolean filled) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(8));
        return d;
    }

    private GradientDrawable outlinePill(int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.TRANSPARENT);
        d.setStroke(dp(1), stroke);
        d.setCornerRadius(dp(8));
        return d;
    }

    private GradientDrawable underline(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(0x116750A4); // 淡主色填充当输入框背景
        d.setCornerRadius(dp(4));
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
