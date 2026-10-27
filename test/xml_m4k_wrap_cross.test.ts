// test/xml_m4k_wrap_cross.test.ts — wrap_content 的交叉轴尺寸不该被 flex 拉满
// 用户 2026-10-28 03:11：Button 默认 wrap_content，为什么宽度撑满？
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import type { ResolvedNode } from "../lib/xml/types";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

function render(xml: string): ResolvedNode {
  const { root } = parseLayoutXml(xml)!;
  return buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 }).root;
}

describe("M4k wrap_content 交叉轴不拉伸", () => {
  it("竖直 LinearLayout 里 wrap_content 的按钮 align-self = flex-start（不再撑满宽）", () => {
    const root = render(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="OK"/></LinearLayout>`,
    );
    const btn = root.children[0];
    expect(btn.style.width).toBe("auto");
    expect(btn.style.alignSelf).toBe("flex-start");
  });

  it("match_parent 的兄弟不受影响（保持拉满）", () => {
    const root = render(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><Button ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:text="OK"/></LinearLayout>`,
    );
    expect(root.children[0].style.alignSelf).toBeUndefined();
  });

  it("横向 LinearLayout：height=wrap_content 用 flex-start 贴顶，不再被拉高", () => {
    const root = render(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="120dp" android:orientation="horizontal"><TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="hi"/></LinearLayout>`,
    );
    expect(root.children[0].style.alignSelf).toBe("flex-start");
  });

  it("layout_gravity=center 的 wrap 子项保持居中（不被覆盖成 flex-start）", () => {
    const root = render(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_gravity="center_horizontal" android:text="OK"/></LinearLayout>`,
    );
    expect(root.children[0].style.alignSelf).toBe("center");
  });

  it("FrameLayout 下（absolute 定位）不塞 alignSelf", () => {
    const root = render(
      `<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent"><Button ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="OK"/></FrameLayout>`,
    );
    expect(root.children[0].style.position).toBe("absolute");
    expect(root.children[0].style.alignSelf).toBeUndefined();
  });

  it("嵌套容器逐层生效（内层竖直 LL 里的 TextView 也是 flex-start）", () => {
    const root = render(
      `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical"><TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x"/></LinearLayout></LinearLayout>`,
    );
    expect(root.children[0].children[0].style.alignSelf).toBe("flex-start");
  });

  it("TableLayout / GridLayout 这类非 flex 容器不塞 alignSelf", () => {
    const root = render(
      `<TableLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content"><TableRow ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"><TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a"/></TableRow></TableLayout>`,
    );
    const row = root.children[0];
    const cell = row.children[0];
    expect(cell.style.alignSelf).toBeUndefined();
  });
});
