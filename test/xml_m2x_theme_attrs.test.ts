// M2x：?attr/xxx 主题属性解析（styles.xml 里 Theme* 收集 → 上传后可用）
import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { resolveNodeAttrs } from "../lib/xml/resolve";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import type { ResourceTable, XmlNode } from "../lib/xml/types";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function attrColor(xml: string, res: ResourceTable = DEFAULT_RESOURCES): string {
  const { root } = parseLayoutXml(xml)!;
  const { attrs } = resolveNodeAttrs(root!, res);
  return attrs["textColor"] as string;
}

describe("M2x ?attr 主题解析", () => {
  it("未上传主题时走内置 Material3 兜底（colorPrimary=#6750A4）", () => {
    const c = attrColor(`<TextView ${A} android:textColor="?attr/colorPrimary" />`);
    expect(c).toBe("#6750A4");
  });

  it("上传主题后 ?attr/brandColor 使用主题值（@color 引用能展开）", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      themeAttrs: { brandColor: "@color/brand" },
      colors: { ...DEFAULT_RESOURCES.colors, brand: "#FF123456" },
    };
    expect(attrColor(`<TextView ${A} android:textColor="?attr/brandColor" />`, res)).toBe("#FF123456");
  });

  it("主题值直接是 #hex 也能用", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      themeAttrs: { accent: "#FFCC00FF" },
    };
    // #CC00FF（ARGB 转 RGB）
    expect(attrColor(`<TextView ${A} android:textColor="?attr/accent" />`, res)).toBe("#CC00FF");
  });

  it("主题表没有的属性回落内置兜底", () => {
    const res: ResourceTable = { ...DEFAULT_RESOURCES, themeAttrs: {} };
    expect(attrColor(`<TextView ${A} android:textColor="?attr/colorError" />`, res)).toBe("#B3261E");
  });

  it("e2e：Theme colorPrimary 改变后 Button 预览背景色跟着变", () => {
    const res: ResourceTable = {
      ...DEFAULT_RESOURCES,
      themeAttrs: { colorPrimary: "#FF00C853" },
    };
    const { root } = parseLayoutXml(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content">
         <Button android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:background="?attr/colorPrimary" />
       </LinearLayout>`,
    )!;
    const m = buildRenderModel(root!, res, 2, undefined, { w: 412, h: 892 });
    expect(m.root.children[0].style.backgroundColor).toBe("#00C853");
  });
});
