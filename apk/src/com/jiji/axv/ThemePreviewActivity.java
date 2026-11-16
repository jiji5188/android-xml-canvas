package com.jiji.axv;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.ContextThemeWrapper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/** 主题预览页（M320 建立 / M325 改系统原生 / M327 精简）。
 *
 *  用户要求（2026-11-16）：
 *   - Dialog：用系统 AlertDialog 原生渲染，不要自定义布局
 *   - 页面：不需要精致，**能分辨主题配色 / 有无标题栏 / 是否全屏**就够
 *
 *  所以这一页只做三件事：
 *   1) 背景用主题自己的 windowBackground（真机效果）
 *   2) 显示该预设的配色块（主色/次色/背景/文字 + 十六进制）
 *   3) 文字说明「标题栏：有/无」「全屏：是/否」
 *  标题栏本身交给系统 ActionBar（无 ActionBar 主题就真的没有），全屏用 FLAG_FULLSCREEN。
 */
public class ThemePreviewActivity extends Activity {

    private boolean fNoActionBar = false;
    private boolean fFullscreen = false;

    /** M328：预设调色板（与主题面板/写入 themes.xml 的 colorPrimary 等一致） */
    private boolean hasPalette = false;
    private int cP = 0xFF888888, cOnP = 0xFFFFFFFF, cSec = 0xFFAAAAAA, cSurf = 0xFFFFFFFF, cOnSurf = 0xFF000000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String parent = getIntent() != null ? getIntent().getStringExtra("parent") : null;
        String kind = getIntent() != null ? getIntent().getStringExtra("kind") : null;
        String paletteJson = getIntent() != null ? getIntent().getStringExtra("palette") : null;
        boolean isDialog = "dialog".equals(kind);
        applyFeatures(getIntent());
        applyPalette(paletteJson);

        int themeId = resolveThemeStyle(parent);

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

        if (isDialog) {
            getWindow().setBackgroundDrawable(new ColorDrawable(0x99000000));
            int dlgTheme = themeId != 0 ? themeId : android.R.style.Theme_Material_Light_Dialog;
            showSystemDialog(dlgTheme, parent);
            return;
        }

        // M328：壳里没有 Material/AppCompat 资源，系统等价主题自带色与预设不同 -> 显式套预设色
        if (hasPalette) {
            getWindow().setBackgroundDrawable(new ColorDrawable(cSurf));
            if (!fFullscreen) {
                try { getWindow().setStatusBarColor(cP); } catch (Exception ignore) { }
            }
            if (!fNoActionBar) {
                android.app.ActionBar ab = getActionBar();
                if (ab != null) ab.setBackgroundDrawable(new ColorDrawable(cP));
            }
        }

        // ---- 极简：配色块 + 标题栏/全屏说明 ----
        ScrollView sv = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(parent == null || parent.isEmpty() ? "主题预览" : parent);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        if (hasPalette) title.setTextColor(cOnSurf);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("配色按预设写入 themes.xml 的颜色渲染（与真机 App 一致）");
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        sub.setAlpha(0.7f);
        if (hasPalette) sub.setTextColor(cOnSurf);
        root.addView(sub, topParams(4));

        // 配色块
        try {
            JSONObject p = new JSONObject(paletteJson == null ? "{}" : paletteJson);
            LinearLayout chips = new LinearLayout(this);
            chips.setOrientation(LinearLayout.HORIZONTAL);
            chips.setPadding(0, dp(14), 0, 0);
            addChip(chips, "主色", p.optString("primary", "#FF888888"));
            addChip(chips, "次色", p.optString("secondary", "#FFAAAAAA"));
            addChip(chips, "背景", p.optString("surface", "#FFFFFFFF"));
            addChip(chips, "文字", p.optString("onSurface", "#FF000000"));
            root.addView(chips);
        } catch (Exception ignore) {
        }

        // 状态说明
        LinearLayout status = new LinearLayout(this);
        status.setOrientation(LinearLayout.VERTICAL);
        TextView l1 = new TextView(this);
        l1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        l1.setText("标题栏：" + (fNoActionBar ? "无（NoActionBar 主题）" : "有（系统 ActionBar）"));
        TextView l2 = new TextView(this);
        l2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        l2.setText("全屏：" + (fFullscreen ? "是（隐藏状态栏）" : "否"));
        if (hasPalette) { l1.setTextColor(cOnSurf); l2.setTextColor(cOnSurf); }
        status.addView(l1, topParams(16));
        status.addView(l2, topParams(4));

        // M329：AppCompat / Material 主题 → 提示需自行加依赖（工具不内置资源库）
        String parentClean = parent == null ? "" : parent;
        boolean needsDep = false;
        String depMaven = "";
        if (parentClean.startsWith("Theme.AppCompat")) { needsDep = true; depMaven = "androidx.appcompat:appcompat"; }
        else if (parentClean.startsWith("Theme.Material3") || parentClean.startsWith("Theme.MaterialComponents")) {
            needsDep = true; depMaven = "com.google.android.material:material";
        }
        if (needsDep) {
            TextView l3 = new TextView(this);
            l3.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            l3.setText("⚠ 该主题需你在项目 gradle 添加 " + depMaven + " 依赖才是 1:1 观感；\n当前预览用系统等价主题 + 你选的配色近似。");
            l3.setAlpha(0.8f);
            if (hasPalette) l3.setTextColor(cOnSurf);
            status.addView(l3, topParams(10));
        }
        root.addView(status);

        sv.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(sv);
    }

    /** 一个配色块：上方色卡 + 下方「名称 + 十六进制」 */
    private void addChip(LinearLayout row, String label, String argb) {
        int color = parseArgb(argb);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        if (row.getChildCount() > 0) lp.setMargins(dp(6), 0, 0, 0);
        col.setLayoutParams(lp);

        View sw = new View(this);
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(6));
        g.setStroke(dp(1), 0x33000000);
        sw.setBackground(g);
        col.addView(sw, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        t.setText(label + "\n" + shortHex(argb));
        col.addView(t, topParams(4));

        row.addView(col);
    }

    private String shortHex(String argb) {
        String h = argb == null ? "" : argb.trim();
        if (h.startsWith("#")) h = h.substring(1);
        if (h.length() == 8) h = "#" + h.substring(2);
        else h = "#" + h;
        return h.toUpperCase();
    }

    private int parseArgb(String argb) {
        try {
            String h = argb.trim();
            if (h.startsWith("#")) h = h.substring(1);
            long v = Long.parseLong(h, 16);
            if (h.length() == 6) v |= 0xFF000000L;
            return (int) v;
        } catch (Exception e) {
            return 0xFF888888;
        }
    }

    /** 系统 AlertDialog：标题/图标/消息/确定-取消-稍后 全部系统原生布局 */
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

    /** M328：解析预设调色板（ARGB 字符串） */
    private void applyPalette(String paletteJson) {
        if (paletteJson == null || paletteJson.isEmpty()) return;
        try {
            JSONObject p = new JSONObject(paletteJson);
            cP = parseArgb(p.optString("primary", "#FF888888"));
            cOnP = parseArgb(p.optString("onPrimary", "#FFFFFFFF"));
            cSec = parseArgb(p.optString("secondary", "#FFAAAAAA"));
            cSurf = parseArgb(p.optString("surface", "#FFFFFFFF"));
            cOnSurf = parseArgb(p.optString("onSurface", "#FF000000"));
            hasPalette = true;
        } catch (Exception ignore) {
        }
    }

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

    /** parent → 系统里一定存在的 framework style id */
    private int resolveThemeStyle(String parent) {
        if (parent == null || parent.isEmpty()) return 0;
        int id = getResources().getIdentifier(sanitize(parent), "style", "android");
        if (id != 0) return id;
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
        return isDialog ? android.R.style.Theme_Material_Light_Dialog : android.R.style.Theme_Material_Light;
    }

    private String sanitize(String parent) {
        String p = parent.replaceFirst("^@android:style/", "").replaceFirst("^Theme\\.", "");
        return "Theme." + p;
    }

    private LinearLayout.LayoutParams topParams(int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(topDp), 0, 0);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
