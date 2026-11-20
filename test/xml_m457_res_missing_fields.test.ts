// test/xml_m457_res_missing_fields.test.ts — M457：资源表缺字段时渲染不崩（用户退件系统白屏事故）
// 事故：toolbar.xml 的 @color/colorPrimary + @string/app_name，res.colors/res.strings 为 undefined 时
//  resolveColor / localeString 直接下标 → TypeError → 整棵渲染树崩 → 运行调试白屏。
import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import { resolveColor, resolveText, localeString, resolveSize } from "@/lib/xml/resolve";
import type { ResourceTable } from "@/lib/xml/types";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/colorPrimary">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/app_name"
        android:textColor="?attr/colorPrimary" />
</FrameLayout>`;

/** 部分解析的资源表：可选字段全缺（模拟只上传了 drawable、values 解析失败的极端情况） */
function sparseRes(extra: Partial<ResourceTable> = {}): ResourceTable {
  return { ...({} as ResourceTable), ...extra };
}

describe("M457: 资源表缺字段防御（运行调试白屏根因）", () => {
  it("buildRenderModel：res.colors/res.strings 为 undefined 不抛异常", () => {
    const res = sparseRes(); // 全字段 undefined
    const parsed = parseLayoutXml(XML);
    expect(parsed.root).toBeTruthy();
    expect(() => buildRenderModel(parsed.root!, res, 2, {}, { w: 412, h: 915 })).not.toThrow();
  });

  it("buildRenderModel：只有 styles 没有 values 也不崩（toolbar.xml 场景）", () => {
    const res = sparseRes({
      styles: { "MaterialCardView": { name: "MaterialCardView", attrs: {} } },
      drawableXml: {},
    });
    const parsed = parseLayoutXml(XML);
    const model = buildRenderModel(parsed.root!, res, 2, {}, { w: 412, h: 915 });
    expect(model.root.tag).toBe("FrameLayout");
    // @color 未定义 → 兜底色，不再是抛异常
    expect(model.root.style.backgroundColor).toBeTruthy();
  });

  it("resolveColor：?attr/colorPrimary 在空表走 M3 兜底而不是崩", () => {
    const issues = [] as import("@/lib/xml/types").XmlIssue[];
    expect(() => resolveColor("?attr/colorPrimary", sparseRes(), issues, "/0", "textColor")).not.toThrow();
  });

  it("resolveColor：@color/xxx 在空表走兜底而不是崩", () => {
    const issues = [] as import("@/lib/xml/types").XmlIssue[];
    const c = resolveColor("@color/colorPrimary", sparseRes(), issues, "/0", "background");
    expect(c).toBe("#888888");
    expect(issues.some((i) => i.message.includes("未定义"))).toBe(true);
  });

  it("resolveText / localeString：@string/xxx 在空表不崩，原样返回引用", () => {
    const issues = [] as import("@/lib/xml/types").XmlIssue[];
    expect(() => resolveText("@string/app_name", sparseRes(), issues, "/0")).not.toThrow();
    expect(localeString(sparseRes(), "app_name")).toBeUndefined();
  });

  it("resolveSize：@dimen/xxx 在空表按 0dp 兜底", () => {
    const issues = [] as import("@/lib/xml/types").XmlIssue[];
    const spec = resolveSize("@dimen/spacing", sparseRes(), issues, "/0", "width");
    expect(spec).toEqual({ kind: "zero" });
  });

  it("localeString：stringsByLocale 为 undefined 但 locale 有值时不崩", () => {
    const res = sparseRes({ locale: "en" }); // 无 stringsByLocale
    expect(() => localeString(res, "app_name")).not.toThrow();
  });

  it("行为不变：完整资源表正常解析（@color/@string 命中）", () => {
    const res: ResourceTable = {
      strings: { app_name: "退件系统" },
      dimens: {},
      colors: { colorPrimary: "#FF1E88E5" },
    } as ResourceTable;
    expect(localeString(res, "app_name")).toBe("退件系统");
    const issues = [] as import("@/lib/xml/types").XmlIssue[];
    expect(resolveColor("@color/colorPrimary", res, issues, "/0", "background")).toBe("#1E88E5");
  });
});
