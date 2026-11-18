// test/xml_m404_java_doc.test.ts — M404: symbolDoc 查选中类/方法的 Javadoc/KDoc
import { describe, it, expect } from "vitest";
import { symbolDoc } from "@/lib/xml/java-doc";

const JAVA_SRC = `package com.example.app;

import android.app.Activity;
import android.os.Bundle;

/**
 * 主页 Activity。
 *
 * @author jiji
 */
public class MainActivity extends Activity {
    /**
     * 初始化按钮监听。
     * @param context 上下文
     * @return 是否成功
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
    }

    /** 点击标题栏，跳转设置页。 */
    void openSettings() {
        startActivity(new Intent(this, SettingsActivity.class));
    }
}
`;

describe("symbolDoc", () => {
  it("查类文档：返回类的 Javadoc + 类名", () => {
    const r = symbolDoc(JAVA_SRC, false, "MainActivity");
    expect(r).not.toBeNull();
    expect(r!.title).toMatch(/MainActivity/);
    expect(r!.body).toMatch(/主页 Activity/);
    expect(r!.body).toMatch(/@author jiji/);
  });

  it("查方法文档：返回方法 Javadoc + 签名", () => {
    const r = symbolDoc(JAVA_SRC, false, "onCreate");
    expect(r).not.toBeNull();
    expect(r!.body).toMatch(/初始化按钮监听/);
    expect(r!.body).toMatch(/@param context/);
  });

  it("查单行 Javadoc 方法", () => {
    const r = symbolDoc(JAVA_SRC, false, "openSettings");
    expect(r).not.toBeNull();
    expect(r!.body).toMatch(/点击标题栏，跳转设置页/);
  });

  it("查不到的符号返回 null", () => {
    expect(symbolDoc(JAVA_SRC, false, "notThere")).toBeNull();
  });

  it("没有注释的方法：body 退化为签名（仍能查看）", () => {
    const src = `public class A { void plain() {} }`;
    const r = symbolDoc(src, false, "plain");
    // plain 没注释，但能定位到方法 → body 就是签名
    expect(r).not.toBeNull();
    expect(r!.title).toMatch(/plain/);
  });

  it("Kotlin：查 fun 的 KDoc", () => {
    const kt = `/**
 * 计算总和。
 */
fun sum(a: Int, b: Int): Int {
    return a + b
}
`;
    const r = symbolDoc(kt, true, "sum");
    expect(r).not.toBeNull();
    expect(r!.body).toMatch(/计算总和/);
  });

  it("空源码返回 null", () => {
    expect(symbolDoc("", false, "x")).toBeNull();
  });
});
