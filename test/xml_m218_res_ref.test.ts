// test/xml_m218_res_ref.test.ts — M218：资源引用扫描口径（res-ref.ts）唯一实现
// 以前 res-collect / xml-res-check 各写一条正则，类型白名单不一样，
// 最容易出「@menu/ 一边认一边不认」这种静默差异。这里守住共同边界。
import { describe, expect, it } from "vitest";
import { resRefsIn, stripResExt, RES_REF_TYPES } from "@/lib/xml/res-ref";

describe("res-ref 资源引用扫描", () => {
  it("带类型的引用都能认，包括长类型名（string-array 不被 string 截走）", () => {
    const refs = resRefsIn(`@drawable/a @mipmap/b @layout/c @string/d @string-array/e @dimen/f @id/g`);
    expect(refs.map((r) => r.type)).toEqual([
      "drawable", "mipmap", "layout", "string", "string-array", "dimen", "id",
    ]);
  });

  it("跳过 @+id 声明、@android: 与 @*android: 框架资源", () => {
    const refs = resRefsIn(`@+id/btn @android:color/white @*android:style/x @drawable/real`);
    expect(refs.map((r) => r.raw)).toEqual(["@drawable/real"]);
  });

  it("不带类型前缀的 @name 不算引用", () => {
    expect(resRefsIn(`@only_name @foo bar`)).toEqual([]);
  });

  it("refsIn / xml-res-check 看到的引用集合一致（同一份正则）", () => {
    const xml = `<TextView android:src="@drawable/ic_home" android:text="@string/app_name" android:background="@color/red" android:padding="@dimen/pad4" />`;
    const refs = resRefsIn(xml);
    // 每个都带类型、名字、原文、偏移四件套
    for (const r of refs) {
      expect(RES_REF_TYPES).toContain(r.type as (typeof RES_REF_TYPES)[number]);
      expect(r.raw.startsWith("@")).toBe(true);
      expect(xml.slice(r.index, r.index + r.raw.length)).toBe(r.raw);
    }
    expect(refs.map((r) => r.raw)).toEqual([
      "@drawable/ic_home", "@string/app_name", "@color/red", "@dimen/pad4",
    ]);
  });

  it("stripResExt 只剥图片/xml 扩展名，不误伤 @dimen/text.size 这类真名", () => {
    expect(stripResExt("ic_launcher.png")).toBe("ic_launcher");
    expect(stripResExt("ic_launcher.webp")).toBe("ic_launcher");
    expect(stripResExt("bg.9.png")).toBe("bg");
    expect(stripResExt("bg_9.png")).toBe("bg_9"); // 9-patch 老写法
    expect(stripResExt("text.size")).toBe("text.size"); // 不是扩展名，保留
  });
});
