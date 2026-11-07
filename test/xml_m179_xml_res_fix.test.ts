// test/xml_m179_xml_res_fix.test.ts
// M179：XML 资源引用检查（@drawable/ic_hom → @drawable/ic_home）+ 行内安全替换
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { checkXmlResRefs, applyFixToLine } from "@/lib/xml/xml-res-check";

const env = {
  drawable: ["ic_home", "ic_search", "bg_button"],
  mipmap: ["ic_launcher"],
  string: ["app_name", "login_title"],
  color: ["primary", "primary_dark"],
  dimen: ["spacing_m"],
  layout: ["activity_main", "activity_detail"],
};

const first = (out: ReturnType<typeof checkXmlResRefs>) => out[0];

describe("checkXmlResRefs — 拼错可修", () => {
  it("@drawable/ic_hom → 带 fix 指向 ic_home", () => {
    const src = `<ImageView android:src="@drawable/ic_hom" />`;
    const out = checkXmlResRefs(src, env);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("warn");
    expect(out[0].fix).toEqual({
      from: "@drawable/ic_hom",
      to: "@drawable/ic_home",
      label: "@drawable/ic_hom → @drawable/ic_home",
    });
    expect(out[0].message).toContain("是不是想写");
  });

  it("@string/app_nam → app_name", () => {
    const out = checkXmlResRefs(`<TextView android:text="@string/app_nam" />`, env);
    expect(first(out)?.fix?.to).toBe("@string/app_name");
  });

  it("@color/primry → primary", () => {
    const out = checkXmlResRefs(`<View android:background="@color/primry" />`, env);
    expect(first(out)?.fix?.to).toBe("@color/primary");
  });

  it("长名字允许差 2 个字符（activity_mian → activity_main）", () => {
    const out = checkXmlResRefs(`<include layout="@layout/activity_mian" />`, env);
    expect(first(out)?.fix?.to).toBe("@layout/activity_main");
  });

  it("行号正确（第 3 行的问题报 line 3）", () => {
    const src = ["<LinearLayout>", "  <View", `    android:background="@color/primry" />`, "</LinearLayout>"].join("\n");
    expect(first(checkXmlResRefs(src, env))?.line).toBe(3);
  });

  it("同一行两个错各给一条", () => {
    const src = `<TextView android:text="@string/app_nam" android:textColor="@color/primry" />`;
    expect(checkXmlResRefs(src, env)).toHaveLength(2);
  });
});

describe("checkXmlResRefs — 不该报的情况", () => {
  it("框架资源 / 新建 id / 主题属性都不管", () => {
    const src = `<View android:id="@+id/btn_ok" android:background="?attr/colorPrimary"
      android:src="@android:drawable/ic_delete" style="@style/Theme.Material3.DayNight" />`;
    expect(checkXmlResRefs(src, env)).toEqual([]);
  });

  it("能对上的引用不报", () => {
    expect(checkXmlResRefs(`<View android:background="@color/primary" />`, env)).toEqual([]);
  });

  it("清单里这一类是空的 → 整类都不检查（没上传 res 时不刷屏）", () => {
    const only = { drawable: ["ic_home"] };
    expect(checkXmlResRefs(`<TextView android:text="@string/whatever" />`, only)).toEqual([]);
  });

  it("完全没资源 → 什么都不报", () => {
    expect(checkXmlResRefs(`<View android:background="@color/primry" />`, {})).toEqual([]);
  });

  it("注释里的引用不算", () => {
    const src = `<LinearLayout>\n  <!-- 旧写法 @drawable/ic_hom -->\n</LinearLayout>`;
    expect(checkXmlResRefs(src, env)).toEqual([]);
  });

  it("跨行注释里的引用也不算", () => {
    const src = `<LinearLayout>\n  <!--\n   @drawable/ic_hom\n   @string/app_nam\n  -->\n</LinearLayout>`;
    expect(checkXmlResRefs(src, env)).toEqual([]);
  });

  it("平票（两个候选一样近）不给 fix，也不瞎猜", () => {
    const out = checkXmlResRefs(`<ImageView android:src="@drawable/icon_c" />`, {
      drawable: ["icon_a", "icon_b"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].fix).toBeUndefined();
  });

  it("color 这类库资源多的类型，猜不出来就不报", () => {
    const out = checkXmlResRefs(`<View android:background="@color/primry" />`, {
      color: ["primary", "primrx"],
    });
    expect(out).toEqual([]);
  });

  it("string 这类库资源多的类型，猜不出来就不报", () => {
    const out = checkXmlResRefs(`<TextView android:text="@string/zzzzzzz" />`, env);
    expect(out).toEqual([]);
  });

  it("drawable 猜不出来仍然报（项目自己该有）", () => {
    const out = checkXmlResRefs(`<ImageView android:src="@drawable/zzzzzzz" />`, env);
    expect(out).toHaveLength(1);
    expect(out[0].fix).toBeUndefined();
    expect(out[0].message).toContain("没找到");
  });
});

describe("checkXmlResRefs — @id / @style", () => {
  const env2 = { ...env, id: ["tv_welcome", "et_phone"], style: ["AppTheme", "AppTheme.Full"] };

  it("@id 拼错给 fix（布局之间互相引用常见）", () => {
    const out = checkXmlResRefs(`<View android:layout_below="@id/tv_welcom" />`, env2);
    expect(first(out)?.fix?.to).toBe("@id/tv_welcome");
  });

  it("@style 拼错给 fix", () => {
    const out = checkXmlResRefs(`<TextView style="@style/AppThem" />`, env2);
    expect(first(out)?.fix?.to).toBe("@style/AppTheme");
  });

  it("@id 猜不出来就不报（可能来自没扫到的文件）", () => {
    expect(checkXmlResRefs(`<View android:layout_below="@id/zzzzzzz" />`, env2)).toEqual([]);
  });

  it("@style 猜不出来就不报（可能来自三方库）", () => {
    expect(checkXmlResRefs(`<TextView style="@style/zzzzzzz" />`, env2)).toEqual([]);
  });

  it("没给 id/style 清单时整类跳过", () => {
    expect(checkXmlResRefs(`<View android:layout_below="@id/tv_welcom" />`, env)).toEqual([]);
  });
});

describe("applyFixToLine — 整词替换", () => {
  it("前缀相同的资源不会被改坏", () => {
    const line = `<ImageView android:src="@drawable/ic_home" />`;
    const r = applyFixToLine(line, "@drawable/ic_hom", "@drawable/ic_home2");
    expect(r.count).toBe(0);
    expect(r.text).toBe(line);
  });

  it("同一行多处一起改", () => {
    const line = `a="@color/primry" b="@color/primry"`;
    const r = applyFixToLine(line, "@color/primry", "@color/primary");
    expect(r.count).toBe(2);
    expect(r.text).toBe(`a="@color/primary" b="@color/primary"`);
  });

  it("后面紧跟字母的不算（R.id.titleX 不能被 R.id.title 改）", () => {
    const r = applyFixToLine(`R.id.titleX`, "R.id.title", "R.id.title2");
    expect(r.count).toBe(0);
  });

  it("from 里有正则元字符也不炸", () => {
    const r = applyFixToLine(`x@string/a.b`, "@string/a.b", "@string/ab");
    expect(r.count).toBe(1);
    expect(r.text).toBe("x@string/ab");
  });
});
