// test/xml_m180_res_search.test.ts — M180：资源搜索 / 分组 / 重命名同步 纯函数
import { describe, expect, it } from "vitest";
import { groupResDirs, renameResRef, resDirType, resSearchMatches } from "@/lib/xml/res-search";

describe("resDirType", () => {
  it("解析限定符目录名", () => {
    expect(resDirType("drawable-mdpi")).toBe("drawable");
    expect(resDirType("values-zh")).toBe("values");
    expect(resDirType("layout-land")).toBe("layout");
    expect(resDirType("foo")).toBeNull();
  });
});

describe("groupResDirs", () => {
  it("drawable/mipmap/values 系合并，其它各自成组", () => {
    const g = groupResDirs([
      "drawable-mdpi", "drawable-night", "drawable-xxhdpi",
      "mipmap-hdpi",
      "values", "values-night",
      "layout-land", "menu",
      "assets",
    ]);
    expect(g.get("drawable")?.sort()).toEqual(["drawable-mdpi", "drawable-night", "drawable-xxhdpi"]);
    expect(g.get("mipmap")).toEqual(["mipmap-hdpi"]);
    expect([...g.get("values")!]).toHaveLength(2);
    expect(g.get("layout-land")).toEqual(["layout-land"]);
    expect(g.get("assets")).toEqual(undefined);
  });
});

describe("resSearchMatches", () => {
  const items = [
    { rel: "app/src/main/res", name: "res", isDir: true },
    { rel: "app/src/main/res/drawable", name: "drawable", isDir: true },
    { rel: "app/src/main/res/drawable-mdpi", name: "drawable-mdpi", isDir: true },
    { rel: "app/src/main/res/drawable-mdpi/ic_home.png", name: "ic_home.png", isDir: false },
    { rel: "app/src/main/res/drawable/bg.xml", name: "bg.xml", isDir: false },
    { rel: "app/src/main/res/values/strings.xml", name: "strings.xml", isDir: false },
    { rel: "app/build.gradle.kts", name: "build.gradle.kts", isDir: false },
  ];

  it("文件名命中", () => {
    const hit = resSearchMatches(items, "home");
    expect(hit.map((h) => h.rel)).toContain("app/src/main/res/drawable-mdpi/ic_home.png");
    expect(hit.map((h) => h.rel)).not.toContain("app/src/main/res/values/strings.xml");
  });

  it("目录名命中 → 目录下文件全列出", () => {
    const hit = resSearchMatches(items, "drawable");
    const rels = hit.map((h) => h.rel);
    expect(rels).toContain("app/src/main/res/drawable/bg.xml");
    expect(rels).toContain("app/src/main/res/drawable-mdpi/ic_home.png");
    expect(rels).not.toContain("app/src/main/res/values/strings.xml");
  });

  it("大小写不敏感 + 空串不搜", () => {
    // “DRAWABLE” 全大写也是目录名命中
    expect(resSearchMatches(items, "DRAWABLE").some((h) => h.rel.includes("drawable/"))).toBe(true);
    expect(resSearchMatches(items, "strings").some((h) => h.rel.endsWith("strings.xml"))).toBe(true);
    expect(resSearchMatches(items, "  ")).toHaveLength(0);
  });
});

describe("renameResRef", () => {
  it("引用型：@drawable/x 换 @drawable/y（含 mipmap 互通）", () => {
    const xml = `<ImageView android:src="@drawable/ic_old" app:icon="@mipmap/ic_old" />
      <item name="x">@drawable/ic_old_2</item>`;
    const r = renameResRef(xml, "ref", "drawable", "ic_old", "ic_new");
    expect(r.n).toBe(2);
    expect(r.text).toContain('@drawable/ic_new');
    expect(r.text).toContain('@mipmap/ic_new');
    // 边界：ic_old_2 不能被误改
    expect(r.text).toContain("@drawable/ic_old_2");
  });

  it("values 定义型：只动 <string name=，不动 android:name", () => {
    const v = `<string name="app_name">A</string>
<activity android:name=".Old" />
<string-array name="opts">`;
    const r = renameResRef(v, "values", "string", "app_name", "app_title");
    expect(r.n).toBe(1);
    expect(r.text).toContain('<string name="app_title">A</string>');
    expect(r.text).toContain('android:name=".Old"'); // 没动
    expect(r.text).not.toContain('name="app_name"');
  });

  it("同名不替换 + 无命中 n=0 且文本原样", () => {
    const t = `@drawable/ic_a`;
    const r = renameResRef(t, "ref", "drawable", "ic_a", "ic_a");
    expect(r.n).toBe(0);
    expect(r.text).toBe(t);
    const r2 = renameResRef(t, "ref", "drawable", "zzz", "yyy");
    expect(r2.n).toBe(0);
    expect(r2.text).toBe(t);
  });
});
