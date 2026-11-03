import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function build(xml: string) {
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never, 2).root;
}

/**
 * M89h：Android 原生 LinearLayout 的 orientation 默认值是 horizontal。
 * 老实现兜底成 vertical，导致「工具栏」这种没写 orientation 的布局在预览里被竖着堆成一列。
 */
describe("M89h LinearLayout 缺省 orientation = horizontal", () => {
  it("没写 orientation 的工具栏 → flex-direction: row", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="56dp" android:gravity="bottom|end">
        <ImageButton ${A} android:layout_width="40dp" android:layout_height="40dp" />
        <TextView ${A} android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:text="标题" />
      </LinearLayout>`);
    expect(root.style.flexDirection).toBe("row");
    // gravity=bottom|end：横排父容器里 end 走主轴（justifyContent），bottom 走交叉轴（alignItems）
    expect(root.style.justifyContent).toBe("flex-end");
    expect(root.style.alignItems).toBe("flex-end");
  });

  it("没写 orientation 时子项 layout_gravity 按横排父容器解析（纵向分量生效）", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="56dp">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a" android:layout_gravity="center_vertical" />
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="b" android:layout_gravity="bottom" />
      </LinearLayout>`);
    expect(root.children[0].style.alignSelf).toBe("center");
    expect(root.children[1].style.alignSelf).toBe("flex-end");
  });

  it("显式写 vertical 仍然竖排（不受默认值改动影响）", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a" />
      </LinearLayout>`);
    expect(root.style.flexDirection).toBe("column");
  });

  it("显式写 horizontal 是横排", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a" />
      </LinearLayout>`);
    expect(root.style.flexDirection).toBe("row");
  });
});
