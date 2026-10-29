import { describe, it, expect } from "vitest";
import { docAttrs, docForAttr, getWidgetDoc } from "../lib/xml/widget-docs";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function one(widget: string) {
  const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${widget}</LinearLayout>`;
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root.children[0];
}

describe("M11v 文档属性表补齐", () => {
  it("通用属性补齐 paddingTop/maxWidth/rotation 等", () => {
    const names = docAttrs("UnknownWidget").map((a) => a.name);
    for (const n of ["paddingTop", "paddingBottom", "paddingHorizontal", "maxWidth", "maxHeight", "rotation", "scaleX", "translationZ", "foregroundGravity", "fontFamily"]) {
      expect(names).toContain(n);
    }
  });

  it("每个补上的属性都有中文描述", () => {
    const tags = ["LinearLayout", "TextView", "Switch", "ProgressBar", "RatingBar", "CardView", "GridLayout", "TextInputLayout", "ImageView", "EditText"];
    for (const t of tags) {
      for (const a of docAttrs(t)) {
        expect(a.desc && a.desc.length > 3, `${t}.${a.name} 缺描述`).toBe(true);
      }
    }
  });

  it("Switch 文档含 trackTint/thumbTint，ProgressBar 含 indeterminate", () => {
    const sw = docAttrs("Switch").map((a) => a.name);
    expect(sw).toContain("trackTint");
    expect(sw).toContain("thumbTint");
    const pb = docAttrs("ProgressBar").map((a) => a.name);
    expect(pb).toContain("indeterminate");
    expect(pb).toContain("secondaryProgress");
  });

  it("补充表不重复已有属性名", () => {
    const names = docAttrs("RatingBar").map((a) => a.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("别名控件也能拿到补充属性（SwitchCompat → Switch 表）", () => {
    expect(getWidgetDoc("SwitchCompat").title).toBe(getWidgetDoc("SwitchMaterial").title);
    expect(docForAttr("androidx.appcompat.widget.SwitchCompat", "trackTint")?.desc).toBeTruthy();
  });
});

describe("M11v 新增渲染", () => {
  it("fontFamily 生效", () => {
    const n = one(`<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" android:fontFamily="sans-serif-medium" />`);
    expect(String(n.style.fontFamily)).toContain("sans-serif-medium");
  });

  it("TextInputLayout boxStrokeColor → 边框", () => {
    const n = one(`<com.google.android.material.textfield.TextInputLayout ${A}
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:boxBackgroundMode="outline" android:boxStrokeColor="#04409F" />`);
    expect(String(n.style.border)).toContain("#04409F");
  });

  it("CardView contentPadding 变成内边距", () => {
    const n = one(`<androidx.cardview.widget.CardView ${A}
        android:layout_width="match_parent" android:layout_height="120dp" android:contentPadding="16dp" />`);
    expect(n.style.paddingTop).toBe("32px");
  });

  it("LinearLayout divider + showDividers=middle 只给中间子项加线", () => {
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"
        android:orientation="vertical" android:divider="#E0E0E0" android:dividerHeight="1dp" android:showDividers="middle">
        <TextView ${A} android:layout_width="match_parent" android:layout_height="40dp" android:text="a" />
        <TextView ${A} android:layout_width="match_parent" android:layout_height="40dp" android:text="b" />
      </LinearLayout>`;
    const root = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root;
    expect(root.children[0].style.borderTop).toBeUndefined();
    expect(String(root.children[1].style.borderTop)).toContain("2px solid #E0E0E0");
  });

  it("Switch 的 textOn/textOff 有值时才显示", () => {
    const withText = one(`<Switch ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:checked="true" android:textOn="开启" android:textOff="关闭" />`);
    expect(withText.text).toBe("开启");
    const noText = one(`<Switch ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" />`);
    expect(noText.text).toBe("");
  });

  it("SeekBar thumb 图片 → CSS 变量；颜色边界透明", () => {
    const res = { ...(DEFAULT_RESOURCES as object), drawables: { thumb_png: "data:image/png;base64,AAA" } } as never;
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><SeekBar ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:thumb="@drawable/thumb_png" /></LinearLayout>`;
    const n = buildRenderModel(parseLayoutXml(xml).root!, res).root.children[0];
    expect(String(n.style["--axv-seek-thumb-img"])).toContain("data:image/png");
    expect(n.style["--axv-seek-thumb"]).toBe("transparent");
  });

  it("ProgressBar progressDrawable 图片 → 轨道背景图", () => {
    const res = { ...(DEFAULT_RESOURCES as object), drawables: { track_png: "data:image/png;base64,AAA" } } as never;
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><ProgressBar ${A} style="?android:attr/progressBarStyleHorizontal" android:layout_width="match_parent" android:layout_height="wrap_content" android:progressDrawable="@drawable/track_png" /></LinearLayout>`;
    const n = buildRenderModel(parseLayoutXml(xml).root!, res).root.children[0];
    expect(String(n.style.backgroundImage)).toContain("data:image/png");
  });
});
