import { describe, it, expect } from "vitest";
import { namespaceIssues, fixNamespacePrefixes, ANDROID_ONLY_ATTRS } from "../lib/xml/namespace";
import { lintXml } from "../lib/xml/lint";
import { exportLayoutXml } from "../lib/xml/export";
import { SAMPLE_PROJECTS } from "../lib/xml/sample-projects";

describe("M12 属性命名空间（aapt 编译通过性）", () => {
  it("namespaceIssues 找出 android:cornerRadius 这类库属性", () => {
    const src = `<com.google.android.material.button.MaterialButton
  android:layout_width="wrap_content"
  android:cornerRadius="8dp"
  android:iconGravity="start"
  android:paddingStart="8dp" />`;
    const found = namespaceIssues(src);
    expect(found.map((i) => i.to)).toEqual(["app:cornerRadius", "app:iconGravity"]);
    expect(found[0].line).toBe(3);
  });

  it("android:style 被识别为要去掉前缀", () => {
    const found = namespaceIssues(`<TextView android:style="@style/Big" />`);
    expect(found[0].to).toBe("style");
    expect(found[0].from).toBe("android:style");
  });

  it("解析→序列化 不丢前缀（app:cardCornerRadius 不会被写成 android:）", async () => {
    const { parseLayoutXml } = await import("../lib/xml/parser");
    const { serialize } = await import("../lib/xml/parser");
    const src = `<androidx.cardview.widget.CardView xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"
  android:layout_width="match_parent" app:cardCornerRadius="12dp" android:padding="4dp" />`;
    const out = serialize(parseLayoutXml(src).root!);
    expect(out).toContain("app:cardCornerRadius=\"12dp\"");
    expect(out).toContain("android:padding=\"4dp\"");
    expect(out).not.toContain("android:cardCornerRadius");
  });

  it("GridLayout 的平台属性不能改（columnCount / layout_columnWeight）", () => {
    const src = `<GridLayout android:columnCount="3" />
<TextView android:layout_columnWeight="1" />`;
    expect(namespaceIssues(src)).toHaveLength(0);
    expect(ANDROID_ONLY_ATTRS.has("columnCount")).toBe(true);
  });

  it("fixNamespacePrefixes 改前缀并补 xmlns:app", () => {
    const src = `<androidx.cardview.widget.CardView
  xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:cardCornerRadius="12dp">
</androidx.cardview.widget.CardView>`;
    const out = fixNamespacePrefixes(src);
    expect(out).toContain('xmlns:app="http://schemas.android.com/apk/res-auto"');
    expect(out).toContain('app:cardCornerRadius="12dp"');
    expect(out).not.toContain("android:cardCornerRadius");
  });

  it("已声明 xmlns:app 时不重复补", () => {
    const src = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto" android:cornerRadius="4dp" />`;
    const out = fixNamespacePrefixes(src);
    expect(out.match(/xmlns:app=/g)).toHaveLength(1);
  });

  it("lint 会给出命名空间警告", () => {
    const issues = lintXml(`<TextView xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="wrap_content"
  android:cardCornerRadius="8dp" />`);
    const hit = issues.find((i) => i.message.includes("app:cardCornerRadius"));
    expect(hit).toBeTruthy();
    expect(hit!.level).toBe("warn");
  });

  it("exportLayoutXml 输出的 XML 不再含 android: 版库属性", () => {
    const out = exportLayoutXml(`<?xml version="1.0" encoding="utf-8"?>
<com.google.android.material.card.MaterialCardView
  xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="wrap_content"
  android:cardCornerRadius="16dp" />`);
    expect(out).toContain("app:cardCornerRadius");
    expect(out).toContain("xmlns:app=");
    expect(out).not.toMatch(/android:cardCornerRadius/);
  });

  it("全部内置样例都不含需要改成 app: 的属性", () => {
    const bad: string[] = [];
    for (const p of SAMPLE_PROJECTS) {
      for (const issue of namespaceIssues(p.layout)) {
        bad.push(`${p.name}: ${issue.from} → ${issue.to}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("全部内置样例解析后仍能渲染（前缀改动不影响预览）", async () => {
    const { parseLayoutXml } = await import("../lib/xml/parser");
    const { buildRenderModel } = await import("../lib/xml/css");
    const { DEFAULT_RESOURCES } = await import("../lib/xml/resources");
    for (const p of SAMPLE_PROJECTS) {
      const { root } = parseLayoutXml(p.layout);
      expect(root).toBeTruthy();
      const m = buildRenderModel(root!, DEFAULT_RESOURCES as never);
      expect(m.root.children.length).toBeGreaterThan(0);
    }
  });
});
