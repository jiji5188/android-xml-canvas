// test/xml_m194_lint_noise.test.ts — M194：三条「噪音型」误报的回归
//  ① AndroidManifest 里的 android:icon / android:title 被误判成 app:
//  ② <manifest> 缺 package 被当成问题
//  ③ 打包时找不到布局（pickProjectLayout 从 res/layout* 里挑）
import { describe, it, expect } from "vitest";
import { namespaceIssues, fixNamespacePrefixes } from "../lib/xml/namespace";
import { lintCodeDoc } from "../lib/xml/lint-doc";
import { pickProjectLayout } from "../lib/xml/pick-layout";
import type { AiFileIo } from "../lib/xml/ai-tools";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application
    android:label="@string/app_name"
    android:icon="@mipmap/ic_launcher"
    android:theme="@style/Theme.App">
    <activity android:name=".MainActivity" android:exported="true" />
  </application>
</manifest>`;

describe("namespace：manifest 不按 app: 规则改", () => {
  it("android:icon / android:label 不报", () => {
    expect(namespaceIssues(MANIFEST)).toHaveLength(0);
  });

  it("fixNamespacePrefixes 不动 manifest（否则 android:icon → app:icon 反而编译不过）", () => {
    expect(fixNamespacePrefixes(MANIFEST)).toBe(MANIFEST);
  });

  it("布局里的 android:cornerRadius 仍要报并改 app:", () => {
    const lay = `<com.google.android.material.button.MaterialButton xmlns:android="http://schemas.android.com/apk/res/android" android:cornerRadius="8dp" />`;
    expect(namespaceIssues(lay).map((i) => i.to)).toEqual(["app:cornerRadius"]);
    expect(fixNamespacePrefixes(lay)).toContain("app:cornerRadius");
  });
});

describe("lintDoc：manifest 缺 package 不再算问题", () => {
  it("没有任何 error/warn 提到 package", () => {
    const issues = lintCodeDoc(MANIFEST, "AndroidManifest.xml");
    expect(issues.filter((i) => /package/.test(i.message))).toHaveLength(0);
  });
});

/** 极简内存文件系统 */
function fakeIo(files: Record<string, string>): AiFileIo {
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const io = {
    rootLabel: () => "test",
    async list(rel: string) {
      const norm = rel.replace(/^\.?\/*/, "").replace(/\/+$/, "");
      const prefix = norm ? `${norm}/` : "";
      const set = new Map<string, "file" | "dir">();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const seg = rest.split("/");
        set.set(seg[0], seg.length > 1 ? "dir" : "file");
      }
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        set.set(rest, "dir");
      }
      if (!set.size) return { ok: false as const, items: [] };
      return { ok: true as const, items: [...set].map(([name, kind]) => ({ name, kind })) };
    },
    async read(rel: string) {
      const norm = rel.replace(/^\.?\/*/, "");
      const text = files[norm];
      return text === undefined ? { ok: false as const } : { ok: true as const, text };
    },
  };
  return io as unknown as AiFileIo;
}

const PROJ: Record<string, string> = {
  "app/src/main/java/com/example/demo/MainActivity.java": "package com.example.demo;",
  "app/src/main/res/layout/activity_main.xml":
    '<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />',
  "app/src/main/res/layout/dialog_edit.xml": "<LinearLayout />",
  "app/src/main/res/values/strings.xml": "<resources />",
};

describe("pickProjectLayout：从项目 res 里挑布局", () => {
  it("优先 R.layout.X 指定的那个", async () => {
    const io = fakeIo(PROJ);
    const r = await pickProjectLayout(io, "app/src/main/java/com/example/demo/MainActivity.java", "dialog_edit");
    expect(r?.name).toBe("dialog_edit");
    expect(r?.rel).toBe("layout/dialog_edit.xml");
    expect(r?.text).toContain("LinearLayout");
  });

  it("没有 want 时退回 activity_main", async () => {
    const io = fakeIo(PROJ);
    const r = await pickProjectLayout(io, "app/src/main/java/com/example/demo/MainActivity.java", "");
    expect(r?.name).toBe("activity_main");
  });

  it("一个布局都没有 → null", async () => {
    const io = fakeIo({ "app/src/main/res/values/strings.xml": "<resources />" });
    expect(await pickProjectLayout(io, "app/src/main/java/MainActivity.java", "activity_main")).toBeNull();
  });
});
