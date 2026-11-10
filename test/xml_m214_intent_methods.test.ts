// test/xml_m214_intent_methods.test.ts — M214：Intent/Bundle/Uri/Activity 方法白名单
// 回归：intent.getFlags() 被报「没有 getFlags() 这个方法，是不是想写 getClass()」
import { describe, it, expect } from "vitest";
import { findMethodTypos, suggestMethod, KNOWN_METHODS } from "@/lib/xml/java-methods";
import { lintJava } from "@/lib/xml/java-lint";

describe("M214 Intent 方法白名单（getFlags 不再误报）", () => {
  it("intent.getFlags() 不报", () => {
    const code = `class A {
    void f() {
        Intent intent = getIntent();
        int flags = intent.getFlags();
    }
}`;
    const bad = findMethodTypos(code).filter((t) => t.name === "getFlags");
    expect(bad).toHaveLength(0);
  });

  it("Intent 常用方法都不报（extras / flags / action / data）", () => {
    const code = `class A {
    void f(Intent in, Intent out) {
        in.setFlags(0x40000000);
        in.addFlags(0x10000000);
        in.clearFlags();
        in.removeFlags(0x10);
        in.setAction("com.example.X");
        in.setData(uri);
        in.setDataAndType(uri, "image/*");
        String s = in.getStringExtra("k");
        int n = in.getIntExtra("k", 0);
        boolean b = in.getBooleanExtra("k", false);
        long l = in.getLongExtra("k", 0L);
        Bundle ex = in.getExtras();
        out.putExtra("k", 1);
        out.putLongExtra("k", 2L);
        out.putDoubleExtra("k", 3.0);
        out.putFloatExtra("k", 4.0f);
        out.putShortExtra("k", (short)5);
        out.removeExtra("k");
        out.replaceExtras(ex);
        ComponentName c = out.getComponent();
        out.setClassName("a", "b");
        out.setClass(ctx, Other.class);
        String t = out.getDataString();
        out.hasExtra("k");
        out.hasCategory("android.intent.category.LAUNCHER");
        out.addCategory("android.intent.category.HOME");
    }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("Bundle / Uri / Activity 新增白名单不报", () => {
    const code = `class A {
    void f(Bundle b, Uri u) {
        Bundle sub = b.getBundle("cfg");
        b.putBundle("cfg", sub);
        Parcelable p = b.getParcelable("p");
        b.putSerializable("s", obj);
        String[] arr = b.getStringArray("a");
        b.putIntArray("i", 1, 2);
        boolean has = b.containsKey("cfg");
        int sz = b.size();
        String last = u.getLastPathSegment();
        List<String> segs = u.getPathSegments();
        String q = u.getQueryParameter("id");
        Uri.Builder bd = u.buildUpon();
        Uri reparsed = Uri.parse(u.toString());
        Uri fromFile = Uri.fromFile(f);
        u.withAppendedPath("sub");
    }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("Activity/Context 调用不报（getSystemService / 文件 / 服务 / 广播）", () => {
    const code = `class A {
    void f() {
        PackageManager pm = getPackageManager();
        Service s = getSystemService(Context.WIFI_SERVICE);
        java.io.File d = getExternalFilesDir(null);
        File f = getFilesDir();
        s.openFileOutput("x", 0);
        s.openFileInput("x");
        s.deleteFile("x");
        String[] ls = s.fileList();
        s.bindService(intent, conn, 0);
        s.unbindService(conn);
        s.startService(intent);
        s.stopService(intent);
        s.registerReceiver(rcv, filter);
        s.unregisterReceiver(rcv);
        s.sendBroadcast(intent);
        s.sendOrderedBroadcast(intent, null);
        s.getContentResolver();
        s.getIdentifier("ic", "drawable", s.getPackageName());
        s.requestPermissions(perm, 1);
        s.checkSelfPermission(perm);
        s.shouldShowRequestPermissionRationale(perm);
        s.recreate();
        s.isTaskRoot();
        s.moveTaskToBack(true);
        s.getWindow();
        s.getPackageInfo(pkg, 0);
    }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("真拼错仍要报：getFlagz → getFlags / getFlagss → getFlags", () => {
    const code = `class A { void f() { intent.getFlagz(); } }`;
    const h = findMethodTypos(code).find((t) => t.name === "getFlagz");
    expect(h).toBeTruthy();
    expect(h!.suggestion).toBe("getFlags");
  });

  it("d==2 门槛：前 4 字符不同就不配对（防 getFlags→getClass 类误报）", () => {
    // 两个毫不相关的方法：前 4 字符不同 → 不配对
    expect(suggestMethod("setXexx", 2)).toBe(null);
    // 重复字符类真拼错（前 4 字符相同）仍要配对
    expect(suggestMethod("setTexxtt", 2)).toBe("setText");
    // d==1 不受影响
    expect(suggestMethod("setTexxt", 2)).toBe("setText");
    // 真正的近邻仍要配对：getVisibilit → getVisibility
    expect(suggestMethod("getVisibilit", 2)).toBe("getVisibility");
  });

  it("lintJava 全链路：完整 onCreate 里的 intent.getFlags() 不产生 method 类误报", () => {
    const code = `package com.example;
import android.content.Intent;
import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Intent intent = getIntent();
        int flags = intent.getFlags();
        if ((flags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
            finish();
        }
    }
}`;
    const issues = lintJava(code);
    const methodIssues = issues.filter((i) => i.code === "method" && i.msg.includes("getFlags"));
    expect(methodIssues).toHaveLength(0);
  });
});
