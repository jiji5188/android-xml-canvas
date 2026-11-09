// test/xml_m196_rename_java.test.ts — M196：资源改名同步到 Java/Kotlin 的 R.xxx 引用
import { describe, it, expect } from "vitest";
import { renameResRef, singularResType } from "../lib/xml/res-search";

describe("singularResType", () => {
  it("values 文件名归一化成 R 类型", () => {
    expect(singularResType("strings")).toBe("string");
    expect(singularResType("colors")).toBe("color");
    expect(singularResType("dimens")).toBe("dimen");
    expect(singularResType("styles")).toBe("style");
    expect(singularResType("attrs")).toBe("attr");
  });

  it("已是单数 / 非 values 类型原样返回", () => {
    expect(singularResType("string")).toBe("string");
    expect(singularResType("drawable")).toBe("drawable");
  });
});

describe("renameResRef：Java 里的 R.type.name 也要改", () => {
  it("R.drawable.ic_home → R.drawable.ic_main", () => {
    const src = `setImageResource(R.drawable.ic_home);`;
    const r = renameResRef(src, "ref", "drawable", "ic_home", "ic_main");
    expect(r.text).toBe(`setImageResource(R.drawable.ic_main);`);
    expect(r.n).toBe(1);
  });

  it("R.mipmap 与 drawable 互通", () => {
    const src = `R.mipmap.ic_home + R.drawable.ic_home`;
    const r = renameResRef(src, "ref", "drawable", "ic_home", "ic_main");
    expect(r.text).toBe(`R.mipmap.ic_main + R.drawable.ic_main`);
    expect(r.n).toBe(2);
  });

  it("R.layout.x + XML 里的 @layout/x 一起改（Java 文件走 ref 分支）", () => {
    const java = `setContentView(R.layout.activity_main);`;
    const r = renameResRef(java, "ref", "layout", "activity_main", "activity_home");
    expect(r.text).toContain("R.layout.activity_home");
    const xml = `<include layout="@layout/activity_main" />`;
    expect(renameResRef(xml, "ref", "layout", "activity_main", "activity_home").text).toContain(
      "@layout/activity_home",
    );
  });

  it("不误伤前缀相同的名字（ic_home2 / my_ic_home）", () => {
    const src = `R.drawable.ic_home R.drawable.ic_home2 R.drawable.my_ic_home`;
    const r = renameResRef(src, "ref", "drawable", "ic_home", "ic_main");
    expect(r.text).toBe(`R.drawable.ic_main R.drawable.ic_home2 R.drawable.my_ic_home`);
    expect(r.n).toBe(1);
  });

  it("values 分支：<string name> 改了，Java 的 R.string.xxx 也改", () => {
    const xml = `<?xml version="1.0"?>\n<resources>\n  <string name="app_title">Hi</string>\n</resources>`;
    const r1 = renameResRef(xml, "values", "strings", "app_title", "app_name_v2");
    expect(r1.text).toContain(`<string name="app_name_v2">Hi</string>`);

    const java = `getString(R.string.app_title)`;
    const r2 = renameResRef(java, "values", "strings", "app_title", "app_name_v2");
    expect(r2.text).toBe(`getString(R.string.app_name_v2)`);
  });

  it("colors.xml（resType=colors）也能命中 <color name> 与 R.color", () => {
    const xml = `<resources><color name="brand">#fff</color></resources>`;
    const r1 = renameResRef(xml, "values", "colors", "brand", "primary");
    expect(r1.text).toContain(`<color name="primary">`);
    const java = `getColor(R.color.brand)`;
    expect(renameResRef(java, "values", "colors", "brand", "primary").text).toBe(`getColor(R.color.primary)`);
  });

  it("android:name 不被当成资源名改掉", () => {
    const xml = `<activity android:name=".app_title" />`;
    const r = renameResRef(xml, "values", "strings", "app_title", "x");
    expect(r.n).toBe(0);
    expect(r.text).toBe(xml);
  });
});
