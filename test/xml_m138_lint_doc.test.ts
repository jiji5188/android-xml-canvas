// test/xml_m138_lint_doc.test.ts — 非布局 XML 的行内校验（M138）
import { describe, expect, it } from "vitest";
import { codeDocKind, lintCodeDoc } from "../lib/xml/lint-doc";

const NS = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const msgs = (issues: { message: string }[]) => issues.map((i) => i.message).join(" | ");

describe("M138 文档类型判定", () => {
  it("按路径判定", () => {
    expect(codeDocKind("<manifest/>", "app/src/main/AndroidManifest.xml")).toBe("manifest");
    expect(codeDocKind("<resources/>", "app/src/main/res/values/strings.xml")).toBe("values");
    expect(codeDocKind("<selector/>", "res/color/text_color.xml")).toBe("color");
    expect(codeDocKind("<set/>", "res/anim/fade.xml")).toBe("anim");
    expect(codeDocKind("<shape/>", "res/drawable/bg.xml")).toBe("drawable");
    expect(codeDocKind("<menu/>", "res/menu/main.xml")).toBe("menu");
  });

  it("没有路径时看根标签", () => {
    expect(codeDocKind(`<manifest ${NS}></manifest>`)).toBe("manifest");
    expect(codeDocKind(`<resources xmlns:tools="x"></resources>`)).toBe("values");
    expect(codeDocKind(`<layer-list ${NS}></layer-list>`)).toBe("drawable");
    expect(codeDocKind(`<objectAnimator ${NS}></objectAnimator>`)).toBe("anim");
    expect(codeDocKind(`<menu ${NS}></menu>`)).toBe("menu");
    expect(codeDocKind(`<foo/>`)).toBe("other");
  });
});

describe("M138 通用结构检查仍然生效", () => {
  it("标签没闭合 → error，且不再叠加领域规则（避免连锁误报）", () => {
    const out = lintCodeDoc(`<resources><string name="a">x</string>`, "res/values/strings.xml");
    expect(out.some((i) => i.level === "error" && i.message.includes("未闭合"))).toBe(true);
    expect(out.length).toBe(1);
  });

  it("空文件不报", () => {
    expect(lintCodeDoc("", "res/values/strings.xml")).toEqual([]);
  });
});

describe("M138 AndroidManifest", () => {
  const GOOD = `<?xml version="1.0" encoding="utf-8"?>
<manifest ${NS} package="com.demo.app">
    <uses-permission android:name="android.permission.INTERNET"/>
    <application android:label="Demo" android:icon="@mipmap/ic_launcher">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
            </intent-filter>
        </activity>
    </application>
</manifest>`;

  it("完整清单没有 error", () => {
    const out = lintCodeDoc(GOOD, "app/src/main/AndroidManifest.xml");
    expect(out.filter((i) => i.level === "error")).toEqual([]);
  });

  it("组件缺 android:name → error，带行号", () => {
    const xml = GOOD.replace(` android:name=".MainActivity"`, "");
    const out = lintCodeDoc(xml, "app/src/main/AndroidManifest.xml");
    const hit = out.find((i) => i.message.includes("缺少 android:name"));
    expect(hit?.level).toBe("error");
    expect(hit?.line).toBe(5);
  });

  it("带 intent-filter 但缺 exported → warn", () => {
    const xml = GOOD.replace(` android:exported="true"`, "");
    const out = lintCodeDoc(xml, "app/src/main/AndroidManifest.xml");
    expect(msgs(out)).toContain("android:exported");
  });

  it("缺 application → error", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<manifest ${NS} package="x"></manifest>`;
    const out = lintCodeDoc(xml, "AndroidManifest.xml");
    expect(msgs(out)).toContain("缺少 <application>");
  });

  it("缺 xmlns:android → error", () => {
    const xml = `<manifest package="x"><application/></manifest>`;
    const out = lintCodeDoc(xml, "AndroidManifest.xml");
    expect(msgs(out)).toContain("xmlns:android");
  });

  it("重复声明权限 → warn，并指出第一次的行号", () => {
    const xml = GOOD.replace(
      `<uses-permission android:name="android.permission.INTERNET"/>`,
      `<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.INTERNET"/>`,
    );
    const out = lintCodeDoc(xml, "AndroidManifest.xml");
    const hit = out.find((i) => i.message.includes("重复声明"));
    expect(hit?.level).toBe("warn");
    expect(hit?.line).toBe(4);
    expect(hit?.message).toContain("第 3 行");
  });

  it("根不是 manifest → error", () => {
    const out = lintCodeDoc(`<resources ${NS}></resources>`, "AndroidManifest.xml");
    expect(msgs(out)).toContain("根节点应该是 <manifest>");
  });
});

describe("M138 res/values", () => {
  const GOOD = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Demo</string>
    <color name="brand">#FF3B82F6</color>
    <dimen name="gap">8dp</dimen>
</resources>`;

  it("正常文件没有 issue", () => {
    expect(lintCodeDoc(GOOD, "res/values/strings.xml")).toEqual([]);
  });

  it("重名 → error，指出第一处行号", () => {
    const xml = GOOD.replace(
      `<dimen name="gap">8dp</dimen>`,
      `<color name="brand">#FF000000</color>`,
    );
    const out = lintCodeDoc(xml, "res/values/colors.xml");
    const hit = out.find((i) => i.message.includes("重复定义"));
    expect(hit?.level).toBe("error");
    expect(hit?.line).toBe(5);
    expect(hit?.message).toContain("第 4 行");
  });

  it("缺 name → error", () => {
    const xml = GOOD.replace(` name="app_name"`, "");
    const out = lintCodeDoc(xml, "res/values/strings.xml");
    expect(msgs(out)).toContain("缺少 name 属性");
  });

  it("颜色值格式不对 → warn", () => {
    const xml = GOOD.replace("#FF3B82F6", "blue");
    const out = lintCodeDoc(xml, "res/values/colors.xml");
    const hit = out.find((i) => i.message.includes("不是合法颜色"));
    expect(hit?.level).toBe("warn");
    expect(hit?.line).toBe(4);
  });

  it("尺寸缺单位 → warn", () => {
    const xml = GOOD.replace(`>8dp<`, `>8<`);
    const out = lintCodeDoc(xml, "res/values/dimens.xml");
    expect(msgs(out)).toContain("缺少单位");
  });

  it("字符串里裸 & → error；转义和 CDATA 不报", () => {
    const bad = GOOD.replace(">Demo<", ">A&B<");
    expect(msgs(lintCodeDoc(bad, "res/values/strings.xml"))).toContain("未转义的 &");

    const esc = GOOD.replace(">Demo<", ">A&amp;B<");
    expect(lintCodeDoc(esc, "res/values/strings.xml")).toEqual([]);

    const cdata = GOOD.replace(">Demo<", "><![CDATA[A&B]]><");
    expect(lintCodeDoc(cdata, "res/values/strings.xml")).toEqual([]);
  });

  it("字符串里裸单引号 → warn，转义后不报", () => {
    const bad = GOOD.replace(">Demo<", ">It's<");
    expect(msgs(lintCodeDoc(bad, "res/values/strings.xml"))).toContain("裸单引号");
    const ok = GOOD.replace(">Demo<", ">It\\'s<");
    expect(lintCodeDoc(ok, "res/values/strings.xml")).toEqual([]);
  });

  it("数组/style 里的嵌套 item 不算缺 name", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="planets">
        <item>Mercury</item>
        <item>Venus</item>
    </string-array>
    <style name="AppTheme" parent="Theme.Material3.DayNight">
        <item name="colorPrimary">#FF3B82F6</item>
    </style>
</resources>`;
    expect(lintCodeDoc(xml, "res/values/arrays.xml")).toEqual([]);
  });

  it("缺 </resources> → error", () => {
    const xml = `<resources><string name="a">x</string>`;
    const out = lintCodeDoc(xml, "res/values/strings.xml");
    expect(out.some((i) => i.level === "error")).toBe(true);
  });
});

describe("M138 其他类型只查根标签", () => {
  it("menu 根写错 → error", () => {
    const out = lintCodeDoc(`<resources ${NS}></resources>`, "res/menu/main.xml");
    expect(msgs(out)).toContain("必须是 <menu>");
  });

  it("drawable 根不认识 → warn", () => {
    const out = lintCodeDoc(`<foo ${NS}></foo>`, "res/drawable/x.xml");
    expect(msgs(out)).toContain("drawable 文件的根节点不认识");
  });

  it("res/color 根不是 selector → warn", () => {
    const out = lintCodeDoc(`<shape ${NS}><solid android:color="#FFF"/></shape>`, "res/color/c.xml");
    expect(msgs(out)).toContain("<selector>");
  });

  it("正常 drawable / anim 不报", () => {
    expect(
      lintCodeDoc(`<shape ${NS} android:shape="rectangle"><solid android:color="#FFF"/></shape>`, "res/drawable/bg.xml"),
    ).toEqual([]);
    expect(lintCodeDoc(`<set ${NS}></set>`, "res/anim/fade.xml")).toEqual([]);
  });
});
