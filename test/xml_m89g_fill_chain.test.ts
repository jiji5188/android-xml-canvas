import { describe, expect, it } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function build(xml: string) {
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never, 2).root;
}

/**
 * M89g：wrap_content 容器里放 match_parent 子项。
 *
 * CSS 的 height:100% 遇上父容器 height:auto 会退化成 auto，于是子项塌成内容高度，
 * 表现为 gravity="bottom" / "center_vertical" 完全没有效果（Android 里子项会撑满可用空间）。
 * 修法：自下而上把这类父容器的主轴尺寸提升为 100%（= 填满上一级）。
 */
describe("M89g match_parent 在 wrap_content 父容器里的填充链", () => {
  it("竖排：wrap_content 父 + match_parent 子 → 父高变 100%，子项能被 gravity 推到底部", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="bottom">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
      </LinearLayout>
    </LinearLayout>`);
    expect(root.style.height).toBe("100%");
    const inner = root.children[0];
    expect(inner.style.height).toBe("100%");
    expect(inner.style.justifyContent).toBe("flex-end");
    expect(inner.style.alignItems).toBe("stretch");
  });

  it("横排：wrap_content 父 + match_parent 子 → 父宽变 100%", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="wrap_content" android:layout_height="match_parent" android:orientation="horizontal">
      <LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal" android:gravity="center_vertical">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
      </LinearLayout>
    </LinearLayout>`);
    expect(root.style.width).toBe("100%");
    expect(root.children[0].style.alignItems).toBe("center");
  });

  it("父容器已经是固定 dp 时不动（不用百分比覆盖显式尺寸）", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="300dp" android:orientation="vertical">
      <LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="bottom" />
    </LinearLayout>`);
    expect(root.style.height).toBe("600px");
  });

  it("没有 match_parent 子项时保持 wrap_content（auto）", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
    </LinearLayout>`);
    expect(root.style.height).toBe("auto");
  });

  it("多级嵌套一路往上提升", () => {
    const root = build(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
        <LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center_vertical" />
      </LinearLayout>
    </LinearLayout>`);
    expect(root.style.height).toBe("100%");
    expect(root.children[0].style.height).toBe("100%");
    expect(root.children[0].children[0].style.height).toBe("100%");
  });
});
