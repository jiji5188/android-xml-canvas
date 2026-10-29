import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function one(widget: string) {
  const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${widget}</LinearLayout>`;
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root.children[0];
}

describe("M11t GridLayout gravity / layout_gravity", () => {
  it("GridLayout gravity=center → justify-items center + align-items center", () => {
    const xml = `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"
        android:columnCount="2" android:gravity="center">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a" />
      </GridLayout>`;
    const r = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root;
    expect(r.style.justifyItems).toBe("center");
    expect(r.style.alignItems).toBe("center");
  });

  it("GridLayout 子项 layout_gravity=center_horizontal → justify-self center（不再误设 align-self）", () => {
    const xml = `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"
        android:columnCount="2">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
          android:layout_column="1" android:layout_gravity="center_horizontal" android:text="a" />
      </GridLayout>`;
    const cell = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root.children[0];
    expect(cell.style.justifySelf).toBe("center");
    expect(cell.style.alignSelf).toBeUndefined();
  });

  it("GridLayout 子项 layout_gravity=bottom|end → align-self end + justify-self end", () => {
    const xml = `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"
        android:columnCount="2">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
          android:layout_gravity="bottom|end" android:text="a" />
      </GridLayout>`;
    const cell = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root.children[0];
    expect(cell.style.justifySelf).toBe("end");
    expect(cell.style.alignSelf).toBe("end");
  });
});

describe("M11t 开关 / 勾选染色", () => {
  it("Switch trackTint/thumbTint 生效", () => {
    const n = one(`<Switch ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:checked="true" android:trackTint="#04409F" android:thumbTint="#FFEE00" />`);
    const st = n.style as Record<string, string>;
    expect(st["--axv-ctl-bg"]).toBe("#04409F");
    expect(st["--axv-ctl-thumb"]).toBe("#FFEE00");
    expect(st["--axv-ctl-thumb-d"]).toBe("36px"); // 18dp × 2
    expect(st["--axv-ctl-thumb-x"]).toBe("40px"); // 20dp × 2
  });

  it("CheckBox buttonTint 生效", () => {
    const n = one(`<CheckBox ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:checked="true" android:buttonTint="#B3261E" />`);
    const st = n.style as Record<string, string>;
    expect(st["--axv-ctl-bg"]).toBe("#B3261E");
    expect(st["--axv-ctl-ring"]).toBe("#B3261E");
  });
});

describe("M11t 进度 / 评分 / 禁用 / 尺寸约束", () => {
  it("水平 ProgressBar 读 progress/max 并算 --axv-progress", () => {
    const n = one(`<ProgressBar ${A} style="@android:style/Widget.Material.ProgressBar.Horizontal"
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:progress="30" android:max="60" android:progressTint="#1F7A3D" />`);
    const st = n.style as Record<string, string>;
    expect(st["--axv-progress"]).toBe("0.5");
    expect(st["--axv-progress-color"]).toBe("#1F7A3D");
  });

  it("indeterminate 加 axv-indet 类 + 半条宽", () => {
    const xml = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
      <ProgressBar ${A} style="@android:style/Widget.Material.ProgressBar.Horizontal"
        android:layout_width="match_parent" android:layout_height="wrap_content" android:indeterminate="true" />
      </LinearLayout>`;
    const n = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root.children[0];
    expect(n.className).toContain("axv-indet");
    expect((n.style as Record<string, string>)["--axv-progress"]).toBe("0.4");
  });

  it("secondaryProgress 画出次要进度渐变", () => {
    const n = one(`<ProgressBar ${A} style="@android:style/Widget.Material.ProgressBar.Horizontal"
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:progress="20" android:secondaryProgress="60" android:max="100" />`);
    expect(String(n.style.backgroundImage)).toContain("linear-gradient");
  });

  it("RatingBar 5 星 / rating 3.5 → 宽度与亮色宽度", () => {
    const n = one(`<RatingBar ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:numStars="5" android:rating="3.5" />`);
    const st = n.style as Record<string, string>;
    expect(n.className).toBe("axv-rating");
    expect(st["--axv-stars-w"]).toBe("180px"); // 5 × 18dp × 2
    expect(st["--axv-rating-w"]).toBe("126px"); // 3.5 × 36
  });

  it("android:enabled=false → 0.38 透明度", () => {
    const n = one(`<Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="x" android:enabled="false" />`);
    expect(n.style.opacity).toBe("0.38");
  });

  it("maxWidth/minHeight 生效", () => {
    const n = one(`<TextView ${A} android:layout_width="match_parent" android:layout_height="wrap_content"
        android:text="x" android:maxWidth="120dp" android:minHeight="48dp" />`);
    expect(n.style.maxWidth).toBe("240px");
    expect(n.style.minHeight).toBe("96px");
  });

  it("CardView cardBackgroundColor / cardElevation", () => {
    const n = one(`<com.google.android.material.card.MaterialCardView ${A}
        android:layout_width="match_parent" android:layout_height="120dp"
        android:cardBackgroundColor="#FFF4E5" android:cardElevation="4dp" />`);
    expect(n.style.backgroundColor).toBe("#FFF4E5");
    expect(n.style.boxShadow).toBeUndefined(); // 有 cardElevation 就不套默认阴影
  });

  it("EditText singleLine → nowrap", () => {
    const n = one(`<EditText ${A} android:layout_width="match_parent" android:layout_height="wrap_content"
        android:singleLine="true" android:hint="输入" />`);
    expect(n.style.whiteSpace).toBe("nowrap");
  });
});
