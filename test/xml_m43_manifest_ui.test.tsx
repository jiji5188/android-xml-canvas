// test/xml_m43_manifest_ui.test.tsx — M43：AndroidManifest.xml 视图接线（视图 tab / 渲染 / 纯函数判定）
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { XmlCodeView, type XmlCodeViewProps } from "../components/XmlCodeView";
import { ManifestEditor } from "../components/ManifestEditor";
import { ValuesEditor } from "../components/ValuesEditor";
import { CodeEditor } from "../components/CodeEditor";
import { isManifestPath, looksLikeManifest } from "../lib/xml/manifest-edit";

type El = { type: unknown; props: Record<string, any> };

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.demo.app"
    android:versionCode="42"
    android:versionName="1.4">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application android:allowBackup="true" android:icon="@mipmap/ic_launcher">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>
`;

function props(over: Partial<XmlCodeViewProps> = {}): XmlCodeViewProps {
  return {
    open: true,
    isMobile: true,
    leftOpen: false,
    rightOpen: false,
    value: MANIFEST,
    onChange: vi.fn(),
    errors: [],
    onFormat: vi.fn(),
    view: "manifest",
    fileKey: "app/src/main/AndroidManifest.xml",
    onNote: vi.fn(),
    ...over,
  };
}

function collect(n: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(n)) {
    for (const c of n) collect(c as ReactNode, out);
    return out;
  }
  if (!isValidElement(n)) return out;
  const el = n as unknown as El;
  out.push(el);
  collect(el.props?.children as ReactNode, out);
  return out;
}

describe("M43 isManifestPath / looksLikeManifest", () => {
  it("认得路径", () => {
    expect(isManifestPath("app/src/main/AndroidManifest.xml")).toBe(true);
    expect(isManifestPath("AndroidManifest.xml")).toBe(true);
    expect(isManifestPath("res/layout/a.xml")).toBe(false);
  });

  it("认得内容（根节点 manifest）", () => {
    expect(looksLikeManifest(MANIFEST)).toBe(true);
    expect(looksLikeManifest('<resources></resources>')).toBe(false);
    expect(looksLikeManifest("<LinearLayout/>")).toBe(false);
  });
});

describe("M43 XmlCodeView 接线", () => {
  it("view=manifest 渲染 axv-val axv-mf 页", () => {
    const html = renderToStaticMarkup(<XmlCodeView {...props()} />);
    expect(html).toContain("axv-val axv-mf axv-code-fill");
    expect(html).toContain("应用信息");
    expect(html).toContain("权限");
    expect(html).toContain("组件");
    expect(html).toContain("android.permission.INTERNET");
  });

  it("view=values 还是走 ValuesEditor（互不串）", () => {
    const p = props({ view: "values", value: '<resources><string name="a">x</string></resources>', fileKey: "res/values/strings.xml" });
    const tree = XmlCodeView(p) as unknown as El;
    const all = collect(tree as unknown as ReactNode);
    expect(all.some((e) => e.type === ValuesEditor)).toBe(true);
    expect(all.some((e) => e.type === ManifestEditor)).toBe(false);
  });

  it("view=code 还是走 CodeEditor", () => {
    const p = props({ view: "code" });
    const tree = XmlCodeView(p) as unknown as El;
    const all = collect(tree as unknown as ReactNode);
    expect(all.some((e) => e.type === CodeEditor)).toBe(true);
    expect(all.some((e) => e.type === ManifestEditor)).toBe(false);
  });

  it("open=false 不渲染", () => {
    expect(XmlCodeView(props({ open: false }))).toBeNull();
  });
});

describe("M43 ManifestEditor 内容", () => {
  it("列出基本字段、权限、组件", () => {
    const html = renderToStaticMarkup(<ManifestEditor xml={MANIFEST} onChange={() => {}} />);
    expect(html).toContain('value="com.demo.app"');
    expect(html).toContain('value="42"');
    expect(html).toContain('value="21"');
    expect(html).toContain('value="true"');
    expect(html).toContain("android.permission.INTERNET");
    expect(html).toContain(".MainActivity");
    expect(html).toContain("Activity");
  });

  it("解析失败给说明", () => {
    const html = renderToStaticMarkup(<ManifestEditor xml="<LinearLayout/>" onChange={() => {}} />);
    expect(html).toContain("axv-val-empty");
    expect(html).toContain("manifest");
  });

  it("没有权限/组件时给空态", () => {
    const xml = `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="a.b">
    <application android:label="x"></application>
</manifest>`;
    const html = renderToStaticMarkup(<ManifestEditor xml={xml} onChange={() => {}} />);
    expect(html).toContain("还没有声明权限");
    expect(html).toContain("还没有 activity / service 等组件");
  });
});
