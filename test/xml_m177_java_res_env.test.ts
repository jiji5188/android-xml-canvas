// test/xml_m177_java_res_env.test.ts
// M177：Java 代码检查接入项目真实资源（R.id / R.layout / R.string … + findViewById 类型）
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { collectIdsFromLayout, collectResEnv, isAssignableTo } from "@/lib/xml/java-res-env";
import { lintJava } from "@/lib/xml/java-lint";

const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello" />

    <Button
        android:id="@+id/go"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Go" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/list"
        android:layout_width="match_parent"
        android:layout_height="0dp" />
</LinearLayout>`;

describe("collectIdsFromLayout", () => {
  it("抽出所有 @+id，并记住控件标签", () => {
    const { ids, idTag } = collectIdsFromLayout(LAYOUT);
    expect(ids.sort()).toEqual(["go", "list", "title"]);
    expect(idTag.title).toBe("TextView");
    expect(idTag.go).toBe("Button");
    // 全限定标签取短名
    expect(idTag.list).toBe("RecyclerView");
  });

  it("xml 没写完（解析失败）时退化成正则，仍能抽到 id", () => {
    const broken = `<LinearLayout android:id="@+id/box"><TextView android:id="@id/old"`;
    const { ids } = collectIdsFromLayout(broken);
    expect(ids).toContain("box");
    expect(ids).toContain("old");
  });
});

describe("collectResEnv", () => {
  it("合并多个布局 + values + 图片资源", () => {
    const env = collectResEnv({
      layouts: { "activity_main.xml": LAYOUT },
      currentLayoutXml: `<FrameLayout android:id="@+id/root" xmlns:android="http://schemas.android.com/apk/res/android" />`,
      valuesFiles: {
        "strings.xml": `<resources><string name="app_name">A</string></resources>`,
        "colors.xml": `<resources><color name="primary">#fff</color></resources>`,
        "dimens.xml": `<resources><dimen name="gap">8dp</dimen></resources>`,
        "styles.xml": `<resources><style name="AppTheme" /></resources>`,
      },
      drawables: ["ic_launcher_foreground.xml", "photo.jpg"],
    });
    expect(env.ids).toContain("root");
    expect(env.ids).toContain("title");
    expect(env.layout).toEqual(["activity_main"]);
    expect(env.string).toEqual(["app_name"]);
    expect(env.color).toEqual(["primary"]);
    expect(env.dimen).toEqual(["gap"]);
    expect(env.style).toEqual(["AppTheme"]);
    expect(env.drawable).toEqual(["ic_launcher_foreground", "photo"]);
  });

  it("文件名不认识时四种标签都收（项目自己的 values 文件）", () => {
    const env = collectResEnv({
      valuesFiles: {
        "my_values.xml": `<resources><string name="s1"/><color name="c1"/><dimen name="d1"/><style name="st1"/></resources>`,
      },
    });
    expect(env.string).toEqual(["s1"]);
    expect(env.color).toEqual(["c1"]);
    expect(env.dimen).toEqual(["d1"]);
  });
});

describe("lintJava + 项目资源", () => {
  const ids = ["title", "go"];
  const idTag = { title: "TextView", go: "Button" };

  it("R.id 不存在 → rid 警告", () => {
    const src = `public class A { void f() { View v = findViewById(R.id.titel); } }`;
    const out = lintJava(src, { ids });
    const hit = out.find((i) => i.code === "rid");
    expect(hit?.msg).toContain("R.id.titel");
  });

  it("R.id 存在且类型对得上 → 不报", () => {
    const src = `public class A { void f() { TextView t = (TextView) findViewById(R.id.title); } }`;
    const out = lintJava(src, { ids, idTag });
    expect(out.filter((i) => i.code === "rid" || i.code === "ridtype")).toHaveLength(0);
  });

  it("R.layout 不存在 → rtype 警告；存在则不报", () => {
    const bad = `public class A { void f() { setContentView(R.layout.activity_mian); } }`;
    expect(lintJava(bad, { res: { layout: ["activity_main"] } }).some((i) => i.code === "rtype")).toBe(true);
    const ok = `public class A { void f() { setContentView(R.layout.activity_main); } }`;
    expect(lintJava(ok, { res: { layout: ["activity_main"] } }).some((i) => i.code === "rtype")).toBe(false);
  });

  it("R.string / R.drawable / R.color 各自查", () => {
    const src = `public class A { void f() {
      String s = getString(R.string.app_nam);
      int i = R.drawable.ic_luncher;
      int c = R.color.primry;
    } }`;
    const out = lintJava(src, {
      res: { string: ["app_name"], drawable: ["ic_launcher"], color: ["primary"] },
    });
    const msgs = out.filter((i) => i.code === "rtype").map((i) => i.msg).join("\n");
    expect(msgs).toContain("R.string.app_nam");
    expect(msgs).toContain("R.drawable.ic_luncher");
    expect(msgs).toContain("R.color.primry");
  });

  it("不传 res 就完全不查（不打扰）", () => {
    const src = `public class A { void f() { int c = R.color.nothing; } }`;
    expect(lintJava(src, {}).some((i) => i.code === "rtype")).toBe(false);
  });

  it("findViewById 类型不匹配 → ridtype 警告（Button 当成 ImageView 用）", () => {
    const src = `public class A { void f() {
      ImageView t = (ImageView) findViewById(R.id.go);
    } }`;
    const hit = lintJava(src, { ids, idTag }).find((i) => i.code === "ridtype");
    expect(hit?.msg).toContain("R.id.go");
    expect(hit?.msg).toContain("Button");
  });

  it("父类接收子类不算错（Button → TextView 可以）", () => {
    const src = `public class A { void f() {
      Button b = (Button) findViewById(R.id.title);
    } }`;
    // title 是 TextView，赋给 Button 不行 → 应报
    expect(lintJava(src, { ids, idTag }).some((i) => i.code === "ridtype")).toBe(true);
    const okSrc = `public class A { void f() {
      TextView t = (TextView) findViewById(R.id.go);
    } }`;
    // go 是 Button，Button 能赋给 TextView → 不报
    expect(lintJava(okSrc, { ids, idTag }).some((i) => i.code === "ridtype")).toBe(false);
  });

  it("类型兼容表：常见父子关系", () => {
    expect(isAssignableTo("Button", "TextView")).toBe(true);
    expect(isAssignableTo("TextView", "Button")).toBe(false);
    expect(isAssignableTo("LinearLayout", "ViewGroup")).toBe(true);
    expect(isAssignableTo("ScrollView", "View")).toBe(true);
    expect(isAssignableTo("EditText", "TextView")).toBe(true);
    expect(isAssignableTo("TextView", "EditText")).toBe(false);
  });
});
