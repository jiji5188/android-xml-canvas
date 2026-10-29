import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";

const RES = { strings: {}, dimens: {}, colors: {}, attrs: {}, themeAttrs: {} } as never;

function build(xml: string) {
  const { root } = parseLayoutXml(xml);
  return buildRenderModel(root!, RES, 2).root as any;
}

const walk = (n: any, fn: (n: any) => void) => {
  fn(n);
  (n.children || []).forEach((c: any) => walk(c, fn));
};

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

describe("M16c 真机一致性修正（对照 APK 截图）", () => {
  it("TableLayout stretchColumns：指定列吃掉剩余宽度（B1 贴右）", () => {
    const root = build(`<TableLayout ${A}
      android:layout_width="match_parent" android:layout_height="wrap_content"
      android:stretchColumns="0">
      <TableRow>
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="A1" />
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="B1" />
      </TableRow>
    </TableLayout>`);
    const row = root.children[0];
    expect(String(row.children[0].style.flex)).toBe("1 1 0%");
    expect(row.children[1].style.flex).toBeUndefined();
    expect(row.children[0].style.minWidth).toBe("0px");
  });

  it("TableLayout 没写 stretchColumns 时不改动列宽", () => {
    const root = build(`<TableLayout ${A}
      android:layout_width="match_parent" android:layout_height="wrap_content">
      <TableRow>
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="A1" />
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="B1" />
      </TableRow>
    </TableLayout>`);
    const row = root.children[0];
    expect(row.children[0].style.flex).toBeUndefined();
    expect(row.children[1].style.flex).toBeUndefined();
  });

  it("TableLayout shrinkColumns：指定列允许收缩（min-width 归零）", () => {
    const root = build(`<TableLayout ${A}
      android:layout_width="match_parent" android:layout_height="wrap_content"
      android:shrinkColumns="1">
      <TableRow>
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="A1" />
        <TextView android:layout_width="wrap_content" android:layout_height="36dp" android:text="很长很长很长的单元格" />
      </TableRow>
    </TableLayout>`);
    const row = root.children[0];
    expect(row.children[1].style.flexShrink).toBe("1");
    expect(row.children[1].style.minWidth).toBe("0px");
    expect(row.children[0].style.flexShrink).toBeUndefined();
  });

  it("NumberPicker 忽略 android:value（真机恒为 0）", () => {
    const root = build(`<NumberPicker ${A}
      android:layout_width="wrap_content" android:layout_height="wrap_content" android:value="30" />`);
    expect(root.text).toBe("0");
    expect(root.className).toContain("axv-numberpicker");
  });

  it("SearchView 收起态：透明底色 + 无圆角 + 不渲染 queryHint", () => {
    const root = build(`<SearchView ${A}
      android:layout_width="match_parent" android:layout_height="44dp"
      android:queryHint="搜索关键字" />`);
    expect(root.className).toContain("axv-search");
    expect(root.style.backgroundColor).toBe("transparent");
    expect(root.style.borderRadius).toBe("0px");
    expect(root.text).toBe("");
  });
});
