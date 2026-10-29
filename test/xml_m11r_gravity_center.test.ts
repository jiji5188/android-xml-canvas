import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

/** M11r：LinearLayout gravity=center 时，wrap_content 的文字不能被强推 flex-start */
function build(innerGravity: string) {
  const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="match_parent">
      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="96dp"
          android:orientation="vertical"
          ${innerGravity ? `android:gravity="${innerGravity}"` : ""}>
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="库存"
            android:textSize="13sp" />
      </LinearLayout>
    </LinearLayout>`;
  const m = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never);
  const card = m.root.children[0];
  return { card, text: card.children[0] };
}

describe("M11r gravity=center 时 wrap_content 子项交叉轴对齐", () => {
  it("gravity=center → 容器 alignItems center 且文字不带 alignSelf", () => {
    const { card, text } = build("center");
    expect(card.style.alignItems).toBe("center");
    expect(card.style.justifyContent).toBe("center");
    expect(text.style.alignSelf).toBeUndefined();
  });

  it("gravity=center_vertical → 纵向居中、横向仍贴左（alignSelf flex-start）", () => {
    const { card, text } = build("center_vertical");
    expect(card.style.justifyContent).toBe("center");
    expect(text.style.alignSelf).toBe("flex-start");
  });

  it("无 gravity → 保持原来的 alignSelf flex-start（不被 stretch 拉满）", () => {
    const { card, text } = build("");
    expect(card.style.alignItems).toBe("stretch");
    expect(text.style.alignSelf).toBe("flex-start");
  });

  it("gravity=end → 交叉轴 flex-end，文字不写 alignSelf", () => {
    const { card, text } = build("end");
    expect(card.style.alignItems).toBe("flex-end");
    expect(text.style.alignSelf).toBeUndefined();
  });

  it("子项显式 layout_gravity 仍然优先", () => {
    const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
        android:layout_width="match_parent" android:layout_height="match_parent"
        android:orientation="vertical">
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="end"
            android:text="abc" />
      </LinearLayout>`;
    const m = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never);
    expect(m.root.children[0].style.alignSelf).toBe("flex-end");
  });
});
