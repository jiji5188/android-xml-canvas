// test/xml_m215_bare_symbol.test.ts — M215：整行裸标识符（`spy`）不再静默放过
// 用户反馈：贴了明显垃圾代码（一行只有 `spy`）编辑器零报警 → 说明「必须以 ; 结尾」这条
// 前置过滤把真 bug 一起滤掉了。合法语句末尾必然有 ;（或本身是控制流块），
// 所以整行只有一个标识符的情况一定是错的 —— 但要放过「上一行/下一行是续行」的拆行写法。
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";

const wrap = (body: string) => `package com.example;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

public class MainActivity extends android.app.Activity {
${body}
}`;

const syms = (src: string, isKotlin = false) =>
  lintJava(src, { isKotlin }).filter((i) => i.code === "sym");

describe("M215 裸标识符行", () => {
  it("单独一行 spy 会被报出来", () => {
    const src = wrap(`    protected void onCreate(Bundle b) {
        super.onCreate(b);
spy
        Log.d("X", "y");
    }`);
    const hits = syms(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].msg).toContain("spy");
    expect(hits[0].line).toBe(10);
    expect(hits[0].col).toBe(1);
  });

  it("带分号的 spy; 同样报（原有行为不回退）", () => {
    const src = wrap(`    void f() {
spy;
    }`);
    expect(syms(src).some((h) => h.msg.includes("spy"))).toBe(true);
  });

  it("链式调用被拆行不误报", () => {
    const src = wrap(`    void f(StringBuilder b) {
        b
            .append("a")
            .append("b");
    }`);
    expect(syms(src)).toHaveLength(0);
  });

  it("上一行没写完（结尾是 . ( , = 等）不误报", () => {
    const src = wrap(`    void f(StringBuilder b, int x) {
        int y = x +
            2;
        b.append(
            "a");
        int z = x
            ;
    }`);
    expect(syms(src)).toHaveLength(0);
  });

  it("已声明的变量单独成行不报（虽然也是错的，但先不扩大打击面）", () => {
    const src = wrap(`    void f() {
        int count = 0;
count
    }`);
    expect(syms(src)).toHaveLength(0);
  });

  it("else / try 等关键字行不报", () => {
    const src = wrap(`    void f(boolean c) {
        if (c) {
            return;
        }
else
        {
        }
    }`);
    expect(syms(src)).toHaveLength(0);
  });

  it("Kotlin 不启用（init / 属性委托等写法形态不同）", () => {
    const src = `class A {
    init {
        foo
    }
}`;
    expect(syms(src, true)).toHaveLength(0);
  });
});
